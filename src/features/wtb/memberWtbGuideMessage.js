// src/features/wtb/memberWtbGuideMessage.js
// Discord.js v14
//
// Purpose:
// - Ensure the "Member WTBs – Buyer Guide" embed exists in your Guide channel.
// - If it already exists (same identifier), edit it.
// - If not, post it.
// - Optional: persist the messageId to Airtable/DB yourself; this file supports env var too.
//
// Usage (recommended):
//   import { ensureMemberWtbGuideMessage } from "./src/features/wtb/memberWtbGuideMessage.js";
//   client.once(Events.ClientReady, async () => {
//     await ensureMemberWtbGuideMessage(client);
//   });
//
// ENV:
//   GUIDE_CHANNEL_ID=123...
//   GUIDE_MESSAGE_ID= (optional) message id to always edit the same message
//
// Notes:
// - If GUIDE_MESSAGE_ID is not set, we try to find the message by embed footer identifier.
// - If not found, we send a new message.

import { EmbedBuilder, Events } from "discord.js";

const GUIDE_CHANNEL_ID = process.env.GUIDE_CHANNEL_ID;
const GUIDE_MESSAGE_ID = process.env.GUIDE_MESSAGE_ID || null;

// This is how we "tag" the embed so we can find it later even if title/description changes.
const GUIDE_EMBED_IDENTIFIER = "kc:member-wtb-buyer-guide:v1";

function buildMemberWtbGuideEmbed() {
  return new EmbedBuilder()
    .setTitle("📦 Member WTBs – Buyer Guide")
    .setDescription(
      [
        "This guide explains **how to post a Want To Buy (WTB)**, how the process works once a seller is matched, and how **payment & escrow** are handled.",
        "",
        "Please read this before posting.",
        "",
        "---",
        "## 1️⃣ How to Post a Member WTB",
        "",
        "**✅ Option A — Single WTB**",
        "Use the **WTB post button / form** and fill in:",
        "• Brand",
        "• Model / SKU",
        "• Size",
        "• Target payout",
        "• Notes (condition, box, deadline, etc.)",
        "",
        "Once submitted, your WTB becomes visible to sellers immediately.",
        "",
        "**✅ Option B — CSV Upload (Multiple WTBs)**",
        "If you want to post **multiple WTBs at once**:",
        "1) Download the **CSV template**",
        "2) Fill it in (**1 row = 1 WTB**)",
        "3) Upload the file",
        "",
        "⚠️ **Important:** Only use the official template. Changing columns/formats may cause the upload to fail.",
        "",
        "---",
        "## 2️⃣ Cancelling an Active WTB",
        "",
        "If you **find the item elsewhere** or no longer need it:",
        "• **Cancel the WTB immediately**",
        "• Do **not** leave WTBs active if you already sourced the item",
        "",
        "Why this matters:",
        "• Sellers actively claim WTBs",
        "• Leaving inactive WTBs wastes seller time",
        "• Repeated abuse may result in posting restrictions",
        "",
        "👉 Use the **Cancel WTB** option in the dashboard or contact staff if needed.",
        "",
        "---",
        "## 3️⃣ What Happens When a Seller Matches Your WTB",
        "",
        "Once a seller claims your WTB:",
        "• A **private deal channel** is created",
        "• The seller confirms the item and uploads proof",
        "• Staff reviews and confirms the deal",
        "",
        "After admin confirmation, **you will receive a DM from the bot** to continue the flow.",
        "",
        "---",
        "## 4️⃣ Payment & Shipping Flow (IMPORTANT)",
        "",
        "**💰 Payment (Escrow)**",
        "• Payment is **ALWAYS upfront**",
        "• You upload **payment proof** via the button in the DM",
        "• Kickz Caviar **holds the money as escrow**",
        "",
        "⚠️ Do **NOT** pay the seller directly.",
        "",
        "**🚚 Shipping (UPS ONLY – for now)**",
        "After payment proof is accepted:",
        "1) Upload a **UPS shipping label**",
        "2) Provide a **UPS tracking number** (must start with `1Z`)",
        "",
        "⚠️ **Only UPS labels are accepted at this time**",
        "",
        "---",
        "## 5️⃣ Escrow & Release of Funds",
        "",
        "• Funds are released to the seller **only after delivery**",
        "• After delivery there is a **48-hour complaint window**:",
        "  - No issues reported → seller is paid",
        "  - Any issue → staff steps in",
        "",
        "---",
        "## 6️⃣ Key Rules",
        "",
        "❌ No direct payments to sellers",
        "❌ No reused/incorrect shipping labels",
        "❌ No leaving fulfilled WTBs active",
        "✅ Always upload payment & label through the bot",
        "✅ Report issues within **48 hours** after delivery",
        "",
        "If anything is unclear or you run into issues, **contact staff immediately**.",
      ].join("\n")
    )
    .setFooter({ text: GUIDE_EMBED_IDENTIFIER })
    .setTimestamp();
}

/**
 * Finds an existing guide message:
 * - If GUIDE_MESSAGE_ID exists: fetch it
 * - else: searches recent messages for our embed footer identifier + authored by this bot
 */
async function findExistingGuideMessage(channel, client) {
  // 1) If message id is known, fetch directly
  if (GUIDE_MESSAGE_ID) {
    try {
      const msg = await channel.messages.fetch(GUIDE_MESSAGE_ID);
      return msg ?? null;
    } catch {
      // message might be deleted or invalid id
    }
  }

  // 2) Otherwise scan recent messages
  try {
    const batch = await channel.messages.fetch({ limit: 50 });
    const botId = client.user?.id;

    for (const [, msg] of batch) {
      if (botId && msg.author?.id !== botId) continue;
      if (!msg.embeds?.length) continue;

      const match = msg.embeds.some((e) => e?.footer?.text === GUIDE_EMBED_IDENTIFIER);
      if (match) return msg;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Ensures the guide message exists in the guide channel:
 * - edits existing
 * - or posts new
 */
export async function ensureMemberWtbGuideMessage(client) {
  if (!GUIDE_CHANNEL_ID) {
    console.warn("[MemberWTB Guide] Missing GUIDE_CHANNEL_ID env var.");
    return null;
  }

  const channel = await client.channels.fetch(GUIDE_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.warn("[MemberWTB Guide] Guide channel not found or not text-based.");
    return null;
  }

  const embed = buildMemberWtbGuideEmbed();
  const existing = await findExistingGuideMessage(channel, client);

  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => null);
    console.log("[MemberWTB Guide] Updated existing guide message:", existing.id);
    return existing;
  }

  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) {
    console.log("[MemberWTB Guide] Posted new guide message:", sent.id);
    console.log(
      "[MemberWTB Guide] Tip: set GUIDE_MESSAGE_ID env var to this id to always edit the same message."
    );
  }
  return sent;
}

/**
 * Optional helper to auto-run on ready if you want to register it like other features.
 * Call registerMemberWtbGuideMessage(client) somewhere in your bootstrap.
 */
export function registerMemberWtbGuideMessage(client) {
  client.once(Events.ClientReady, async () => {
    await ensureMemberWtbGuideMessage(client);
  });
}

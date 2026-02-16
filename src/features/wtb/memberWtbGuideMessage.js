// src/features/wtb/memberWtbGuideMessage.js
// Discord.js v14 (ESM)
//
// Purpose:
// - Ensure the "Member WTBs – Buyer Guide" message exists in your Guide channel.
// - If it already exists (same identifier), edit it.
// - If not, post it.
// - Uses MULTIPLE embeds to avoid Discord's 4096-char embed description limit.
//
// ENV:
//   GUIDE_CHANNEL_ID=123...
//   GUIDE_MESSAGE_ID= (optional) message id to always edit the same message
//
// Usage:
//   import { registerMemberWtbGuideMessage } from "./memberWtbGuideMessage.js";
//   registerMemberWtbGuideMessage(client);

import { EmbedBuilder, Events } from "discord.js";

const GUIDE_CHANNEL_ID = process.env.GUIDE_CHANNEL_ID;
const GUIDE_MESSAGE_ID = process.env.GUIDE_MESSAGE_ID || null;
const KC_EMBED_COLOR = 0xFFD400; // Kickz Caviar yellow

// Embed identifier used to find/update the right message later.
const GUIDE_EMBED_IDENTIFIER = "kc:member-wtb-buyer-guide:v1";

/**
 * Build multiple embeds (single message) so we don't exceed 4096 char limit.
 * Discord limits:
 * - Each embed description <= 4096 chars
 * - Up to 10 embeds per message
 */
function buildMemberWtbGuideEmbeds() {
  const embed1 = new EmbedBuilder()
    .setColor(KC_EMBED_COLOR)
    .setTitle("📦 Member WTBs – Buyer Guide")
    .setDescription(
      [
        "Welcome to **Member WTB's**!",
        "",
        "Get your WTB's shared across our entire network of Members, Consignors, and Suppliers to source your item with the **least effort** and at the **best possible price**. Always shipped fast and clean boxed.",
        "",
        "This guide explains **how to post a Want To Buy (WTB)**, how the process works once a seller is matched, and how **payment & escrow** are handled.",
        "",
        "Please read this carefully before posting.",
        "",
        "---",
        "## 1️⃣ How to Post a Member WTB",
        "",
        "• Go to <#1421660116846907513>",
        "• There you will find **two ways** to post WTB's",
        "",
        "**✅ Option A — Single WTB**",
        "Use the **WTB post button / form** and fill in:",
        "• SKU",
        "• Size",
        "• Minimum Price",
        "• Maximum Price",
        "",
        "Once submitted, your WTB becomes visible to sellers immediately.",
        "",
        "**✅ Option B — CSV Upload (Multiple WTBs)**",
        "If you want to post **multiple WTBs at once**:",
        "1) Download the **CSV template**",
        "2) Fill it in (**1 row = 1 WTB**)",
        "3) Upload the file by dropping it in the channel",
        "",
        "⚠️ **Important:** Only use the official template. Changing columns or formats may cause the upload to fail.",
        "",
        "Your WTB price will gradually increase over time (**12 hours**) from **Minimum Price** to **Maximum Price**, similar to our **Quick Deals** system.",
      ].join("\n")
    )
    // Put the identifier only on the FIRST embed footer so we can reliably find it later.
    .setFooter({ text: GUIDE_EMBED_IDENTIFIER })
    .setTimestamp();

  const embed2 = new EmbedBuilder()
    .setColor(KC_EMBED_COLOR)
    .setTitle("📌 Duration, Pricing & Cancels")
    .setDescription(
      [
        "⏱️ **WTB Duration & Pricing Rules**",
        "",
        "• Member WTBs are **active for 24 hours only**",
        "• If no seller match occurs within 24 hours, the WTB **expires automatically**",
        "",
        "To try again:",
        "• You must **post a new WTB**",
        "• Increasing your price is strongly recommended if no match occurred",
        "",
        "⚠️ **Lowballing is NOT allowed**",
        "Member WTBs are shared across **our entire network**, including partner groups.",
        "Posting unrealistic or below-market prices damages our reputation.",
        "",
        "❌ This includes:",
        "• Reposting the same pair repeatedly with bad prices",
        "• Spamming expired WTBs without meaningful price adjustments",
        "",
        "🚫 Lowballing or repeated abuse may result in:",
        "• Removal of Member WTB access",
        "• Temporary suspension",
        "• Permanent bans in severe cases",
        "",
        "---",
        "## 2️⃣ Cancelling an Active WTB",
        "",
        "If you **find the item elsewhere** or no longer need it:",
        "• **Cancel the WTB immediately**",
        "• Do **not** leave WTBs active if you already sourced the item",
        "",
        "⚠️ **Important rule**",
        "Once your WTB is **matched to a seller**, the deal is considered **final**.",
        "Flaking, backing out, or refusing to proceed **after a seller match is NOT allowed**.",
        "",
        "Why this matters:",
        "• Sellers reserve stock specifically for your WTB",
        "• Backing out causes direct financial damage",
        "• It breaks trust in the marketplace",
        "",
        "❌ Repeated or intentional flaking may result in:",
        "• Temporary suspension from Member WTBs",
        "• Permanent bans in severe cases",
        "",
        "👉 Use the **Cancel WTB** option in <#1421660116846907513> **before a seller is matched**.",
        "You will receive a DM to choose which active WTBs you wish to cancel.",
      ].join("\n")
    );

  const embed3 = new EmbedBuilder()
    .setColor(KC_EMBED_COLOR)
    .setTitle("💰 Payment, Label & Escrow")
    .setDescription(
      [
        "## 3️⃣ What Happens When a Seller Matches Your WTB",
        "",
        "Once a seller claims your WTB:",
        "• A **private deal channel** is created for the seller",
        "• The seller confirms the item and uploads proof",
        "• Staff reviews and confirms the deal",
        "",
        "After admin confirmation, **you will receive a DM from the bot** to continue the flow.",
        "",
        "⚠️ All sellers must ship within 24-48 hours after they receive the shipping label. Monitored by **Kickz Caviar**",
        "",
        "---",
        "## 4️⃣ Payment & Shipping Flow (IMPORTANT)",
        "",
        "**💰 Payment (Escrow)**",
        "• Payment is **ALWAYS upfront**",
        "• You upload **payment proof** via the button in the DM",
        "• Kickz Caviar **holds the money as escrow**",
        "",
        "⚠️ You do **NOT** pay the seller directly — your money is safe.",
        "",
        "**🚚 Shipping (UPS ONLY – for now)**",
        "After payment proof is accepted:",
        "1) Provide a **UPS tracking number**",
        "2) Upload a **UPS shipping label** by dropping the file in DM",
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
        "⚠️ Open a **Support Ticket** in <#1444838494760603769> to file a complaint.",
        "**NEVER** send complaints via DM — they will not be reviewed and lose validation.",
        "",
        "---",
        "## 6️⃣ Key Rules",
        "",
        "❌ No direct payments to sellers",
        "❌ No reused or incorrect shipping labels",
        "❌ No leaving fulfilled WTBs active",
        "✅ Always upload payment & label through the bot",
        "✅ Report issues within **48 hours** after delivery",
        "",
        "If anything is unclear or you run into issues, **contact staff immediately**.",
      ].join("\n")
    );

  return [embed1, embed2, embed3];
}

/**
 * Finds an existing guide message:
 * - If GUIDE_MESSAGE_ID exists: fetch it directly
 * - else: searches recent messages for our embed footer identifier (authored by the bot)
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

      const hasIdentifier = msg.embeds.some((e) => e?.footer?.text === GUIDE_EMBED_IDENTIFIER);
      if (hasIdentifier) return msg;
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

  const embeds = buildMemberWtbGuideEmbeds();

  const existing = await findExistingGuideMessage(channel, client);
  if (existing) {
    try {
      await existing.edit({ embeds });
      console.log("[MemberWTB Guide] Updated existing guide message:", existing.id);
      return existing;
    } catch (e) {
      console.error("[MemberWTB Guide] Failed to edit existing guide message:", e?.message || e);
      return null;
    }
  }

  try {
    const sent = await channel.send({ embeds });
    console.log("[MemberWTB Guide] Posted new guide message:", sent.id);
    console.log(
      "[MemberWTB Guide] Tip: set GUIDE_MESSAGE_ID env var to this id to always edit the same message."
    );
    return sent;
  } catch (e) {
    console.error("[MemberWTB Guide] Failed to post new guide message:", e?.message || e);
    return null;
  }
}

/**
 * Auto-run on ready (register like your other features)
 */
export function registerMemberWtbGuideMessage(client) {
  client.once(Events.ClientReady, async () => {
    await ensureMemberWtbGuideMessage(client);
  });
}

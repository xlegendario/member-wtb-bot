// src/features/wtb/expireWtbs.js
// Enforces: Member WTBs expire after 24h ONLY when Fulfillment Status is Pending/Outsource
// and there is NO active claim (Claimed Channel ID blank).
//
// On expiry:
// - Airtable Fulfillment Status -> "Expired"
// - Discord listing message buttons disabled
// - Optionally prefixes embed title with "⏱️ EXPIRED • "

import { ChannelType } from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";

const WTB_TABLE = CONFIG.wtbTable || "Member WTBs";

// ---- Airtable field names (change if yours differ) ----
const FIELD_STATUS = "Fulfillment Status";
const FIELD_CREATED_TIME = "Created Time"; // Airtable "Created time" field (must exist)
const FIELD_CLAIMED_CHANNEL_ID = "Claimed Channel ID";
const FIELD_CLAIM_MESSAGE_ID = "Claim Message ID";
const FIELD_WTB_CHANNEL_ID = "WTB Channel ID"; // optional (if you store it)

// ---- Settings ----
const EXPIRY_HOURS = Number(process.env.MEMBER_WTB_EXPIRY_HOURS || 24);
const INTERVAL_MINUTES = Number(process.env.MEMBER_WTB_EXPIRY_SWEEP_MINUTES || 10);

// Where listing messages are posted (fallback if FIELD_WTB_CHANNEL_ID is not stored)
const DEFAULT_WTB_LISTINGS_CHANNEL_ID =
  process.env.MEMBER_WTB_LISTINGS_CHANNEL_ID || process.env.DISCORD_MEMBER_WTB_CHANNEL_ID || null;

// Status value to set when expiring
const EXPIRED_STATUS_VALUE = "Expired";

function s(v) {
  return v === undefined || v === null ? "" : String(v);
}

function parseAirtableDate(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

// Disable all buttons/components on the message
function disableComponents(components = []) {
  return components.map((row) => ({
    type: 1, // ActionRow
    components: (row.components || []).map((c) => ({
      ...c,
      disabled: true,
    })),
  }));
}

export async function sweepExpiredMemberWtbs(client) {
  // Filter ONLY: Pending / Outsource, no claimed channel, older than expiry hours
  const formula = `AND(
    OR(
      {${FIELD_STATUS}} = "Pending",
      {${FIELD_STATUS}} = "Outsource"
    ),
    {${FIELD_CLAIMED_CHANNEL_ID}} = BLANK(),
    DATETIME_DIFF(NOW(), {${FIELD_CREATED_TIME}}, 'hours') >= ${EXPIRY_HOURS}
  )`;

  let records = [];
  try {
    records = await base(WTB_TABLE)
      .select({
        filterByFormula: formula,
        maxRecords: 100,
      })
      .all();
  } catch (e) {
    console.error("[WTB Expiry] Airtable query failed:", e?.message || e);
    return;
  }

  if (!records.length) return;

  for (const rec of records) {
    const recordId = rec.id;

    try {
      // Extra safety: if Created Time is missing, skip to avoid false expiry
      const createdAt = parseAirtableDate(rec.get(FIELD_CREATED_TIME));
      if (!createdAt) {
        console.warn(`[WTB Expiry] Missing/invalid Created Time for record=${recordId}, skipping.`);
        continue;
      }

      const messageId = s(rec.get(FIELD_CLAIM_MESSAGE_ID)).trim();
      const channelId =
        s(rec.get(FIELD_WTB_CHANNEL_ID)).trim() || s(DEFAULT_WTB_LISTINGS_CHANNEL_ID).trim();

      // 1) Update Airtable status -> Expired
      await base(WTB_TABLE).update([
        {
          id: recordId,
          fields: {
            [FIELD_STATUS]: EXPIRED_STATUS_VALUE,
          },
        },
      ]);

      // 2) If we can't edit the message, we're still fine (Airtable is correct)
      if (!messageId || !channelId) {
        console.warn(
          `[WTB Expiry] Expired Airtable but cannot edit Discord (missing messageId/channelId). record=${recordId}`
        );
        continue;
      }

      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) {
        console.warn(`[WTB Expiry] Channel not found/not GuildText: ${channelId} record=${recordId}`);
        continue;
      }

      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (!msg) {
        console.warn(`[WTB Expiry] Message not found: ${messageId} record=${recordId}`);
        continue;
      }

      const newComponents = disableComponents(msg.components);

      // Optional: prefix embed title with EXPIRED
      const embeds = msg.embeds?.map((e) => {
        const data = e.toJSON();
        if (data?.title && !data.title.includes("EXPIRED")) {
          data.title = `⏱️ EXPIRED • ${data.title}`;
        }
        return data;
      });

      await msg.edit({
        embeds: embeds?.length ? embeds : undefined,
        components: newComponents,
      });

      console.log(`[WTB Expiry] Expired + disabled buttons: record=${recordId} msg=${messageId}`);
    } catch (e) {
      console.error("[WTB Expiry] Failed processing record:", recordId, e?.message || e);
    }
  }
}

export function registerMemberWtbExpirySweep(client) {
  client.once("ready", async () => {
    console.log(
      `[WTB Expiry] Enabled: every ${INTERVAL_MINUTES} min | expiry=${EXPIRY_HOURS}h | statuses: Pending/Outsource -> Expired`
    );

    // Run shortly after startup
    setTimeout(() => sweepExpiredMemberWtbs(client), 15_000);

    // Then keep running
    setInterval(() => sweepExpiredMemberWtbs(client), INTERVAL_MINUTES * 60 * 1000);
  });
}

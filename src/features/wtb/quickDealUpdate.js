import { EmbedBuilder } from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";

const WTB_TABLE = CONFIG.wtbTable;

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).replace("€", "").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// If we only have Claim Message URL, we can extract channelId + messageId
function parseDiscordMsgUrl(url) {
  // https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const m = String(url || "").match(/discord\.com\/channels\/\d+\/(\d+)\/(\d+)/);
  if (!m) return { channelId: null, messageId: null };
  return { channelId: m[1], messageId: m[2] };
}

export function registerMemberWtbQuickDealUpdate(app, client) {
  app.post("/member-wtb/quick-deal/update", async (req, res) => {
    try {
      const {
        recordId,
        currentPayout,
        maxPayout,
        currentPayoutVat0,
        maxPayoutVat0,
        timeToMaxPayout
      } = req.body || {};

      if (!recordId) return res.status(400).send("Missing recordId");

      // pull record so we can find message pointers
      const rec = await base(WTB_TABLE).find(recordId);

      const claimMsgUrl = rec.get("Claim Message URL");
      const claimMsgId = rec.get("Claim Message ID");

      // Resolve channelId + messageId
      let channelId = null;
      let messageId = null;

      if (claimMsgUrl) {
        const parsed = parseDiscordMsgUrl(claimMsgUrl);
        channelId = parsed.channelId;
        messageId = parsed.messageId;
      }

      // fallback if url missing but ID exists (still need channel from url)
      if (!messageId && claimMsgId) messageId = String(claimMsgId);

      if (!channelId || !messageId) {
        return res.status(200).json({
          ok: true,
          skipped: true,
          reason: "Missing Claim Message URL/ID on Airtable record"
        });
      }

      // fetch msg
      const guild = await client.guilds.fetch(CONFIG.guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel?.isTextBased()) return res.status(404).send("Channel not found");

      const msg = await channel.messages.fetch(messageId).catch(() => null);
      if (!msg || !msg.embeds?.length) {
        return res.status(404).send("Message/embed not found");
      }

      // old embed -> new embed
      const old = msg.embeds[0];
      const e = EmbedBuilder.from(old);

      // Values (prefer payload, fallback to Airtable fields if you want)
      const cp = toNumber(currentPayout);
      const mp = toNumber(maxPayout);
      const cp0 = toNumber(currentPayoutVat0);
      const mp0 = toNumber(maxPayoutVat0);

      // Keep your clean format like your main quick deals
      const curLine =
        `${cp != null ? `€${cp} (Margin/VAT21)` : `- (Margin/VAT21)`} / ` +
        `${cp0 != null ? `€${cp0} (VAT0)` : `- (VAT0)`}`;

      const maxLine =
        `${mp != null ? `€${mp} (Margin/VAT21)` : `- (Margin/VAT21)`} / ` +
        `${mp0 != null ? `€${mp0} (VAT0)` : `- (VAT0)`}`;

      const fields = [
        { name: "Current Payout", value: curLine, inline: true },
        { name: "Max Payout", value: maxLine, inline: true },
        { name: "Time to Max Payout", value: timeToMaxPayout || "—", inline: false }
      ];

      e.setFields(fields);

      await msg.edit({ embeds: [e] });

      return res.json({ ok: true, channelId, messageId });
    } catch (err) {
      console.error("❌ /member-wtb/quick-deal/update failed:", err);
      return res.status(500).send("Internal Server Error");
    }
  });
}

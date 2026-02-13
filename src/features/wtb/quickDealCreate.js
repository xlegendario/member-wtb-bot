import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";

/* ---------------- Brand routing ---------------- */

function normalizeBrand(brand) {
  const b = String(brand || "").toLowerCase();
  if (b.includes("jordan")) return "jordan";
  if (b.includes("nike")) return "nike";
  if (b.includes("adidas")) return "adidas";
  if (b.includes("new balance")) return "new balance";
  if (b.includes("asics")) return "asics";
  if (b.includes("ugg")) return "ugg";
  return "other";
}

const MEMBER_WTB_DEFAULT_CHANNEL_ID =
  process.env.MEMBER_WTB_QUICK_DEALS_DEFAULT_CHANNEL_ID;

const MEMBER_WTB_BRAND_CHANNEL_MAP = (() => {
  try {
    return new Map(Object.entries(
      JSON.parse(process.env.MEMBER_WTB_QUICK_DEALS_BRAND_CHANNEL_MAP || "{}")
    ));
  } catch {
    return new Map();
  }
})();

function pickMemberWtbChannelId(brand) {
  const key = normalizeBrand(brand);
  return (
    MEMBER_WTB_BRAND_CHANNEL_MAP.get(key) ||
    MEMBER_WTB_DEFAULT_CHANNEL_ID
  );
}

/* ---------------- API ---------------- */

export function registerMemberWtbQuickDealCreate(app, client) {
  app.post("/member-wtb/quick-deal/create", async (req, res) => {
    try {
      const {
        recordId,
        sku,
        size,
        brand,
        currentPayout,
        maxPayout,
        timeToMaxPayout,
        imageUrl
      } = req.body || {};

      if (!recordId || !sku || !size) {
        return res.status(400).send("Missing recordId / sku / size");
      }

      const channelId = pickMemberWtbChannelId(brand);
      if (!channelId) {
        return res.status(400).send("No Member WTB Quick Deal channel resolved");
      }

      const guild = await client.guilds.fetch(CONFIG.guildId);
      const channel = await guild.channels.fetch(channelId);

      if (!channel || !channel.isTextBased()) {
        return res.status(404).send("Target channel not found or not text-based");
      }

      const embed = new EmbedBuilder()
        .setTitle("⚡ Quick Deal (Member WTB)")
        .setColor(0xffed00)
        .setDescription(
          `**SKU:** ${String(sku).trim().toUpperCase()}\n` +
          `**Size:** ${String(size).trim()}\n` +
          `**Brand:** ${brand || "—"}`
        )
        .addFields(
          {
            name: "Current Payout",
            value: currentPayout != null ? `€${currentPayout}` : "—",
            inline: true
          },
          {
            name: "Max Payout",
            value: maxPayout != null ? `€${maxPayout}` : "—",
            inline: true
          },
          {
            name: "Time to Max Payout",
            value: timeToMaxPayout || "—",
            inline: false
          }
        );

      if (imageUrl) embed.setImage(imageUrl);

      const claimBtn = new ButtonBuilder()
        .setCustomId(`member_wtb_claim_${recordId}`)
        .setLabel("Claim Deal")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(claimBtn);

      const msg = await channel.send({
        embeds: [embed],
        components: [row]
      });

      const messageUrl = `https://discord.com/channels/${CONFIG.guildId}/${channel.id}/${msg.id}`;

      await base(CONFIG.wtbTable).update(recordId, {
        "Claim Message ID": msg.id,
        "Claim Message URL": messageUrl
      });

      return res.json({
        ok: true,
        channelId: channel.id,
        messageId: msg.id,
        messageUrl
      });
    } catch (err) {
      console.error("❌ Member WTB Quick Deal create failed:", err);
      return res.status(500).send("Internal Server Error");
    }
  });
}

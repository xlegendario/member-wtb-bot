import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";

export function registerMemberWtbQuickDealCreate(app, client) {
  app.post("/member-wtb/quick-deal/create", async (req, res) => {
    try {
      const {
        recordId,
        sku,
        size,
        currentPayout,
        maxPayout,
        timeToMaxPayout,
        imageUrl
      } = req.body || {};

      if (!recordId || !sku || !size) {
        return res.status(400).send("Missing recordId/sku/size");
      }

      const guild = await client.guilds.fetch(CONFIG.guildId);
      const channel = await guild.channels.fetch(CONFIG.memberWtbQuickDealsChannelId);

      if (!channel || !channel.isTextBased()) {
        return res.status(404).send("Member WTB Quick Deals channel not found or not text-based");
      }

      const embed = new EmbedBuilder()
        .setTitle("⚡ Quick Deal (Member WTB)")
        .setColor(0xffed00)
        .setDescription(
          `**SKU:** ${String(sku).trim().toUpperCase()}\n` +
          `**Size:** ${String(size).trim()}`
        )
        .addFields(
          { name: "Current Payout", value: currentPayout != null ? `€${currentPayout}` : "-", inline: true },
          { name: "Max Payout", value: maxPayout != null ? `€${maxPayout}` : "-", inline: true },
          { name: "Time to Max Payout", value: timeToMaxPayout || "—", inline: false }
        );

      if (imageUrl) embed.setImage(imageUrl);

      const claimBtn = new ButtonBuilder()
        .setCustomId(`member_wtb_claim_${recordId}`)
        .setLabel("Claim Deal")
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(claimBtn);

      const msg = await channel.send({ embeds: [embed], components: [row] });

      const messageUrl = `https://discord.com/channels/${CONFIG.guildId}/${channel.id}/${msg.id}`;

      // Save back to Airtable (make sure these fields exist on Member WTBs)
      await base(CONFIG.wtbTable).update(recordId, {
        "Claim Message ID": msg.id,
        "Claim Message URL": messageUrl
      });

      return res.json({ ok: true, messageId: msg.id, messageUrl });
    } catch (err) {
      console.error("❌ /member-wtb/quick-deal/create failed:", err);
      return res.status(500).send("Internal Server Error");
    }
  });
}

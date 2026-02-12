import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { CONFIG } from "../../config.js";

export const BTN_SINGLE = "wtb_single_btn";

export async function postWtbEmbedToChannel(client) {
  const channel = await client.channels.fetch(CONFIG.wtbChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) throw new Error("WTB channel not found or not text-based");

  const embed = new EmbedBuilder()
    .setTitle("📥 Member WTB Upload")
    .setDescription(
      [
        "**Add WTBs in 2 ways:**",
        "",
        "1) Click **➕ Add Single Pair**",
        "2) Drop a **CSV** in this channel (**it will be deleted after processing**)",
        "",
        "**CSV headers required:** `SKU, Size, Min Price, Max Price`"
      ].join("\n")
    );

  const templateUrl = `${CONFIG.publicBaseUrl}/wtb_template.csv`;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_SINGLE)
      .setLabel("➕ Add Single Pair")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setLabel("⬇️ Download CSV Template")
      .setStyle(ButtonStyle.Link)
      .setURL(templateUrl)
  );

  await channel.send({
    embeds: [embed],
    components: [row]
  });
}

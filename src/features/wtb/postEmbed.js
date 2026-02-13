import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CONFIG } from "../../config.js";

export const BTN_SINGLE = "member_wtb_add_single_pair";
export const EMBED_TITLE = "📥 Member WTB Upload";

export async function postWtbEmbedToChannel(client) {
  const guild = await client.guilds.fetch(CONFIG.guildId);
  const channel = await guild.channels.fetch(CONFIG.wtbChannelId);

  if (!channel || !channel.isTextBased()) {
    console.warn("WTB channel not found or not text-based:", CONFIG.wtbChannelId);
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(EMBED_TITLE)
    .setColor(0xffed00)
    .setDescription(
      "**Add WTBs in 2 ways:**\n\n" +
      "1) Click ➕ **Add Single Pair**\n" +
      "2) Drop a **CSV** in this channel, using the template below\n\n" +
      "**All CSV headers required:** `SKU, Size, Min Price, Max Price`"
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(BTN_SINGLE)
      .setLabel("Add Single Pair")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel("Download CSV Template")
      .setStyle(ButtonStyle.Link)
      .setURL(`${CONFIG.publicBaseUrl.replace(/\/$/, "")}/wtb_template.csv`)
  );

  let headerMsg = null;

  try {
    const pinned = await channel.messages.fetchPinned();
    headerMsg =
      pinned.find((m) =>
        m.author?.id === client.user.id &&
        m.embeds?.[0]?.title === EMBED_TITLE
      ) || null;
  } catch (e) {
    console.warn("Could not fetch pinned messages (missing permission?)", e?.message);
  }

  if (!headerMsg) {
    try {
      const recent = await channel.messages.fetch({ limit: 25 });
      headerMsg =
        recent.find((m) =>
          m.author?.id === client.user.id &&
          m.embeds?.[0]?.title === EMBED_TITLE
        ) || null;
    } catch (e) {
      console.warn("Could not fetch recent messages", e?.message);
    }
  }

  if (headerMsg) {
    await headerMsg.edit({ embeds: [embed], components: [row] });
    return;
  }

  const sent = await channel.send({ embeds: [embed], components: [row] });

  try {
    await sent.pin();
  } catch (e) {
    console.warn("Could not pin header message. Give bot Manage Messages permission.", e?.message);
  }
}

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { CONFIG } from "../../config.js";

export async function postWtbEmbedToChannel(client) {
  const guild = await client.guilds.fetch(CONFIG.guildId);
  const channel = await guild.channels.fetch(CONFIG.wtbChannelId);

  if (!channel || !channel.isTextBased()) {
    console.warn("WTB channel not found or not text-based:", CONFIG.wtbChannelId);
    return;
  }

  // --- Build embed + buttons (keep your exact wording if you want) ---
  const embed = new EmbedBuilder()
    .setTitle("📥 Member WTB Upload")
    .setColor(0xffed00)
    .setDescription(
      "**Add WTBs in 2 ways:**\n\n" +
      "1) Click ➕ **Add Single Pair**\n" +
      "2) Drop a **CSV** in this channel, using the template below\n\n" +
      "**All CSV headers required:** `SKU, Size, Min Price, Max Price`"
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("member_wtb_add_single_pair")
      .setLabel("Add Single Pair")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setLabel("Download CSV Template")
      .setStyle(ButtonStyle.Link)
      .setURL(`${CONFIG.publicBaseUrl.replace(/\/$/, "")}/wtb_template.csv`)
  );

  // --- 1) Try to reuse pinned header message ---
  let headerMsg = null;

  try {
    const pinned = await channel.messages.fetchPinned();
    headerMsg =
      pinned.find((m) =>
        m.author?.id === client.user.id &&
        m.embeds?.[0]?.title === "📥 Member WTB Upload"
      ) || null;
  } catch (e) {
    console.warn("Could not fetch pinned messages (missing permission?)", e?.message);
  }

  // --- 2) If no pinned header found, try to find an existing one in recent history ---
  if (!headerMsg) {
    try {
      const recent = await channel.messages.fetch({ limit: 25 });
      headerMsg =
        recent.find((m) =>
          m.author?.id === client.user.id &&
          m.embeds?.[0]?.title === "📥 Member WTB Upload"
        ) || null;
    } catch (e) {
      console.warn("Could not fetch recent messages", e?.message);
    }
  }

  // --- 3) Edit if found, else send new and pin it ---
  if (headerMsg) {
    await headerMsg.edit({ embeds: [embed], components: [row] });
    return;
  }

  const sent = await channel.send({ embeds: [embed], components: [row] });

  // Pin it (requires Manage Messages permission)
  try {
    await sent.pin();
  } catch (e) {
    console.warn("Could not pin header message. Give bot Manage Messages permission.", e?.message);
  }
}

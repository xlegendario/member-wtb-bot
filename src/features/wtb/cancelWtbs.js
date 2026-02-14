import {
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ComponentType
} from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";
import { BTN_CANCEL_WTBS } from "./postEmbed.js";
import { findSellerRecordIdByDiscordId } from "../../airtable/sellers.js";

// Airtable fields (change ONLY if your names differ)
const WTB_TABLE = CONFIG.wtbTable; // "Member WTBs"
const FIELD_STATUS = "Fulfillment Status";
const FIELD_SKU = "SKU (API)"; // you said this is the right one
const FIELD_SIZE = "Size";
const FIELD_CLAIM_MESSAGE_ID = "Claim Message ID";
const FIELD_CLAIM_MESSAGE_URL = "Claim Message URL";

// Status values
const ACTIVE_STATUSES = ["Outsource", "Claim Processing"]; // adjust if you also treat others as "active"
const CANCELLED_STATUS = "Cancelled";

function extractDiscordIdsFromUrl(url) {
  // https://discord.com/channels/<guild>/<channel>/<message>
  const m = String(url || "").match(/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

async function disableListingClaimButton(client, recordId, claimMessageUrl, claimMessageId) {
  try {
    const ids = extractDiscordIdsFromUrl(claimMessageUrl);
    if (!ids?.channelId || !ids?.messageId) return;

    const guild = await client.guilds.fetch(ids.guildId).catch(() => null);
    if (!guild) return;

    const channel = await guild.channels.fetch(ids.channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const msg = await channel.messages.fetch(ids.messageId).catch(() => null);
    if (!msg) return;

    // Disable only our claim button; keep other components if any
    const newComponents = (msg.components || []).map((row) => {
      const built = ActionRowBuilder.from(row);
      built.components = built.components.map((c) => {
        // Only disable the member_wtb_claim_<recordId> button
        if (c.data?.custom_id === `member_wtb_claim_${recordId}`) {
          return ButtonBuilder.from(c).setDisabled(true).setStyle(ButtonStyle.Secondary);
        }
        return c;
      });
      return built;
    });

    await msg.edit({ components: newComponents });
  } catch (e) {
    console.warn("Could not disable listing claim button:", e?.message || e);
  }
}

async function fetchActiveWtbsForSeller(sellerRecordId) {
  // Filter formula: OR(status="Outsource", status="Claim Processing")
  const statusOr = ACTIVE_STATUSES.map((s) => `{${FIELD_STATUS}}="${s}"`).join(", ");
  const filterByFormula =
    `AND(` +
    `OR(${statusOr}),` +
    // linked record field name is assumed "Seller" — we avoid guessing by using recordId match on linked field array
    // so we'll filter in JS after fetching a reasonable batch
    `TRUE()` +
    `)`;

  // We cannot reliably filter linked record by id in formula without your exact field name, so:
  // - fetch recent records in active statuses
  // - filter by linked seller in JS
  const records = await base(WTB_TABLE)
    .select({
      filterByFormula,
      maxRecords: 200 // increase if needed
    })
    .firstPage();

  const out = [];
  for (const r of records) {
    const linked = r.get("Seller") || r.get("Seller ID") || r.get("Seller Record") || null;
    // linked record fields are arrays of record IDs
    const ids = Array.isArray(linked) ? linked : [];
    if (!ids.includes(sellerRecordId)) continue;

    out.push({
      id: r.id,
      sku: String(r.get(FIELD_SKU) || "").trim(),
      size: String(r.get(FIELD_SIZE) || "").trim(),
      status: String(r.get(FIELD_STATUS) || "").trim(),
      claimMessageUrl: String(r.get(FIELD_CLAIM_MESSAGE_URL) || "").trim(),
      claimMessageId: String(r.get(FIELD_CLAIM_MESSAGE_ID) || "").trim()
    });
  }

  return out;
}

function buildDmEmbed(items, selectedIds) {
  const lines = items.map((it, idx) => {
    const n = idx + 1;
    const sku = it.sku || "—";
    const size = it.size || "—";
    const selectedMark = selectedIds.has(it.id) ? "✅ " : "";
    return `${selectedMark}**${n}.** \`${sku}\` — **${size}**`;
  });

  const selectedLines = items
    .filter((it) => selectedIds.has(it.id))
    .map((it) => `• \`${it.sku || "—"}\` — **${it.size || "—"}**`);

  const embed = new EmbedBuilder()
    .setTitle("Your active WTBs")
    .setDescription(lines.length ? lines.join("\n") : "No active WTBs found.")
    .addFields({
      name: "Selected to cancel",
      value: selectedLines.length ? selectedLines.join("\n") : "—"
    })
    .setColor(0xff0000);

  return embed;
}

export function registerCancelWtbs(client) {
  // per-user state: selected IDs
  const selectedByUser = new Map(); // userId -> Set(recordId)
  const cacheByUser = new Map(); // userId -> items[]

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // 1) Click red button in server -> open DM panel
      if (interaction.isButton() && interaction.customId === BTN_CANCEL_WTBS) {
        await interaction.deferReply({ ephemeral: true }).catch(() => {});

        const sellerRecordId = await findSellerRecordIdByDiscordId(interaction.user.id);
        if (!sellerRecordId) {
          await interaction.editReply("❌ Your Discord ID is not found in **Sellers Database**.");
          return;
        }

        const items = await fetchActiveWtbsForSeller(sellerRecordId);

        cacheByUser.set(interaction.user.id, items);
        selectedByUser.set(interaction.user.id, new Set());

        if (!items.length) {
          await interaction.editReply("✅ You have no active WTBs right now.");
          return;
        }

        const embed = buildDmEmbed(items, selectedByUser.get(interaction.user.id));

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`wtb_cancel_select_${interaction.user.id}`)
          .setPlaceholder("Select WTBs to cancel…")
          .setMinValues(0)
          .setMaxValues(Math.min(25, items.length))
          .addOptions(
            items.slice(0, 25).map((it, idx) => ({
              label: `${idx + 1}. ${it.sku || "—"} (${it.size || "—"})`,
              value: it.id
            }))
          );

        const row1 = new ActionRowBuilder().addComponents(menu);

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`wtb_cancel_confirm_${interaction.user.id}`)
            .setLabel("Confirm Cancel")
            .setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`wtb_cancel_refresh_${interaction.user.id}`)
            .setLabel("Refresh")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`wtb_cancel_close_${interaction.user.id}`)
            .setLabel("Close")
            .setStyle(ButtonStyle.Secondary)
        );

        const dm = await interaction.user.createDM();
        await dm.send({ embeds: [embed], components: [row1, row2] });

        await interaction.editReply("✅ I sent you a DM with your active WTBs.");
        return;
      }

      // Only handle our DM interactions (guard)
      if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;

      // 2) Select menu updates selection
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith("wtb_cancel_select_")) {
        const userId = interaction.customId.replace("wtb_cancel_select_", "");
        if (interaction.user.id !== userId) {
          await interaction.reply({ content: "❌ This menu is not for you.", ephemeral: true }).catch(() => {});
          return;
        }

        const items = cacheByUser.get(userId) || [];
        const selected = new Set(interaction.values || []);
        selectedByUser.set(userId, selected);

        const embed = buildDmEmbed(items.slice(0, 25), selected);

        await interaction.update({ embeds: [embed] });
        return;
      }

      // 3) Refresh list
      if (interaction.isButton() && interaction.customId.startsWith("wtb_cancel_refresh_")) {
        const userId = interaction.customId.replace("wtb_cancel_refresh_", "");
        if (interaction.user.id !== userId) {
          await interaction.reply({ content: "❌ This panel is not for you.", ephemeral: true }).catch(() => {});
          return;
        }

        const sellerRecordId = await findSellerRecordIdByDiscordId(interaction.user.id);
        if (!sellerRecordId) {
          await interaction.reply({ content: "❌ Seller not found.", ephemeral: true }).catch(() => {});
          return;
        }

        const items = await fetchActiveWtbsForSeller(sellerRecordId);

        cacheByUser.set(userId, items);
        selectedByUser.set(userId, new Set());

        const embed = buildDmEmbed(items.slice(0, 25), selectedByUser.get(userId));

        const menu = new StringSelectMenuBuilder()
          .setCustomId(`wtb_cancel_select_${userId}`)
          .setPlaceholder("Select WTBs to cancel…")
          .setMinValues(0)
          .setMaxValues(Math.min(25, items.length))
          .addOptions(
            items.slice(0, 25).map((it, idx) => ({
              label: `${idx + 1}. ${it.sku || "—"} (${it.size || "—"})`,
              value: it.id
            }))
          );

        const row1 = new ActionRowBuilder().addComponents(menu);

        // keep same buttons row
        await interaction.update({ embeds: [embed], components: [row1, interaction.message.components[1]] });
        return;
      }

      // 4) Confirm cancel
      if (interaction.isButton() && interaction.customId.startsWith("wtb_cancel_confirm_")) {
        const userId = interaction.customId.replace("wtb_cancel_confirm_", "");
        if (interaction.user.id !== userId) {
          await interaction.reply({ content: "❌ This panel is not for you.", ephemeral: true }).catch(() => {});
          return;
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => {});
        const items = cacheByUser.get(userId) || [];
        const selected = selectedByUser.get(userId) || new Set();

        if (!selected.size) {
          await interaction.editReply("⚠️ Select at least 1 WTB to cancel.");
          return;
        }

        // Update Airtable + disable listing claim button
        for (const id of selected) {
          const it = items.find((x) => x.id === id);

          await base(WTB_TABLE)
            .update(id, {
              [FIELD_STATUS]: CANCELLED_STATUS
            })
            .catch((e) => console.warn("Airtable cancel failed:", e?.message || e));

          if (it?.claimMessageUrl) {
            await disableListingClaimButton(client, id, it.claimMessageUrl, it.claimMessageId);
          }
        }

        await interaction.editReply(`✅ Cancelled **${selected.size}** WTB(s).`);

        // Update DM message view: remove cancelled ones from list
        const remaining = items.filter((x) => !selected.has(x.id));
        cacheByUser.set(userId, remaining);
        selectedByUser.set(userId, new Set());

        const embed = buildDmEmbed(remaining.slice(0, 25), new Set());

        const components = [];
        if (remaining.length) {
          const menu = new StringSelectMenuBuilder()
            .setCustomId(`wtb_cancel_select_${userId}`)
            .setPlaceholder("Select WTBs to cancel…")
            .setMinValues(0)
            .setMaxValues(Math.min(25, remaining.length))
            .addOptions(
              remaining.slice(0, 25).map((it, idx) => ({
                label: `${idx + 1}. ${it.sku || "—"} (${it.size || "—"})`,
                value: it.id
              }))
            );
          components.push(new ActionRowBuilder().addComponents(menu));
          components.push(interaction.message.components[1]);
        } else {
          // no remaining: disable buttons
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("noop").setLabel("All WTBs cancelled").setStyle(ButtonStyle.Secondary).setDisabled(true)
          );
          components.push(row);
        }

        await interaction.message.edit({ embeds: [embed], components }).catch(() => {});
        return;
      }

      // 5) Close panel
      if (interaction.isButton() && interaction.customId.startsWith("wtb_cancel_close_")) {
        const userId = interaction.customId.replace("wtb_cancel_close_", "");
        if (interaction.user.id !== userId) {
          await interaction.reply({ content: "❌ This panel is not for you.", ephemeral: true }).catch(() => {});
          return;
        }

        await interaction.update({
          content: "Closed.",
          embeds: [],
          components: []
        }).catch(() => {});
        return;
      }
    } catch (e) {
      console.error("Cancel WTBs flow error:", e);
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: `❌ Error: ${e.message}`, ephemeral: true });
        }
      } catch {}
    }
  });
}

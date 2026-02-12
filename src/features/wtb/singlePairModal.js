import {
  Events,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { BTN_SINGLE } from "./postEmbed.js";
import { findSellerRecordIdByDiscordId } from "../../airtable/sellers.js";
import { createSingleWtb, toNumberOrNull } from "../../airtable/memberWtb.js";

const MODAL_SINGLE = "wtb_single_modal";

export function registerSinglePairModal(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      // button -> modal
      if (interaction.isButton() && interaction.customId === BTN_SINGLE) {
        const modal = new ModalBuilder()
          .setCustomId(MODAL_SINGLE)
          .setTitle("Add WTB Pair");

        const sku = new TextInputBuilder()
          .setCustomId("sku")
          .setLabel("SKU")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const size = new TextInputBuilder()
          .setCustomId("size")
          .setLabel("Size")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        const minP = new TextInputBuilder()
          .setCustomId("min")
          .setLabel("Min Price (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        const maxP = new TextInputBuilder()
          .setCustomId("max")
          .setLabel("Max Price (optional)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(sku),
          new ActionRowBuilder().addComponents(size),
          new ActionRowBuilder().addComponents(minP),
          new ActionRowBuilder().addComponents(maxP)
        );

        await interaction.showModal(modal);
        return;
      }

      // modal submit -> airtable create
      if (interaction.isModalSubmit() && interaction.customId === MODAL_SINGLE) {
        await interaction.deferReply({ ephemeral: true });

        const sku = interaction.fields.getTextInputValue("sku").trim().toUpperCase();
        const size = interaction.fields.getTextInputValue("size").trim();
        const minPrice = toNumberOrNull(interaction.fields.getTextInputValue("min"));
        const maxPrice = toNumberOrNull(interaction.fields.getTextInputValue("max"));

        if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
          await interaction.editReply("❌ Min Price cannot be greater than Max Price.");
          return;
        }

        const sellerRecordId = await findSellerRecordIdByDiscordId(interaction.user.id);
        if (!sellerRecordId) {
          await interaction.editReply("❌ Your Discord ID is not found in **Sellers Database**. Please register first.");
          return;
        }

        await createSingleWtb({ sellerRecordId, sku, size, minPrice, maxPrice });
        await interaction.editReply("✅ WTB pair added.");
      }
    } catch (e) {
      console.error(e);
      if (interaction.isRepliable()) {
        try { await interaction.reply({ content: `❌ Error: ${e.message}`, ephemeral: true }); } catch {}
      }
    }
  });
}

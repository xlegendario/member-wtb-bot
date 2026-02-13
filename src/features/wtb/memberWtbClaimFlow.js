let __memberWtbClaimFlowRegistered = false;
import {
  Events,
  ChannelType,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";

/**
 * REQUIRED Airtable fields in Member WTBs table:
 * - Fulfillment Status
 * - Claim Message ID
 * - Claim Message URL
 * - Claimed Channel ID
 * - Claimed Message ID
 * - Claimed Seller Discord ID
 * - Claimed Seller VAT Type
 * - Locked Payout
 * - Claimed Seller Confirmed?
 * - Picture (attachment) (optional, for listing image)
 *
 * REQUIRED fields in Sellers Database:
 * - Seller ID (e.g. SE-00001)
 * - Discord (username) OR Discord ID (whatever you use)
 */

// ---- CHANGE THESE IF YOUR FIELD NAMES DIFFER ----
const WTB_TABLE = CONFIG.wtbTable; // default "Member WTBs"
const SELLERS_TABLE = CONFIG.sellersTable; // default "Sellers Database"

const FIELD_FULFILLMENT_STATUS = "Fulfillment Status";
const FIELD_CLAIM_MESSAGE_ID = "Claim Message ID";
const FIELD_CLAIM_MESSAGE_URL = "Claim Message URL";
const FIELD_CLAIMED_CHANNEL_ID = "Claimed Channel ID";
const FIELD_CLAIMED_MESSAGE_ID = "Claimed Message ID";
const FIELD_CLAIMED_SELLER_DISCORD_ID = "Claimed Seller Discord ID";
const FIELD_CLAIMED_SELLER = "Claimed Seller"; // <-- LINKED RECORD field
const FIELD_CLAIMED_SELLER_VAT_TYPE = "Claimed Seller VAT Type";
const FIELD_LOCKED_PAYOUT = "Locked Payout";
const FIELD_CLAIMED_SELLER_CONFIRMED = "Claimed Seller Confirmed?";
const FIELD_PICTURE = "Picture";

// payouts (these MUST be the live/current payout fields on the Member WTBs record)
const FIELD_CURRENT_PAYOUT_MARGIN = "Current Payout";        // <-- change if your Airtable field is named differently
const FIELD_CURRENT_PAYOUT_VAT0 = "Current Payout VAT0";     // <-- change if your Airtable field is named differently

// locked fields (these are written when a seller claims)
const FIELD_LOCKED_PAYOUT_VAT0 = "Locked Payout VAT0";


// Discord config
const DEAL_CATEGORY_IDS = (process.env.MEMBER_WTB_DEAL_CATEGORY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// If you don’t have env for admin roles, hardcode like normal quick deals:
// const ADMIN_ROLE_IDS = ["942779423449579530", "1060615571118510191"];

function toChannelSlug(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 95);
}

async function pickCategoryWithSpace(guild, categoryIds) {
  if (!categoryIds.length) return null;
  await guild.channels.fetch();

  const counts = new Map();
  for (const ch of guild.channels.cache.values()) {
    if (!ch.parentId) continue;
    counts.set(ch.parentId, (counts.get(ch.parentId) || 0) + 1);
  }

  const MAX = 50;
  for (const id of categoryIds) {
    const cat = guild.channels.cache.get(id);
    if (!cat) continue;
    if (cat.type !== ChannelType.GuildCategory) continue;
    if ((counts.get(id) || 0) < MAX) return cat;
  }
  return null;
}

function parseVatType(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (raw === "margin") return "Margin";
  if (raw === "vat21" || raw === "21" || raw === "21%") return "VAT21";
  if (raw === "vat0" || raw === "0" || raw === "0%") return "VAT0";
  return null;
}

function getBrandText(brand) {
  if (!brand) return "";
  if (typeof brand === "string") return brand;
  if (typeof brand === "object" && brand.name) return String(brand.name);
  if (Array.isArray(brand) && brand.length) {
    const first = brand[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && first.name) return String(first.name);
    return String(first);
  }
  return String(brand);
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;

  const s = String(v)
    .replace("€", "")
    .replace(",", ".")
    .trim();

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function getLinkedRecordId(v) {
  // Airtable linked record values are usually: ["recXXXX"]  (array of record ids)
  if (Array.isArray(v) && v.length) return String(v[0]);
  if (typeof v === "string" && v.trim()) return v.trim();
  return "";
}


export function registerMemberWtbClaimFlow(client) {
  if (__memberWtbClaimFlowRegistered) return;
  __memberWtbClaimFlowRegistered = true;
  // Runtime state
  const sellerMap = new Map(); // channelId -> claim context
  const uploadedImagesMap = new Map(); // channelId -> [urls]

  client.on(Events.InteractionCreate, async (interaction) => {
    // 1) Claim button on listing -> show modal (Seller ID + VAT Type)
    if (interaction.isButton() && interaction.customId.startsWith("member_wtb_claim_")) {
      const recordId = interaction.customId.replace("member_wtb_claim_", "").trim();

      const modal = new ModalBuilder()
        .setCustomId(`member_wtb_claim_modal_${recordId}`)
        .setTitle("Claim Member WTB Deal");

      const sellerInput = new TextInputBuilder()
        .setCustomId("seller_id")
        .setLabel("Seller ID (e.g. 00001)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const vatInput = new TextInputBuilder()
        .setCustomId("vat_type")
        .setLabel("VAT Type (Margin / VAT21 / VAT0)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Exactly: "Margin", "VAT21" or "VAT0"');

      modal.addComponents(
        new ActionRowBuilder().addComponents(sellerInput),
        new ActionRowBuilder().addComponents(vatInput)
      );

      try {
        await interaction.showModal(modal);
      } catch (err) {
        // 10062 = expired interaction (user clicked an old button / bot restart / latency)
        if (err?.code !== 10062) console.error("showModal failed:", err);
      }
      return;
    }

    // 2) Modal submit -> validate seller + lock payout + create deal channel
    if (interaction.isModalSubmit() && interaction.customId.startsWith("member_wtb_claim_modal_")) {
      await interaction.deferReply({ ephemeral: true });
      const recordId = interaction.customId.replace("member_wtb_claim_modal_", "").trim();

      const sellerIdRaw = interaction.fields.getTextInputValue("seller_id").replace(/\D/g, "");
      const sellerId = `SE-${sellerIdRaw.padStart(5, "0")}`;

      const vatType = parseVatType(interaction.fields.getTextInputValue("vat_type"));
      if (!vatType) {
        return interaction.editReply('❌ Invalid VAT Type. Use **Margin**, **VAT21** or **VAT0**.');
      }

      // Load WTB record (so we can compute Locked Payout)
      const wtbRec = await base(WTB_TABLE).find(recordId);
      // ✅ idempotency: if already claimed, do NOT create another channel
      const existingClaimedChannelId = String(wtbRec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
      const existingStatus = String(wtbRec.get(FIELD_FULFILLMENT_STATUS) || "").trim();
      
      if (existingClaimedChannelId && existingStatus === "Claim Processing") {
        return interaction.editReply(
          `⚠️ This deal is already being processed in <#${existingClaimedChannelId}>.`
        );
      }

      function asText(v) {
        if (v == null) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number") return String(v);
        if (Array.isArray(v)) {
          if (!v.length) return "";
          const first = v[0];
          if (first == null) return "";
          if (typeof first === "string" || typeof first === "number") return String(first);
          if (typeof first === "object" && first.name) return String(first.name);
          if (typeof first === "object" && first.text) return String(first.text);
          return String(first);
        }
        if (typeof v === "object" && v.name) return String(v.name);
        return String(v);
      }
      
      const sku = asText(wtbRec.get("SKU (API)")).trim();
      const size = asText(wtbRec.get("Size")).trim();
      const brand = asText(wtbRec.get("Brand")).trim();

      // --- LOCK PAYOUT HERE ---
      // Read CURRENT payouts (these should be populated by Make / your system)
      const marginPayout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_MARGIN));
      const vat0Payout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_VAT0));
      
      if (marginPayout == null || vat0Payout == null) {
        return interaction.editReply(
          `❌ Could not lock payout because current payout fields are missing/invalid.\n` +
          `Check Airtable fields:\n` +
          `- ${FIELD_CURRENT_PAYOUT_MARGIN}\n` +
          `- ${FIELD_CURRENT_PAYOUT_VAT0}`
        );
      }
      
      const lockedPayout = vatType === "VAT0" ? vat0Payout : marginPayout;
      if (!Number.isFinite(lockedPayout)) {
        return interaction.editReply("❌ Locked payout is not a valid number.");
      }

      // validate seller in Sellers Database
      const sellerRecords = await base(SELLERS_TABLE)
        .select({ filterByFormula: `{Seller ID} = "${sellerId}"`, maxRecords: 1 })
        .firstPage();

      if (!sellerRecords.length) {
        return interaction.editReply(`❌ Seller ID **${sellerId}** not found.`);
      }

      // create deal channel
      const guild = await client.guilds.fetch(CONFIG.guildId);

      const pickedCategory = await pickCategoryWithSpace(guild, DEAL_CATEGORY_IDS);
      if (!pickedCategory) {
        return interaction.editReply("❌ All Member WTB categories are full (50 channels each). Add a new category.");
      }

      const channelName = toChannelSlug(`wtb-${sku}-${size}`);
      const dealChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: pickedCategory.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.AttachFiles
            ]
          }
        ]
      });

      const claimEmbed = new EmbedBuilder()
        .setTitle("💸 Member WTB Deal Claimed")
        .setColor(0xffed00)
        .setDescription(
          `**SKU:** ${sku || "-"}\n` +
            `**Size:** ${size || "-"}\n` +
            `**Brand:** ${brand || "-"}\n` +
            `**Locked Payout:** €${lockedPayout.toFixed(2)}\n` +
            `**VAT Type:** ${vatType}\n` +
            `**Seller (claimed with):** ${sellerId}`
        );

      const pic = wtbRec.get(FIELD_PICTURE);
      const imageUrl =
        Array.isArray(pic) && pic.length && pic[0]?.url ? pic[0].url : null;
      
      if (imageUrl) claimEmbed.setImage(imageUrl);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("member_wtb_start_claim").setLabel("Process Claim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("member_wtb_cancel_deal").setLabel("Cancel Deal").setStyle(ButtonStyle.Danger)
      );

      const dealMsg = await dealChannel.send({ embeds: [claimEmbed], components: [row] });

      // Persist claim state
      sellerMap.set(dealChannel.id, {
        recordId,
        sellerRecordId: sellerRecords[0].id,
        sellerDiscordId: interaction.user.id,
        sellerId,
        vatType,
        lockedPayout,
        dealEmbedId: dealMsg.id,
        confirmed: false
      });

      // Update Airtable
      await base(WTB_TABLE).update(recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Claim Processing",
        [FIELD_CLAIMED_CHANNEL_ID]: dealChannel.id,
        [FIELD_CLAIMED_MESSAGE_ID]: dealMsg.id,
      
        // ✅ LINK the seller record
        [FIELD_CLAIMED_SELLER]: [sellerRecords[0].id],
      
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: interaction.user.id,
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: vatType,
      
        // lock values
        [FIELD_LOCKED_PAYOUT]: lockedPayout,
        [FIELD_LOCKED_PAYOUT_VAT0]: vat0Payout,
      
        [FIELD_CLAIMED_SELLER_CONFIRMED]: false
      });
      ;

      // Disable listing claim button (so Make doesn't re-trigger / users don't double claim)
      try {
        const claimMsgId = wtbRec.get(FIELD_CLAIM_MESSAGE_ID);
        const claimMsgUrl = wtbRec.get(FIELD_CLAIM_MESSAGE_URL);
        const listingChannelId = String(claimMsgUrl || "").match(/discord\.com\/channels\/\d+\/(\d+)\/\d+/)?.[1];

        if (claimMsgId && listingChannelId) {
          const listingChannel = await guild.channels.fetch(listingChannelId);
          if (listingChannel?.isTextBased()) {
            const listingMsg = await listingChannel.messages.fetch(String(claimMsgId)).catch(() => null);
            if (listingMsg) {
              const disabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`member_wtb_claim_${recordId}`)
                  .setLabel("Claim Deal")
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true)
              );
              await listingMsg.edit({ components: [disabledRow] });
            }
          }
        }
      } catch (_) {}

      return interaction.editReply(
        `✅ Claimed! Your deal channel is <#${dealChannel.id}>.\n` +
        `Click **Process Claim** there to verify your Seller ID and start photo upload.`
      );
    }

    // 3) Process claim -> show linked username confirmation (same concept as your normal flow)
    if (interaction.isButton() && interaction.customId === "member_wtb_start_claim") {
      let data = sellerMap.get(interaction.channel.id);

      if (!data?.sellerRecordId || !data?.recordId) {
        const recs = await base(WTB_TABLE)
          .select({
            filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${interaction.channel.id}"`,
            maxRecords: 1
          })
          .firstPage();
      
        if (!recs.length) {
          return interaction.reply({ content: "❌ Missing seller context. Contact staff.", ephemeral: true });
        }
      
        const rec = recs[0];
        const linkedSeller = rec.get(FIELD_CLAIMED_SELLER);
        const sellerRecordId = getLinkedRecordId(linkedSeller);
        
        data = {
          ...(data || {}),
          recordId: rec.id,
          sellerRecordId: sellerRecordId || data?.sellerRecordId || "",
          sellerDiscordId: rec.get(FIELD_CLAIMED_SELLER_DISCORD_ID),
          vatType: rec.get(FIELD_CLAIMED_SELLER_VAT_TYPE),
          lockedPayout: rec.get(FIELD_LOCKED_PAYOUT),
          sellerId: data?.sellerId || "" // optional
        };
        
        sellerMap.set(interaction.channel.id, data);

      }
      
      if (!data?.sellerRecordId) {
        // If you want it to show “is this you?” you need sellerRecordId.
        // For now at least don't crash:
        return interaction.reply({ content: "❌ Missing sellerRecordId (link seller record or store it).", ephemeral: true });
      }


      const sellerRecord = await base(SELLERS_TABLE).find(data.sellerRecordId);
      const sellerIdField = sellerRecord.get("Seller ID") || data.sellerId;
      const discordUsername = sellerRecord.get("Discord") || "Unknown";

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("member_wtb_confirm_seller").setLabel("✅ Yes, that is me").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("member_wtb_reject_seller").setLabel("❌ No, not me").setStyle(ButtonStyle.Danger)
      );

      return interaction.reply({
        content: `🔍 We found this Discord Username linked to Seller ID **${sellerIdField}**:\n**${discordUsername}**\n\nIs this you?`,
        components: [confirmRow]
      });

    }

    // 4) Confirm seller -> ask for 6 pics
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_seller") {
      await interaction.deferUpdate().catch(() => {});
      const data = sellerMap.get(interaction.channel.id) || {};
      sellerMap.set(interaction.channel.id, { ...data, confirmed: true });

      // persist checkbox
      if (data?.recordId) {
        await base(WTB_TABLE).update(data.recordId, { [FIELD_CLAIMED_SELLER_CONFIRMED]: true }).catch(() => {});
      }

      try {
        await interaction.message.edit({
          content: "✅ Seller confirmed.\nUpload **6 different** pictures of the pair (in-hand).",
          components: []
        });
      } catch (_) {}

      return;
    }

    if (interaction.isButton() && interaction.customId === "member_wtb_reject_seller") {
      await interaction.deferUpdate().catch(() => {});
      try {
        await interaction.message.edit({
          content: "⚠️ Then cancel this deal and claim again with the correct Seller ID.",
          components: []
        });
      } catch (_) {}
      return;
    }

    // 5) Cancel deal -> set status back to Outsource + re-enable listing button
    if (interaction.isButton() && interaction.customId === "member_wtb_cancel_deal") {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
      let data = sellerMap.get(interaction.channel.id);
      
      if (!data?.recordId) {
        const recs = await base(WTB_TABLE)
          .select({
            filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${interaction.channel.id}"`,
            maxRecords: 1
          })
          .firstPage();
      
        if (!recs.length) return interaction.editReply("❌ Missing recordId.");
      
        data = { ...(data || {}), recordId: recs[0].id };
        sellerMap.set(interaction.channel.id, data);
      }

      // Re-enable listing claim button
      try {
        const wtbRec = await base(WTB_TABLE).find(data.recordId);
        const claimMsgId = wtbRec.get(FIELD_CLAIM_MESSAGE_ID);
        const claimMsgUrl = wtbRec.get(FIELD_CLAIM_MESSAGE_URL);
        const listingChannelId = String(claimMsgUrl || "").match(/discord\.com\/channels\/\d+\/(\d+)\/\d+/)?.[1];

        if (claimMsgId && listingChannelId) {
          const guild = await client.guilds.fetch(CONFIG.guildId);
          const listingChannel = await guild.channels.fetch(listingChannelId);
          if (listingChannel?.isTextBased()) {
            const listingMsg = await listingChannel.messages.fetch(String(claimMsgId)).catch(() => null);
            if (listingMsg) {
              const enabledRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(`member_wtb_claim_${data.recordId}`)
                  .setLabel("Claim Deal")
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(false)
              );
              await listingMsg.edit({ components: [enabledRow] });
            }
          }
        }
      } catch (_) {}

      // Airtable reset
      await base(WTB_TABLE).update(data.recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Outsource",
      
        // text fields -> ok to blank
        [FIELD_CLAIMED_CHANNEL_ID]: "",
        [FIELD_CLAIMED_MESSAGE_ID]: "",
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: "",
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: "",
        // ✅ clear linked record
        [FIELD_CLAIMED_SELLER]: [],
        [FIELD_LOCKED_PAYOUT]: null,
        [FIELD_LOCKED_PAYOUT_VAT0]: null,
      
        [FIELD_CLAIMED_SELLER_CONFIRMED]: false,
      
        // optional: if you have linked field "Claimed Seller"
        // "Claimed Seller": []
      });

      await interaction.editReply("✅ Cancelled. Channel will be deleted.");
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2500);
      return;
    }

    // 6) Admin confirm deal button (we add it after 6 pics)
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_deal") {
      const memberRoles = interaction.member?.roles?.cache?.map((r) => r.id) || [];
      const isAdmin = ADMIN_ROLE_IDS.length
        ? ADMIN_ROLE_IDS.some((id) => memberRoles.includes(id))
        : true; // if you didn’t configure, it won’t block you

      if (!isAdmin) return interaction.reply({ content: "❌ Not authorized.", ephemeral: true });

      await interaction.reply({
        content:
          "✅ Confirm clicked.\n\nNext step: we will send this to Make via webhook (we’ll plug the URL later).",
        ephemeral: true
      });

      // Later: call Make webhook with recordId + lockedPayout + vatType + seller etc.
      return;
    }
  });

  // 7) Count 6 pictures, then post Confirm button
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.channel || message.channel.type !== ChannelType.GuildText) return;

    const data = sellerMap.get(message.channel.id);
    if (!data?.recordId) return;

    if (!message.attachments?.size) return;

    const imageUrls = [...message.attachments.values()]
      .filter((att) => att.contentType?.startsWith("image/"))
      .map((att) => att.url);

    if (!imageUrls.length) return;

    const arr = uploadedImagesMap.get(message.channel.id) || [];
    arr.push(...imageUrls);
    uploadedImagesMap.set(message.channel.id, arr);

    const count = arr.length;

    if (count < 6) {
      await message.channel.send(`📸 Uploaded ${count}/6 required pictures.`);
      return;
    }

    // Only send confirm button once
    if (data.confirmSent) return;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("member_wtb_confirm_deal").setLabel("Confirm Deal").setStyle(ButtonStyle.Success)
    );

    await message.channel.send({
      content: "✅ All 6 pictures received. Admin can now confirm the deal.",
      components: [row]
    });

    sellerMap.set(message.channel.id, { ...data, confirmSent: true });
  });
}

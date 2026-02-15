// src/features/wtb/memberWtbClaimFlow.js
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
  TextInputStyle,
  MessageFlags
} from "discord.js";
import fetch from "node-fetch";
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
 * - Claimed Seller (LINKED RECORD)
 * - Claimed Seller VAT Type
 * - Locked Payout
 * - Locked Payout VAT0
 * - Claimed Seller Confirmed?
 * - Buyer Discord ID
 * - Buyer Country
 * - Buyer VAT ID
 * - Locked Buyer Price
 * - Locked Buyer Price VAT0
 * - Buyer Payment Requested At
 * - Tracking Number
 * - Shipping Label (attachment)
 * - Picture (attachment) (optional)
 *
 * REQUIRED fields in Sellers Database:
 * - Seller ID (e.g. SE-00001)
 * - Discord (username) OR Discord ID
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
const FIELD_CLAIMED_SELLER = "Claimed Seller"; // LINKED RECORD field
const FIELD_CLAIMED_SELLER_VAT_TYPE = "Claimed Seller VAT Type";
const FIELD_LOCKED_PAYOUT = "Locked Payout";
const FIELD_LOCKED_PAYOUT_VAT0 = "Locked Payout VAT0";
const FIELD_CLAIMED_SELLER_CONFIRMED = "Claimed Seller Confirmed?";
const FIELD_PICTURE = "Picture";

const FIELD_CURRENT_PAYOUT_MARGIN = "Current Payout";
const FIELD_CURRENT_PAYOUT_VAT0 = "Current Payout VAT0";

// Buyer payment fields (Member WTBs)
const FIELD_BUYER_DISCORD_ID = "Buyer Discord ID";
const FIELD_BUYER_COUNTRY = "Buyer Country";
const FIELD_BUYER_VAT_ID = "Buyer VAT ID";
const FIELD_LOCKED_BUYER_PRICE = "Locked Buyer Price";
const FIELD_LOCKED_BUYER_PRICE_VAT0 = "Locked Buyer Price VAT0";
const FIELD_BUYER_PAYMENT_REQUESTED_AT = "Buyer Payment Requested At";

// Shipping label fields (Member WTBs)
const FIELD_TRACKING_NUMBER = "Tracking Number";
const FIELD_SHIPPING_LABEL = "Shipping Label";

// Buyer DM interaction IDs
const BTN_UPLOAD_LABEL = "member_wtb_buyer_upload_label";
const MODAL_UPLOAD_LABEL = "member_wtb_buyer_upload_label_modal";

// Discord config
const DEAL_CATEGORY_IDS = (process.env.MEMBER_WTB_DEAL_CATEGORY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  const s = String(v).replace("€", "").replace(",", ".").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function getLinkedRecordId(v) {
  if (!v) return "";
  if (typeof v === "string") return v.trim();
  if (Array.isArray(v) && v.length) {
    const first = v[0];
    if (!first) return "";
    if (typeof first === "string") return first.trim();
    if (typeof first === "object" && first.id) return String(first.id).trim();
    return "";
  }
  if (typeof v === "object" && v.id) return String(v.id).trim();
  return "";
}

function firstText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (Array.isArray(v) && v.length) return firstText(v[0]);
  if (typeof v === "object" && v.name) return String(v.name).trim();
  if (typeof v === "object" && v.text) return String(v.text).trim();
  return String(v).trim();
}

function computeBuyerCharge({ sellerVatType, buyerCountry, buyerVatId, buyerPrice, buyerPriceVat0 }) {
  const sv = String(sellerVatType || "").trim().toUpperCase();
  const country = String(buyerCountry || "").trim().toUpperCase();
  const vatId = String(buyerVatId || "").trim();
  const isCompany = !!vatId;

  if (sv === "VAT0") return buyerPriceVat0 ?? buyerPrice;
  if (isCompany && country && country !== "NL") return buyerPriceVat0 ?? buyerPrice;
  return buyerPrice;
}

function nowMs() {
  return Date.now();
}

async function safeSendDM(client, discordUserId, payload) {
  try {
    const u = await client.users.fetch(discordUserId);
    if (!u) return false;
    await u.send(payload);
    return true;
  } catch (e) {
    console.warn("DM failed:", e?.message || e);
    return false;
  }
}

export function registerMemberWtbClaimFlow(client) {
  if (__memberWtbClaimFlowRegistered) return;
  __memberWtbClaimFlowRegistered = true;

  // Runtime state
  const sellerMap = new Map(); // channelId -> claim context
  const uploadedImagesMap = new Map(); // channelId -> [urls]

  // key: `${buyerDiscordId}:${recordId}` -> { recordId, tracking, buyerDiscordId, createdAt, expiresAt }
  const pendingBuyerLabelMap = new Map();
  const PENDING_LABEL_TTL_MS = 15 * 60 * 1000;

  const pendingKey = (buyerDiscordId, recordId) => `${buyerDiscordId}:${recordId}`;

  function setPendingLabelSession({ buyerDiscordId, recordId, tracking }) {
    const now = nowMs();
    pendingBuyerLabelMap.set(pendingKey(buyerDiscordId, recordId), {
      buyerDiscordId,
      recordId,
      tracking: tracking || "",
      createdAt: now,
      expiresAt: now + PENDING_LABEL_TTL_MS
    });
  }

  function getPendingLabelSession(buyerDiscordId, recordId) {
    const key = pendingKey(buyerDiscordId, recordId);
    const s = pendingBuyerLabelMap.get(key);
    if (!s) return null;
    if (nowMs() > s.expiresAt) {
      pendingBuyerLabelMap.delete(key);
      return null;
    }
    return s;
  }

  function clearPendingLabelSession(buyerDiscordId, recordId) {
    pendingBuyerLabelMap.delete(pendingKey(buyerDiscordId, recordId));
  }

  // Helpers to avoid 10062 crashing your process
  async function tryDeferEphemeral(interaction) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return true;
    } catch (e) {
      if (e?.code === 10062) return false; // expired interaction
      console.error("deferReply failed:", e);
      return false;
    }
  }

  async function safeReplyEphemeral(interaction, content) {
    try {
      // If already replied/deferred, editReply. Else reply.
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    } catch (e) {
      if (e?.code !== 10062) console.error("safeReplyEphemeral failed:", e);
    }
  }

  client.on(Events.InteractionCreate, async (interaction) => {
    // 1) Claim button on listing -> show modal
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
        if (err?.code !== 10062) console.error("showModal failed:", err);
      }
      return;
    }

    // 2) Modal submit -> validate seller + lock payout + create deal channel
    if (interaction.isModalSubmit() && interaction.customId.startsWith("member_wtb_claim_modal_")) {
      const canReply = await tryDeferEphemeral(interaction);

      const recordId = interaction.customId.replace("member_wtb_claim_modal_", "").trim();

      const sellerIdRaw = interaction.fields.getTextInputValue("seller_id").replace(/\D/g, "");
      if (!sellerIdRaw) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Please enter a valid Seller ID (e.g. 00001).");
        return;
      }
      const sellerId = `SE-${sellerIdRaw.padStart(5, "0")}`;

      const vatType = parseVatType(interaction.fields.getTextInputValue("vat_type"));
      if (!vatType) {
        if (canReply) await safeReplyEphemeral(interaction, '❌ Invalid VAT Type. Use **Margin**, **VAT21** or **VAT0**.');
        return;
      }

      let wtbRec;
      try {
        wtbRec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Could not load this WTB record from Airtable.");
        return;
      }

      // idempotency (avoid double channels)
      const existingClaimedChannelId = String(wtbRec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
      const existingStatus = String(wtbRec.get(FIELD_FULFILLMENT_STATUS) || "").trim();
      if (existingClaimedChannelId && existingStatus === "Claim Processing") {
        if (canReply) await safeReplyEphemeral(interaction, `⚠️ This deal is already being processed in <#${existingClaimedChannelId}>.`);
        return;
      }

      const sku = firstText(wtbRec.get("SKU (API)")).trim();
      const size = firstText(wtbRec.get("Size")).trim();
      const brand = firstText(wtbRec.get("Brand")).trim();

      const marginPayout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_MARGIN));
      const vat0Payout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_VAT0));

      if (marginPayout == null || vat0Payout == null) {
        if (canReply) {
          await safeReplyEphemeral(
            interaction,
            `❌ Could not lock payout because current payout fields are missing/invalid.\n` +
              `Check Airtable fields:\n- ${FIELD_CURRENT_PAYOUT_MARGIN}\n- ${FIELD_CURRENT_PAYOUT_VAT0}`
          );
        }
        return;
      }

      const lockedPayout = vatType === "VAT0" ? vat0Payout : marginPayout;
      if (!Number.isFinite(lockedPayout)) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Locked payout is not a valid number.");
        return;
      }

      // validate seller record
      const sellerRecords = await base(SELLERS_TABLE)
        .select({ filterByFormula: `{Seller ID} = "${sellerId}"`, maxRecords: 1 })
        .firstPage();

      if (!sellerRecords.length) {
        if (canReply) await safeReplyEphemeral(interaction, `❌ Seller ID **${sellerId}** not found.`);
        return;
      }

      const guild = await client.guilds.fetch(CONFIG.guildId);

      const pickedCategory = await pickCategoryWithSpace(guild, DEAL_CATEGORY_IDS);
      if (!pickedCategory) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ All Member WTB categories are full (50 channels each). Add a new category.");
        return;
      }

      const channelName = toChannelSlug(`wtb-${sku}-${size}`);
      const adminRoleOverwrites = (ADMIN_ROLE_IDS || []).map((roleId) => ({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles
        ]
      }));

      const dealChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: pickedCategory.id,
        permissionOverwrites: [
          { id: guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
          ...adminRoleOverwrites,
          {
            id: interaction.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
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
      const imageUrl = Array.isArray(pic) && pic.length && pic[0]?.url ? pic[0].url : null;
      if (imageUrl) claimEmbed.setImage(imageUrl);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("member_wtb_start_claim").setLabel("Process Claim").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("member_wtb_cancel_deal").setLabel("Cancel Deal").setStyle(ButtonStyle.Danger)
      );

      const dealMsg = await dealChannel.send({ embeds: [claimEmbed], components: [row] });

      sellerMap.set(dealChannel.id, {
        recordId,
        sellerRecordId: sellerRecords[0].id,
        sellerDiscordId: interaction.user.id,
        sellerId,
        vatType,
        lockedPayout,
        dealEmbedId: dealMsg.id,
        confirmed: false,
        confirmSent: false
      });

      await base(WTB_TABLE).update(recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Claim Processing",
        [FIELD_CLAIMED_CHANNEL_ID]: dealChannel.id,
        [FIELD_CLAIMED_MESSAGE_ID]: dealMsg.id,
        [FIELD_CLAIMED_SELLER]: [sellerRecords[0].id],
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: interaction.user.id,
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: vatType,
        [FIELD_LOCKED_PAYOUT]: lockedPayout,
        [FIELD_LOCKED_PAYOUT_VAT0]: vat0Payout,
        [FIELD_CLAIMED_SELLER_CONFIRMED]: false
      });

      // Disable listing claim button
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

      if (canReply) {
        await safeReplyEphemeral(
          interaction,
          `✅ Claimed! Your deal channel is <#${dealChannel.id}>.\nClick **Process Claim** there to verify your Seller ID and start photo upload.`
        );
      }
      return;
    }

    // 3) Process claim -> seller identity confirm
    if (interaction.isButton() && interaction.customId === "member_wtb_start_claim") {
      const channelId = interaction.channel?.id;
      if (!channelId) return;

      let data = sellerMap.get(channelId);

      try {
        // Rehydrate after restart
        if (!data?.recordId || !data?.sellerRecordId) {
          const recs = await base(WTB_TABLE)
            .select({
              filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${channelId}"`,
              maxRecords: 1
            })
            .firstPage();

          if (!recs.length) {
            return interaction.reply({
              content: "❌ Could not find the linked Member WTB record for this channel.",
              flags: MessageFlags.Ephemeral
            });
          }

          const rec = recs[0];
          const sellerRecordId = getLinkedRecordId(rec.get(FIELD_CLAIMED_SELLER));

          data = {
            ...(data || {}),
            recordId: rec.id,
            sellerRecordId,
            sellerDiscordId: rec.get(FIELD_CLAIMED_SELLER_DISCORD_ID),
            sellerId: rec.get("Seller ID") || data?.sellerId,
            vatType: rec.get(FIELD_CLAIMED_SELLER_VAT_TYPE),
            lockedPayout: rec.get(FIELD_LOCKED_PAYOUT),
            confirmed: !!rec.get(FIELD_CLAIMED_SELLER_CONFIRMED)
          };

          sellerMap.set(channelId, data);
        }

        // ✅ Only claimed seller can press Process Claim
        if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
          return interaction.reply({ content: "❌ Only the claimed seller can process this claim.", flags: MessageFlags.Ephemeral });
        }

        if (!data?.sellerRecordId) {
          return interaction.reply({
            content:
              `❌ No linked Seller record found.\n` +
              `Check that Airtable field **"${FIELD_CLAIMED_SELLER}"** is a LINKED RECORD to Sellers Database, and that it gets filled on claim.`,
            flags: MessageFlags.Ephemeral
          });
        }

        const sellerRecord = await base(SELLERS_TABLE).find(data.sellerRecordId);
        const sellerIdField = sellerRecord.get("Seller ID") || "Unknown ID";
        const discordUsername = sellerRecord.get("Discord") || "Unknown";

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("member_wtb_confirm_seller").setLabel("✅ Yes, that is me").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("member_wtb_reject_seller").setLabel("❌ No, not me").setStyle(ButtonStyle.Danger)
        );

        return interaction.reply({
          content:
            `🔍 We found this Discord Username linked to Seller ID **${sellerIdField}**:\n` +
            `**${discordUsername}**\n\nIs this you?`,
          components: [confirmRow]
        });
      } catch (err) {
        console.error("member_wtb_start_claim failed:", err);
        try {
          return interaction.reply({
            content: "❌ Something went wrong while verifying your Seller ID. Try again or contact staff.",
            flags: MessageFlags.Ephemeral
          });
        } catch (_) {}
      }
      return;
    }

    // 4) Confirm seller -> ask for 6 pics
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_seller") {
      const data = sellerMap.get(interaction.channel.id) || {};
      if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
        return interaction.reply({ content: "❌ Only the claimed seller can confirm.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferUpdate().catch(() => {});
      sellerMap.set(interaction.channel.id, { ...data, confirmed: true });

      if (data?.recordId) {
        await base(WTB_TABLE).update(data.recordId, { [FIELD_CLAIMED_SELLER_CONFIRMED]: true }).catch(() => {});
      }

      try {
        await interaction.message.edit({
          content:
            "✅ Seller ID confirmed.\nPlease upload **6 different** pictures of the pair like shown below to prove it is in-hand and complete.",
          components: []
        });
        await interaction.channel.send({ files: ["https://i.imgur.com/JKaeeNz.png"] });
      } catch (e) {
        console.error("Failed to edit confirm_seller message:", e);
      }
      return;
    }

    if (interaction.isButton() && interaction.customId === "member_wtb_reject_seller") {
      const data = sellerMap.get(interaction.channel.id) || {};
      if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
        return interaction.reply({ content: "❌ Only the claimed seller can do this.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferUpdate().catch(() => {});
      try {
        await interaction.message.edit({
          content: "⚠️ Then cancel this deal and claim again with the correct Seller ID.",
          components: []
        });
      } catch (_) {}
      return;
    }

    // 5) Cancel deal
    if (interaction.isButton() && interaction.customId === "member_wtb_cancel_deal") {
      const ok = await tryDeferEphemeral(interaction);

      let data = sellerMap.get(interaction.channel.id);

      if (!data?.recordId) {
        const recs = await base(WTB_TABLE)
          .select({
            filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${interaction.channel.id}"`,
            maxRecords: 1
          })
          .firstPage();

        if (!recs.length) {
          if (ok) await safeReplyEphemeral(interaction, "❌ Missing recordId.");
          return;
        }

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
                new ButtonBuilder().setCustomId(`member_wtb_claim_${data.recordId}`).setLabel("Claim Deal").setStyle(ButtonStyle.Success)
              );
              await listingMsg.edit({ components: [enabledRow] });
            }
          }
        }
      } catch (_) {}

      await base(WTB_TABLE).update(data.recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Outsource",
        [FIELD_CLAIMED_CHANNEL_ID]: "",
        [FIELD_CLAIMED_MESSAGE_ID]: "",
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: "",
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: null,
        [FIELD_CLAIMED_SELLER]: [],
        [FIELD_LOCKED_PAYOUT]: null,
        [FIELD_LOCKED_PAYOUT_VAT0]: null,
        [FIELD_BUYER_PAYMENT_REQUESTED_AT]: null,
        [FIELD_CLAIMED_SELLER_CONFIRMED]: false
      });

      if (ok) await safeReplyEphemeral(interaction, "✅ Cancelled. Channel will be deleted.");

      setTimeout(() => interaction.channel.delete().catch(() => {}), 2500);
      return;
    }

    // 6) Admin confirm deal
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_deal") {
      const memberRoles = interaction.member?.roles?.cache?.map((r) => r.id) || [];
      const isAdmin = ADMIN_ROLE_IDS.length ? ADMIN_ROLE_IDS.some((id) => memberRoles.includes(id)) : true;

      if (!isAdmin) {
        return interaction.reply({ content: "❌ Not authorized.", flags: MessageFlags.Ephemeral });
      }

      // disable button immediately (so it doesn't look "stuck" even if webhook is slow)
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("member_wtb_confirm_deal")
            .setLabel("⏳ Confirming…")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        await interaction.message.edit({ components: [disabledRow] }).catch(() => {});
      } catch (_) {}

      const canReply = await tryDeferEphemeral(interaction);

      const data = sellerMap.get(interaction.channel.id);
      if (!data?.recordId) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Missing recordId for this deal.");
        return;
      }

      let rec;
      try {
        rec = await base(WTB_TABLE).find(data.recordId);
      } catch (e) {
        console.error("Could not load Member WTB record:", e);
        if (canReply) await safeReplyEphemeral(interaction, "❌ Could not load Airtable record.");
        return;
      }

      const payload = {
        source: "Member WTB",
        recordId: data.recordId,
        dealChannelId: interaction.channel.id,
        sellerRecordId: data.sellerRecordId,
        sellerDiscordId: data.sellerDiscordId,
        sellerId: data.sellerId,
        vatType: data.vatType,
        sku: String(rec.get("SKU (API)") || rec.get("SKU") || "").trim(),
        size: String(rec.get("Size") || "").trim(),
        brand: getBrandText(rec.get("Brand")),
        lockedPayout: data.lockedPayout,
        claimMessageUrl: rec.get(FIELD_CLAIM_MESSAGE_URL) || ""
      };

      const hook = process.env.MAKE_MEMBER_WTB_CONFIRM_WEBHOOK_URL || "";
      if (!hook) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ MAKE_MEMBER_WTB_CONFIRM_WEBHOOK_URL is not set in Render ENV.");
        return;
      }

      try {
        const resp = await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.error("Make webhook failed:", resp.status, text);
          if (canReply) await safeReplyEphemeral(interaction, `❌ Make webhook failed (${resp.status}). Check logs.`);
          return;
        }
      } catch (e) {
        console.error("Error calling Make webhook:", e);
        if (canReply) await safeReplyEphemeral(interaction, "❌ Could not reach Make webhook.");
        return;
      }

      // Buyer payment DM + label upload button
      try {
        const buyerDiscordId = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
        const buyerCountry = firstText(rec.get(FIELD_BUYER_COUNTRY));
        const buyerVatId = firstText(rec.get(FIELD_BUYER_VAT_ID));

        const buyerPrice = toNumber(rec.get(FIELD_LOCKED_BUYER_PRICE));
        const buyerPriceVat0 = toNumber(rec.get(FIELD_LOCKED_BUYER_PRICE_VAT0));

        if (buyerDiscordId && (buyerPrice != null || buyerPriceVat0 != null)) {
          const finalAmount = computeBuyerCharge({
            sellerVatType: data.vatType,
            buyerCountry,
            buyerVatId,
            buyerPrice,
            buyerPriceVat0
          });

          const iban = process.env.PAYMENT_IBAN || "";
          const paypal = process.env.PAYMENT_PAYPAL_EMAIL || "";
          const beneficiary = process.env.PAYMENT_BENEFICIARY || "Kickz Caviar";

          const lines = [
            "✅ Your WTB has been **matched** and we are ready to ship.",
            "",
            `**Amount to pay (before shipping):** €${Number(finalAmount || 0).toFixed(2)}`,
            "",
            "**Payment method:**",
            ...(iban ? [`• **IBAN:** ${iban} (${beneficiary})`] : []),
            ...(paypal ? [`• **PayPal:** ${paypal}`] : []),
            "",
            "Once paid, reply here with proof of payment.",
            "Then click **Upload Label** to submit tracking + label file."
          ].filter(Boolean);

          const components = [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${BTN_UPLOAD_LABEL}:${data.recordId}`)
                .setLabel("Upload Label")
                .setStyle(ButtonStyle.Danger)
            )
          ];

          const dmOk = await safeSendDM(client, buyerDiscordId, { content: lines.join("\n"), components });
          if (dmOk) {
            setPendingLabelSession({ buyerDiscordId, recordId: data.recordId, tracking: "" });
          }

          await base(WTB_TABLE).update(data.recordId, {
            [FIELD_BUYER_PAYMENT_REQUESTED_AT]: new Date().toISOString()
          }).catch(() => {});
        }
      } catch (e) {
        console.warn("Buyer payment DM step failed:", e?.message || e);
      }

      // Update channel visible state + disable confirm button
      try {
        const confirmedRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("member_wtb_confirm_deal")
            .setLabel("✅ Deal Confirmed")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true)
        );
        await interaction.message.edit({ components: [confirmedRow] }).catch(() => {});
        await interaction.channel.send(
          "✅ **Deal confirmed.** Buyer has been notified for payment + label upload.\n⏳ Waiting for buyer to upload tracking + label in DM."
        );
      } catch (_) {}

      if (canReply) await safeReplyEphemeral(interaction, "✅ Confirmed. Buyer has been notified for payment + label upload.");
      return;
    }

    // Buyer DM: click Upload Label -> show modal (tracking)
    if (interaction.isButton() && String(interaction.customId || "").startsWith(`${BTN_UPLOAD_LABEL}:`)) {
      if (interaction.inGuild()) {
        return interaction.reply({ content: "❌ Please use this in DM.", flags: MessageFlags.Ephemeral });
      }

      const recordId = String(interaction.customId).split(":")[1];
      const buyerDiscordId = interaction.user.id;

      let rec;
      try {
        rec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        return interaction.reply({ content: "❌ Invalid deal reference.", flags: MessageFlags.Ephemeral });
      }

      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        return interaction.reply({
          content: "❌ You are not authorized to upload a label for this deal.",
          flags: MessageFlags.Ephemeral
        });
      }

      const session = getPendingLabelSession(buyerDiscordId, recordId);
      if (!session) setPendingLabelSession({ buyerDiscordId, recordId, tracking: "" });

      const modal = new ModalBuilder().setCustomId(`${MODAL_UPLOAD_LABEL}:${recordId}`).setTitle("Upload UPS Label");

      const trackingInput = new TextInputBuilder()
        .setCustomId("tracking")
        .setLabel('UPS Tracking (must start with "1Z")')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder("1Z...");

      modal.addComponents(new ActionRowBuilder().addComponents(trackingInput));

      try {
        await interaction.showModal(modal);
      } catch (err) {
        if (err?.code !== 10062) console.error("showModal upload label failed:", err);
      }
      return;
    }

    // Buyer DM: submit tracking
    if (interaction.isModalSubmit() && String(interaction.customId || "").startsWith(`${MODAL_UPLOAD_LABEL}:`)) {
      const canReply = await tryDeferEphemeral(interaction);

      if (interaction.inGuild()) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Please do this in DM.");
        return;
      }

      const recordId = String(interaction.customId).split(":")[1];
      const buyerDiscordId = interaction.user.id;

      const tracking = String(interaction.fields.getTextInputValue("tracking") || "").trim().toUpperCase();
      if (!tracking.startsWith("1Z")) {
        if (canReply) await safeReplyEphemeral(interaction, '❌ Invalid UPS tracking. It must start with **"1Z"**.');
        return;
      }

      let rec;
      try {
        rec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ Invalid deal reference.");
        return;
      }

      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        if (canReply) await safeReplyEphemeral(interaction, "❌ You are not authorized to upload a label for this deal.");
        return;
      }

      setPendingLabelSession({ buyerDiscordId, recordId, tracking });

      if (canReply) {
        await safeReplyEphemeral(interaction, "✅ Tracking saved. Now upload the **label file** (PDF/image) here in DM.");
      }
      return;
    }
  });

  // 7) Count 6 pictures + DM label capture
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    // ---------------- Buyer DM label upload capture ----------------
    if (!message.inGuild()) {
      if (!message.attachments?.size) return;

      const buyerDiscordId = message.author.id;

      const sessions = [];
      for (const s of pendingBuyerLabelMap.values()) {
        if (s.buyerDiscordId === buyerDiscordId && nowMs() <= s.expiresAt) sessions.push(s);
      }
      if (!sessions.length) return;

      sessions.sort((a, b) => b.createdAt - a.createdAt);
      const pending = sessions[0];

      if (!pending.tracking) {
        await message.channel.send("❌ Please click **Upload Label** first and submit the tracking number.");
        return;
      }

      const att = [...message.attachments.values()][0];
      const name = String(att?.name || att?.filename || "").toLowerCase();
      const ct = String(att?.contentType || "").toLowerCase();

      const isPdf = ct.includes("pdf") || name.endsWith(".pdf");
      const isImage = ct.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(name);

      if (!isPdf && !isImage) {
        await message.channel.send("❌ Label must be a **PDF or image**.");
        return;
      }

      let rec;
      try {
        rec = await base(WTB_TABLE).find(pending.recordId);
      } catch (e) {
        clearPendingLabelSession(buyerDiscordId, pending.recordId);
        await message.channel.send("❌ Could not find your deal anymore.");
        return;
      }

      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        clearPendingLabelSession(buyerDiscordId, pending.recordId);
        await message.channel.send("❌ Unauthorized label upload blocked.");
        return;
      }

      try {
        await base(WTB_TABLE).update(pending.recordId, {
          [FIELD_TRACKING_NUMBER]: pending.tracking,
          [FIELD_SHIPPING_LABEL]: [{ url: att.url, filename: att.name || "label.pdf" }]
        });

        clearPendingLabelSession(buyerDiscordId, pending.recordId);

        await message.channel.send(`✅ Label saved.\n• Tracking: **${pending.tracking}**`);

        const dealChannelId = String(rec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
        if (dealChannelId) {
          const ch = await client.channels.fetch(dealChannelId).catch(() => null);
          if (ch?.isTextBased()) {
            await ch.send({
              content: `📦 **Shipping label uploaded by buyer**\n• Tracking: **${pending.tracking}**\n• Buyer: <@${buyerDiscordId}>`,
              files: [{ attachment: att.url, name: att.name || "label.pdf" }]
            });
          }
        }
      } catch (e) {
        console.error("Failed saving label to Airtable:", e);
        await message.channel.send("❌ Failed saving label to Airtable. Check field types/names.");
      }
      return;
    }

    // ---------------- 6-picture logic (guild) ----------------
    if (!message.channel || message.channel.type !== ChannelType.GuildText) return;

    const data = sellerMap.get(message.channel.id);
    if (!data?.recordId) return;

    if (!data.confirmed) return;
    if (data.sellerDiscordId && message.author.id !== String(data.sellerDiscordId)) return;

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

/**
 * IMPORTANT:
 * For DM label capture to work, your client MUST be initialized with:
 * - GatewayIntentBits.DirectMessages
 * - Partials.Channel
 *
 * Otherwise DM MessageCreate won't fire.
 */

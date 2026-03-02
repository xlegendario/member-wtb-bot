// src/features/wtb/memberWtbClaimFlow.js
// ✅ IMPORTANT (outside this file):
// Your Discord Client MUST be created with:
// - intents: Guilds, GuildMessages, DirectMessages, MessageContent
// - partials: Channel (required for DM), Message (recommended), User (optional)
//
// Example:
// new Client({
//   intents: [Guilds, GuildMessages, DirectMessages, MessageContent],
//   partials: [Partials.Channel, Partials.Message, Partials.User],
// });
//
// Also: Developer Portal -> Message Content Intent = ON

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
import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";
import fetch from "node-fetch";

/* ---------------- Airtable tables + fields ---------------- */

const WTB_TABLE = CONFIG.wtbTable; // "Member WTBs"
const SELLERS_TABLE = CONFIG.sellersTable; // "Sellers Database"

const FIELD_FULFILLMENT_STATUS = "Fulfillment Status";
const FIELD_CLAIM_MESSAGE_ID = "Claim Message ID";
const FIELD_CLAIM_MESSAGE_URL = "Claim Message URL";
const FIELD_CLAIMED_CHANNEL_ID = "Claimed Channel ID";
const FIELD_CLAIMED_MESSAGE_ID = "Claimed Message ID";
const FIELD_CLAIMED_SELLER_DISCORD_ID = "Claimed Seller Discord ID";
const FIELD_CLAIMED_SELLER = "Claimed Seller"; // LINKED RECORD
const FIELD_CLAIMED_SELLER_VAT_TYPE = "Claimed Seller VAT Type";
const FIELD_LOCKED_PAYOUT = "Locked Payout";
const FIELD_CLAIMED_SELLER_CONFIRMED = "Claimed Seller Confirmed?";
const FIELD_PICTURE = "Picture";
const FIELD_PAYMENT_PROOF = "Payment Proof";

// payouts
const FIELD_CURRENT_PAYOUT_MARGIN = "Current Payout";
const FIELD_CURRENT_PAYOUT_VAT0 = "Current Payout VAT0";

// Buyer payment fields
const FIELD_BUYER_DISCORD_ID = "Buyer Discord ID";
const FIELD_BUYER_COUNTRY = "Buyer Country";
const FIELD_BUYER_VAT_ID = "Buyer VAT ID";

const FIELD_LOCKED_BUYER_PRICE = "Locked Buyer Price";
const FIELD_LOCKED_BUYER_PRICE_VAT0 = "Locked Buyer Price VAT0";

const FIELD_BUYER_PAYMENT_REQUESTED_AT = "Buyer Payment Requested At";

// Shipping label fields
const FIELD_TRACKING_NUMBER = "Tracking Number";
const FIELD_SHIPPING_LABEL = "Shipping Label";

/* ---------------- Discord interaction IDs ---------------- */

const BTN_UPLOAD_LABEL = "member_wtb_buyer_upload_label";
const MODAL_UPLOAD_LABEL = "member_wtb_buyer_upload_label_modal";
const BTN_UPLOAD_PAYMENT_PROOF = "member_wtb_buyer_upload_payment_proof";

/* ---------------- ENV config ---------------- */

const DEAL_CATEGORY_IDS = (process.env.MEMBER_WTB_DEAL_CATEGORY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAKE_MEMBER_WTB_WEBHOOK_URL = process.env.MAKE_MEMBER_WTB_WEBHOOK_URL || "";
console.log("[ENV] MAKE_MEMBER_WTB_WEBHOOK_URL:", MAKE_MEMBER_WTB_WEBHOOK_URL ? "SET" : "MISSING");

async function fireMakeWebhook(eventType, payload) {
  if (!MAKE_MEMBER_WTB_WEBHOOK_URL) {
    console.log(`[Make webhook ${eventType}] SKIP (URL missing)`);
    return;
  }

  console.log(`[Make webhook ${eventType}] POST ->`, MAKE_MEMBER_WTB_WEBHOOK_URL);

  try {
    const res = await fetch(MAKE_MEMBER_WTB_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, ...payload })
    });

    console.log(`[Make webhook ${eventType}] status:`, res.status);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[Make webhook ${eventType}] failed:`, res.status, text);
    }
  } catch (e) {
    console.error(`[Make webhook ${eventType}] error:`, e);
  }
}

/* ---------------- Helpers ---------------- */

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

  if (sv === "MARGIN") return buyerPrice;

  const isCompany = !!vatId;
  const isNonNL = !!country && country !== "NL";

  if (isCompany && isNonNL) return buyerPriceVat0 ?? buyerPrice;
  return buyerPrice;
}

function nowMs() {
  return Date.now();
}

async function safeSendDM(client, discordUserId, payload) {
  try {
    const u = await client.users.fetch(discordUserId);
    if (!u) return null;
    const msg = await u.send(payload);
    return msg;
  } catch (e) {
    console.warn("DM failed:", e?.message || e);
    return null;
  }
}

/**
 * ✅ FIXED: DM-safe defer helper.
 * - Ephemeral only works in guilds
 * - Always ACK quickly to avoid "This interaction failed"
 */
async function safeDefer(interaction, { ephemeral = true } = {}) {
  try {
    if (ephemeral && interaction.inGuild()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } else {
      await interaction.deferReply();
    }
    return true;
  } catch (e) {
    if (e?.code === 10062) {
      console.warn("deferReply failed: Unknown interaction (10062) - ignoring");
      return false;
    }
    console.error("safeDefer failed:", e);
    return false;
  }
}

/**
 * ✅ FIXED: DM-safe reply helper.
 * - Only applies ephemeral flags in guilds
 */
async function safeReply(interaction, payload, { ephemeral = true } = {}) {
  try {
    const data = typeof payload === "string" ? { content: payload } : (payload || {});

    if (ephemeral && interaction.inGuild()) {
      if (!data.flags) data.flags = MessageFlags.Ephemeral;
    } else {
      delete data.flags;
      delete data.ephemeral;
    }

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(data);
    } else {
      await interaction.reply(data);
    }
  } catch (e) {
    if (e?.code === 10062) return;
    if (e?.code === 40060) return;
    console.error("safeReply failed:", e);
  }
}

async function safeEditMessage(msg, patch) {
  try {
    await msg.edit(patch);
  } catch (e) {
    console.warn("message.edit failed:", e?.message || e);
  }
}

function dmJumpUrl(dmChannelId, dmMessageId) {
  if (!dmChannelId || !dmMessageId) return "";
  return `https://discord.com/channels/@me/${dmChannelId}/${dmMessageId}`;
}

function dmJumpRow(dmChannelId, dmMessageId) {
  const url = dmJumpUrl(dmChannelId, dmMessageId);
  if (!url) return null;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel("Go to embed")
  );
}

async function buildMakePayload({ recordId, client }) {
  const rec = await base(WTB_TABLE).find(recordId);

  const sku = String(rec.get("SKU (API)") || rec.get("SKU") || "").trim();
  const size = String(rec.get("Size") || "").trim();
  const brand = getBrandText(rec.get("Brand"));

  const pic = rec.get(FIELD_PICTURE);
  const imageUrl = Array.isArray(pic) && pic.length && pic[0]?.url ? pic[0].url : "";

  const productName =
    String(rec.get("Product Name") || "").trim() ||
    [brand, sku].filter(Boolean).join(" ").trim();

  const orderId = String(rec.get("Member WTB ID") || rec.get("OrderId") || "").trim();

  const sellerDiscordId = String(rec.get(FIELD_CLAIMED_SELLER_DISCORD_ID) || "").trim();
  const vatType = String(rec.get(FIELD_CLAIMED_SELLER_VAT_TYPE) || "").trim();
  const payout = Number(rec.get(FIELD_LOCKED_PAYOUT) || 0);

  const dealChannelId = String(rec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
  const claimMessageUrl = String(rec.get(FIELD_CLAIM_MESSAGE_URL) || "").trim();
  const sellerRecordId = getLinkedRecordId(rec.get(FIELD_CLAIMED_SELLER));

  return {
    orderId,
    productName,
    sku,
    size,
    brand,
    payout,
    discordUserId: sellerDiscordId,
    imageUrl,
    vatType,

    source: "Member WTB",
    recordId,
    dealChannelId,
    sellerDiscordId,
    sellerRecordId,
    lockedPayout: payout,
    claimMessageUrl
  };
}

/* ---------------- Main registration ---------------- */

export function registerMemberWtbClaimFlow(client) {
  if (__memberWtbClaimFlowRegistered) return;
  __memberWtbClaimFlowRegistered = true;

  // Runtime state
  const sellerMap = new Map(); // channelId -> claim context
  const uploadedImagesMap = new Map(); // channelId -> [urls]

  // Store DM "buttons message" per buyer+record (RAM only; clears on restart)
  const buyerDmMsgMap = new Map(); // key -> { messageId, channelId }
  const dmKey = (buyerDiscordId, recordId) => `${buyerDiscordId}:${recordId}`;

  // buyer label sessions
  const pendingBuyerLabelMap = new Map();
  const PENDING_LABEL_TTL_MS = 5 * 60 * 1000;
  const pendingKey = (buyerDiscordId, recordId) => `${buyerDiscordId}:${recordId}`;

  // buyer payment proof sessions
  const pendingBuyerPaymentMap = new Map();
  const PENDING_PAYMENT_TTL_MS = 5 * 60 * 1000;
  const payKey = (buyerDiscordId, recordId) => `${buyerDiscordId}:${recordId}`;

  function setPendingPaymentSession({ buyerDiscordId, recordId, messageId, channelId }) {
    const now = nowMs();
    pendingBuyerPaymentMap.set(payKey(buyerDiscordId, recordId), {
      buyerDiscordId,
      recordId,
      messageId: messageId || "",
      channelId: channelId || "",
      createdAt: now,
      expiresAt: now + PENDING_PAYMENT_TTL_MS
    });
  }

  function getPendingPaymentSession(buyerDiscordId, recordId) {
    const key = payKey(buyerDiscordId, recordId);
    const s = pendingBuyerPaymentMap.get(key);
    if (!s) return null;
    if (nowMs() > s.expiresAt) {
      pendingBuyerPaymentMap.delete(key);
      return null;
    }
    return s;
  }

  function clearPendingPaymentSession(buyerDiscordId, recordId) {
    pendingBuyerPaymentMap.delete(payKey(buyerDiscordId, recordId));
  }

  function setPendingLabelSession({ buyerDiscordId, recordId, tracking, messageId, channelId }) {
    const now = nowMs();
    pendingBuyerLabelMap.set(pendingKey(buyerDiscordId, recordId), {
      buyerDiscordId,
      recordId,
      tracking: tracking || "",
      messageId: messageId || "",
      channelId: channelId || "",
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

  // Debug safety
  client.on("error", (e) => console.error("[DISCORD CLIENT ERROR]", e));
  process.on("unhandledRejection", (e) => console.error("[UNHANDLED REJECTION]", e));
  process.on("uncaughtException", (e) => console.error("[UNCAUGHT EXCEPTION]", e));

  client.on(Events.InteractionCreate, async (interaction) => {
    // ✅ helpful debugging
    console.log("[InteractionCreate]", {
      isButton: interaction.isButton?.(),
      isModal: interaction.isModalSubmit?.(),
      customId: interaction.customId,
      inGuild: interaction.inGuild?.(),
      user: interaction.user?.id
    });

    // 1) Listing claim button -> show modal
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

    // 2) Claim modal submit -> validate seller + lock payout + create deal channel
    if (interaction.isModalSubmit() && interaction.customId.startsWith("member_wtb_claim_modal_")) {
      const ok = await safeDefer(interaction, { ephemeral: true });
      if (!ok) return;

      const recordId = interaction.customId.replace("member_wtb_claim_modal_", "").trim();

      const sellerIdRaw = String(interaction.fields.getTextInputValue("seller_id") || "").replace(/\D/g, "");
      if (!sellerIdRaw) {
        return safeReply(interaction, "❌ Please enter a valid Seller ID (e.g. 00001).", { ephemeral: true });
      }
      const sellerId = `SE-${sellerIdRaw.padStart(5, "0")}`;

      const vatType = parseVatType(interaction.fields.getTextInputValue("vat_type"));
      if (!vatType) {
        return safeReply(interaction, '❌ Invalid VAT Type. Use **Margin**, **VAT21** or **VAT0**.', { ephemeral: true });
      }

      let wtbRec;
      try {
        wtbRec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        console.error("WTB find failed:", e);
        return safeReply(interaction, "❌ Could not load the WTB record. Check recordId.", { ephemeral: true });
      }

      // idempotency
      const existingClaimedChannelId = String(wtbRec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
      const existingStatus = String(wtbRec.get(FIELD_FULFILLMENT_STATUS) || "").trim();
      if (existingClaimedChannelId && existingStatus === "Claim Processing") {
        return safeReply(interaction, `⚠️ This deal is already being processed in <#${existingClaimedChannelId}>.`, { ephemeral: true });
      }

      const asText = (v) => firstText(v);

      const sku = asText(wtbRec.get("SKU (API)")).trim();
      const size = asText(wtbRec.get("Size")).trim();
      const brand = asText(wtbRec.get("Brand")).trim();

      const orderId = String(wtbRec.get("Member WTB ID") || wtbRec.get("OrderId") || "").trim();

      const productName =
        String(wtbRec.get("Product Name") || "").trim() ||
        [brand, sku].filter(Boolean).join(" ").trim();

      const marginPayout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_MARGIN));
      const vat0Payout = toNumber(wtbRec.get(FIELD_CURRENT_PAYOUT_VAT0));

      if (marginPayout == null || vat0Payout == null) {
        return safeReply(
          interaction,
          `❌ Could not lock payout because current payout fields are missing/invalid.\n` +
            `Check Airtable fields:\n- ${FIELD_CURRENT_PAYOUT_MARGIN}\n- ${FIELD_CURRENT_PAYOUT_VAT0}`,
          { ephemeral: true }
        );
      }

      const lockedPayout = vatType === "VAT0" ? vat0Payout : marginPayout;
      if (!Number.isFinite(lockedPayout)) {
        return safeReply(interaction, "❌ Locked payout is not a valid number.", { ephemeral: true });
      }

      const sellerRecords = await base(SELLERS_TABLE)
        .select({ filterByFormula: `{Seller ID} = "${sellerId}"`, maxRecords: 1 })
        .firstPage();

      if (!sellerRecords.length) {
        return safeReply(interaction, `❌ Seller ID **${sellerId}** not found.`, { ephemeral: true });
      }

      const guild = await client.guilds.fetch(CONFIG.guildId);

      const pickedCategory = await pickCategoryWithSpace(guild, DEAL_CATEGORY_IDS);
      if (!pickedCategory) {
        return safeReply(interaction, "❌ All Member WTB categories are full (50 channels each). Add a new category.", { ephemeral: true });
      }

      const channelName = toChannelSlug(orderId || `wtb-${sku}-${size}`);

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
          `**Order:** ${orderId || "-"}\n` +
            `**Product:** ${productName || "-"}\n` +
            `**SKU:** ${sku || "-"}\n` +
            `**Size:** ${size || "-"}\n` +
            `**Brand:** ${brand || "-"}\n` +
            `**Payout:** €${lockedPayout.toFixed(2)}\n` +
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
        confirmSent: false,
        dealConfirmed: false
      });

      await base(WTB_TABLE).update(recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Claim Processing",
        [FIELD_CLAIMED_CHANNEL_ID]: dealChannel.id,
        [FIELD_CLAIMED_MESSAGE_ID]: dealMsg.id,
        [FIELD_CLAIMED_SELLER]: [sellerRecords[0].id],
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: interaction.user.id,
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: vatType,
        [FIELD_LOCKED_PAYOUT]: lockedPayout,
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

      return safeReply(
        interaction,
        `✅ Claimed! Your deal channel is <#${dealChannel.id}>.\nClick **Process Claim** there to verify your Seller ID and start photo upload.`,
        { ephemeral: true }
      );
    }

    // 3) Process claim -> verify seller
    if (interaction.isButton() && interaction.customId === "member_wtb_start_claim") {
      const channelId = interaction.channel?.id;
      if (!channelId) return;

      // ✅ ACK quickly (prevents "interaction failed" on cold starts)
      await safeDefer(interaction, { ephemeral: true }).catch(() => null);

      let data = sellerMap.get(channelId);

      try {
        // restore after restart
        if (!data?.recordId || !data?.sellerRecordId) {
          const recs = await base(WTB_TABLE)
            .select({ filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${channelId}"`, maxRecords: 1 })
            .firstPage();

          if (!recs.length) {
            return safeReply(interaction, "❌ Could not find the linked Member WTB record for this channel.", { ephemeral: true });
          }

          const rec = recs[0];
          const sellerRecordId = getLinkedRecordId(rec.get(FIELD_CLAIMED_SELLER));

          data = {
            ...(data || {}),
            recordId: rec.id,
            sellerRecordId,
            sellerDiscordId: rec.get(FIELD_CLAIMED_SELLER_DISCORD_ID),
            vatType: rec.get(FIELD_CLAIMED_SELLER_VAT_TYPE),
            lockedPayout: rec.get(FIELD_LOCKED_PAYOUT),
            confirmed: !!rec.get(FIELD_CLAIMED_SELLER_CONFIRMED),
            dealConfirmed: false
          };

          sellerMap.set(channelId, data);
        }

        if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
          return safeReply(interaction, "❌ Only the claimed seller can process this claim.", { ephemeral: true });
        }

        if (!data?.sellerRecordId) {
          return safeReply(
            interaction,
            `❌ No linked Seller record found.\nCheck Airtable field **"${FIELD_CLAIMED_SELLER}"** is a LINKED RECORD to Sellers Database and gets filled on claim.`,
            { ephemeral: true }
          );
        }

        const sellerRecord = await base(SELLERS_TABLE).find(data.sellerRecordId);
        const sellerIdField = sellerRecord.get("Seller ID") || "Unknown ID";
        const discordUsername = sellerRecord.get("Discord") || "Unknown";

        const confirmRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("member_wtb_confirm_seller").setLabel("✅ Yes, that is me").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("member_wtb_reject_seller").setLabel("❌ No, not me").setStyle(ButtonStyle.Danger)
        );

        return safeReply(
          interaction,
          {
            content: `🔍 We found this Discord Username linked to Seller ID **${sellerIdField}**:\n**${discordUsername}**\n\nIs this you?`,
            components: [confirmRow]
          },
          { ephemeral: false } // not ephemeral in channel reply; change to true if you prefer
        );
      } catch (err) {
        console.error("member_wtb_start_claim failed:", err);
        return safeReply(interaction, "❌ Something went wrong while verifying your Seller ID. Try again or contact staff.", { ephemeral: true });
      }
    }

    // 4) Confirm seller -> ask for 6 pics
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_seller") {
      const data = sellerMap.get(interaction.channel?.id) || {};
      if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
        return interaction.reply({ content: "❌ Only the claimed seller can confirm.", flags: MessageFlags.Ephemeral });
      }

      await interaction.deferUpdate().catch(() => {});
      sellerMap.set(interaction.channel.id, { ...data, confirmed: true });

      if (data?.recordId) {
        await base(WTB_TABLE).update(data.recordId, { [FIELD_CLAIMED_SELLER_CONFIRMED]: true }).catch(() => {});
      }

      await safeEditMessage(interaction.message, {
        content: '✅ Seller ID confirmed.\nPlease upload **6 different** pictures of the pair like shown below to prove it is in-hand and complete.',
        components: []
      });

      try {
        await interaction.channel.send({ files: ["https://i.imgur.com/JKaeeNz.png"] });
      } catch (_) {}

      return;
    }

    if (interaction.isButton() && interaction.customId === "member_wtb_reject_seller") {
      const data = sellerMap.get(interaction.channel?.id) || {};
      if (data?.sellerDiscordId && interaction.user.id !== String(data.sellerDiscordId)) {
        return interaction.reply({ content: "❌ Only the claimed seller can reject.", flags: MessageFlags.Ephemeral });
      }
      await interaction.deferUpdate().catch(() => {});
      await safeEditMessage(interaction.message, { content: "⚠️ Then cancel this deal and claim again with the correct Seller ID.", components: [] });
      return;
    }

    // 5) Cancel deal -> reset airtable + re-enable listing + delete channel
    if (interaction.isButton() && interaction.customId === "member_wtb_cancel_deal") {
      const memberRoles = interaction.member?.roles?.cache?.map((r) => r.id) || [];
      const isAdmin = ADMIN_ROLE_IDS.length ? ADMIN_ROLE_IDS.some((id) => memberRoles.includes(id)) : true;

      if (!isAdmin) {
        return interaction.reply({
          content: "❌ Only staff can cancel a deal. Please tag an admin if something is wrong.",
          flags: MessageFlags.Ephemeral
        });
      }

      const ok = await safeDefer(interaction, { ephemeral: true });
      if (!ok) return;

      let data = sellerMap.get(interaction.channel?.id);

      if (!data?.recordId) {
        const recs = await base(WTB_TABLE)
          .select({ filterByFormula: `{${FIELD_CLAIMED_CHANNEL_ID}} = "${interaction.channel.id}"`, maxRecords: 1 })
          .firstPage();

        if (!recs.length) return safeReply(interaction, "❌ Missing recordId.", { ephemeral: true });
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

      await base(WTB_TABLE).update(data.recordId, {
        [FIELD_FULFILLMENT_STATUS]: "Outsource",
        [FIELD_CLAIMED_CHANNEL_ID]: "",
        [FIELD_CLAIMED_MESSAGE_ID]: "",
        [FIELD_CLAIMED_SELLER_DISCORD_ID]: "",
        [FIELD_CLAIMED_SELLER_VAT_TYPE]: null,
        [FIELD_CLAIMED_SELLER]: [],
        [FIELD_LOCKED_PAYOUT]: null,
        [FIELD_BUYER_PAYMENT_REQUESTED_AT]: null,
        [FIELD_CLAIMED_SELLER_CONFIRMED]: false,
        [FIELD_TRACKING_NUMBER]: "",
        [FIELD_SHIPPING_LABEL]: "",
        [FIELD_PAYMENT_PROOF]: ""
      });

      await safeReply(interaction, "✅ Cancelled. Channel will be deleted.", { ephemeral: true });
      setTimeout(() => interaction.channel?.delete().catch(() => {}), 2500);
      return;
    }

    // 6) Admin confirm deal button
    if (interaction.isButton() && interaction.customId === "member_wtb_confirm_deal") {
      const memberRoles = interaction.member?.roles?.cache?.map((r) => r.id) || [];
      const isAdmin = ADMIN_ROLE_IDS.length ? ADMIN_ROLE_IDS.some((id) => memberRoles.includes(id)) : true;

      if (!isAdmin) {
        return interaction.reply({ content: "❌ Not authorized.", flags: MessageFlags.Ephemeral });
      }

      const ok = await safeDefer(interaction, { ephemeral: true });
      if (!ok) return;

      const channelId = interaction.channel?.id;
      const data = sellerMap.get(channelId);
      if (!data?.recordId) return safeReply(interaction, "❌ Missing recordId for this deal.", { ephemeral: true });

      let rec;
      try {
        rec = await base(WTB_TABLE).find(data.recordId);
      } catch (e) {
        console.error("Could not load Member WTB record:", e);
        return safeReply(interaction, "❌ Could not load Airtable record.", { ephemeral: true });
      }

      const sku = String(rec.get("SKU (API)") || rec.get("SKU") || "").trim();
      const size = String(rec.get("Size") || "").trim();
      const brand = getBrandText(rec.get("Brand"));

      const pic = rec.get(FIELD_PICTURE);
      const imageUrl = Array.isArray(pic) && pic.length && pic[0]?.url ? pic[0].url : "";

      const productName =
        String(rec.get("Product Name") || "").trim() ||
        [brand, sku].filter(Boolean).join(" ").trim();

      const payout = Number(data.lockedPayout || 0);
      const sellerCode = String(data.sellerId || "").trim();
      const discordUserId = String(data.sellerDiscordId || "").trim();
      const orderId = String(rec.get("Member WTB ID") || rec.get("OrderId") || "").trim();

      const payload = {
        orderId,
        productName,
        sku,
        size,
        brand,
        payout,
        sellerCode,
        discordUserId,
        imageUrl,
        vatType: String(data.vatType || "").trim(),

        source: "Member WTB",
        recordId: data.recordId,
        dealChannelId: channelId,
        sellerRecordId: data.sellerRecordId,
        sellerDiscordId: data.sellerDiscordId,
        sellerId: data.sellerId,
        lockedPayout: payout,
        claimMessageUrl: String(rec.get(FIELD_CLAIM_MESSAGE_URL) || "").trim()
      };

      // DM buyer
      let dmOk = false;

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
          const beneficiary = process.env.PAYMENT_BENEFICIARY || "Payout by Kickz Caviar";

          const embed = new EmbedBuilder()
            .setTitle("✅ Your WTB has been matched")
            .setColor(0xffed00)
            .setDescription("We are ready to ship. Please pay and upload **payment proof** first.")
            .addFields(
              { name: "Order", value: orderId || "—", inline: false },
              { name: "Product", value: productName || "—", inline: false },
              { name: "SKU", value: sku || "—", inline: true },
              { name: "Size", value: size || "—", inline: true },
              { name: "Amount to pay (before shipping)", value: `€${Number(finalAmount || 0).toFixed(2)}`, inline: false }
            );

          const paymentLines = [
            ...(iban ? [`• **IBAN:** ${iban} (${beneficiary})`] : []),
            ...(paypal ? [`• **PayPal:** ${paypal}`] : [])
          ];
          if (paymentLines.length) {
            embed.addFields({ name: "Payment method", value: paymentLines.join("\n"), inline: false });
          }

          embed.addFields({
            name: "Next steps",
            value:
              `1) Upload **payment proof** (screenshot/photo) in this DM.\n` +
              `2) After proof is received, **Upload Label** unlocks.\n` +
              `3) Click **Upload Label** and submit your UPS tracking.\n` +
              `4) Then drop the UPS label PDF/image in the chat.`,
            inline: false
          });

          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${BTN_UPLOAD_PAYMENT_PROOF}:${data.recordId}`)
              .setLabel("Upload Payment Proof")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`${BTN_UPLOAD_LABEL}:${data.recordId}`)
              .setLabel("Upload Label")
              .setStyle(ButtonStyle.Success)
              .setDisabled(true)
          );

          const dmMsg = await safeSendDM(client, buyerDiscordId, { embeds: [embed], components: [row] });

          dmOk = !!dmMsg;

          if (dmOk) {
            buyerDmMsgMap.set(dmKey(buyerDiscordId, data.recordId), {
              messageId: dmMsg.id,
              channelId: dmMsg.channel.id
            });

            await base(WTB_TABLE).update(data.recordId, {
              [FIELD_BUYER_PAYMENT_REQUESTED_AT]: new Date().toISOString()
            }).catch(() => {});
          }
        }
      } catch (e) {
        console.warn("Buyer DM step failed:", e?.message || e);
      }

      // disable confirm button etc
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("member_wtb_confirm_deal").setLabel("Confirm Deal").setStyle(ButtonStyle.Success).setDisabled(true)
        );
        await safeEditMessage(interaction.message, { components: [disabledRow] });
      } catch (_) {}

      try {
        await interaction.channel.send(`✅ **Deal confirmed.** Buyer has been notified for label upload${dmOk ? "" : " (DM failed)"}.`);
      } catch (_) {}

      sellerMap.set(channelId, { ...data, dealConfirmed: true });

      return safeReply(interaction, "✅ Done. Buyer DM step executed.", { ephemeral: true });
    }

    /**
     * ✅ FIXED: Buyer DM: click Upload Payment Proof
     * - ACK immediately (deferReply) to avoid timeouts on cold starts
     * - No ephemeral flags in DMs
     */
    if (interaction.isButton() && String(interaction.customId || "").startsWith(`${BTN_UPLOAD_PAYMENT_PROOF}:`)) {
      if (interaction.inGuild()) {
        return interaction.reply({ content: "❌ Please use this in DM.", flags: MessageFlags.Ephemeral });
      }

      const ok = await safeDefer(interaction, { ephemeral: false }); // DM
      if (!ok) return;

      const recordId = String(interaction.customId).split(":")[1];
      const buyerDiscordId = interaction.user.id;

      let rec;
      try {
        rec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        console.error("Airtable find failed (payment proof):", e);
        return safeReply(interaction, "❌ Invalid deal reference (could not load deal).", { ephemeral: false });
      }

      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        return safeReply(interaction, "❌ You are not authorized for this deal.", { ephemeral: false });
      }

      // If proof already exists, unlock label button immediately
      const proof = rec.get(FIELD_PAYMENT_PROOF);
      const hasProof = Array.isArray(proof) && proof.length;
      if (hasProof) {
        try {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${BTN_UPLOAD_PAYMENT_PROOF}:${recordId}`)
              .setLabel("Upload Payment Proof")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`${BTN_UPLOAD_LABEL}:${recordId}`)
              .setLabel("Upload Label")
              .setStyle(ButtonStyle.Success)
              .setDisabled(false)
          );
          await interaction.message.edit({ components: [row] }).catch(() => {});
        } catch (_) {}

        return safeReply(interaction, "✅ Payment proof already received. You can now click **Upload Label**.", { ephemeral: false });
      }

      // Block if a LABEL session for this same order is active
      const existingLabel = getPendingLabelSession(buyerDiscordId, recordId);
      if (existingLabel) {
        return safeReply(
          interaction,
          "⚠️ You already started **Upload Label** for this order. Please finish it first (or wait 5 minutes).",
          { ephemeral: false }
        );
      }

      // Block any other active PAYMENT session for this buyer (other orders)
      for (const s of pendingBuyerPaymentMap.values()) {
        if (s.buyerDiscordId === buyerDiscordId && s.recordId !== recordId && nowMs() <= s.expiresAt) {
          return safeReply(
            interaction,
            "⚠️ You already have an active **Payment Proof** session for another order. Please finish it first (or wait 5 minutes).",
            { ephemeral: false }
          );
        }
      }

      // Start/refresh payment proof session
      const stored = buyerDmMsgMap.get(dmKey(buyerDiscordId, recordId));
      setPendingPaymentSession({
        buyerDiscordId,
        recordId,
        messageId: stored?.messageId || interaction.message?.id || "",
        channelId: stored?.channelId || interaction.channelId || ""
      });

      return safeReply(
        interaction,
        "✅ Session started. Please upload your **payment proof** (image/PDF) in this DM within **5 minutes**.",
        { ephemeral: false }
      );
    }

    /**
     * ✅ FIXED: Buyer DM: click Upload Label
     * IMPORTANT: showModal must be called quickly; do NOT do Airtable calls here.
     * We moved all Airtable checks to the modal submit handler.
     */
    if (interaction.isButton() && String(interaction.customId || "").startsWith(`${BTN_UPLOAD_LABEL}:`)) {
      if (interaction.inGuild()) {
        return interaction.reply({ content: "❌ Please use this in DM.", flags: MessageFlags.Ephemeral });
      }

      const recordId = String(interaction.customId).split(":")[1];
      const buyerDiscordId = interaction.user.id;

      // Save DM buttons message location for later steps
      const session = getPendingLabelSession(buyerDiscordId, recordId);
      setPendingLabelSession({
        buyerDiscordId,
        recordId,
        tracking: session?.tracking || "",
        messageId: session?.messageId || interaction.message?.id || "",
        channelId: session?.channelId || interaction.channelId || ""
      });

      const modal = new ModalBuilder()
        .setCustomId(`${MODAL_UPLOAD_LABEL}:${recordId}`)
        .setTitle("Upload UPS Label");

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

    /**
     * ✅ FIXED: Buyer DM: modal submit
     * - DM-safe defer/reply (no ephemeral in DMs)
     * - Airtable checks moved here (instead of button click)
     */
    if (interaction.isModalSubmit() && String(interaction.customId || "").startsWith(`${MODAL_UPLOAD_LABEL}:`)) {
      if (interaction.inGuild()) {
        // if someone manages to open it in guild, reply ephemeral
        const ok = await safeDefer(interaction, { ephemeral: true });
        if (!ok) return;
        return safeReply(interaction, "❌ Please do this in DM.", { ephemeral: true });
      }

      const ok = await safeDefer(interaction, { ephemeral: false }); // DM
      if (!ok) return;

      const recordId = String(interaction.customId).split(":")[1];
      const buyerDiscordId = interaction.user.id;

      const tracking = String(interaction.fields.getTextInputValue("tracking") || "").trim().toUpperCase();
      if (!tracking.startsWith("1Z")) {
        return safeReply(interaction, '❌ Invalid UPS tracking. It must start with **"1Z"**.', { ephemeral: false });
      }

      let rec;
      try {
        rec = await base(WTB_TABLE).find(recordId);
      } catch (e) {
        console.error("Airtable find failed (label modal):", e);
        return safeReply(interaction, "❌ Invalid deal reference (could not load deal).", { ephemeral: false });
      }

      // ✅ BLOCK if label already received
      const existingLabel = rec.get(FIELD_SHIPPING_LABEL);
      const hasLabelAlready = Array.isArray(existingLabel) && existingLabel.length;
      if (hasLabelAlready) {
        return safeReply(interaction, "✅ We already received your shipping label for this order.", { ephemeral: false });
      }

      // ✅ Authorization
      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        return safeReply(interaction, "❌ You are not authorized to upload a label for this deal.", { ephemeral: false });
      }

      // ✅ Must have payment proof first
      const proof = rec.get(FIELD_PAYMENT_PROOF);
      const hasProof = Array.isArray(proof) && proof.length;
      if (!hasProof) {
        return safeReply(interaction, "❌ Please upload **payment proof** first using **Upload Payment Proof**.", { ephemeral: false });
      }

      // ✅ Block if they are still in a PAYMENT PROOF session for this record
      if (getPendingPaymentSession(buyerDiscordId, recordId)) {
        return safeReply(interaction, "⚠️ Please finish the **Payment Proof** upload first (or wait 5 minutes).", { ephemeral: false });
      }

      // Find stored label session to get DM buttons message info
      const prev = getPendingLabelSession(buyerDiscordId, recordId);

      if (!prev?.messageId || !prev?.channelId) {
        return safeReply(
          interaction,
          "❌ Could not locate the buttons message. Please click **Upload Label** again from the buttons message.",
          { ephemeral: false }
        );
      }

      // Update session with tracking (keep messageId/channelId)
      setPendingLabelSession({
        buyerDiscordId,
        recordId,
        tracking,
        messageId: prev.messageId,
        channelId: prev.channelId
      });

      const jumpRow = dmJumpRow(prev.channelId, prev.messageId);

      return safeReply(
        interaction,
        {
          content: "✅ Tracking saved. Now drop the **label file** (PDF/image) below in the chat.",
          components: jumpRow ? [jumpRow] : []
        },
        { ephemeral: false }
      );
    }
  });

  // 9) MessageCreate: count seller photos (guild) + capture buyer label/proof file (DM)
  client.on(Events.MessageCreate, async (message) => {
    if (message.author?.bot) return;

    console.log("[MessageCreate]", {
      inGuild: message.inGuild(),
      author: message.author?.id,
      channelId: message.channel?.id,
      attachments: message.attachments?.size || 0
    });

    // -------- Buyer DM label/payment proof upload capture --------
    if (!message.inGuild()) {
      if (!message.attachments?.size) return;

      const buyerDiscordId = message.author.id;

      const att = [...message.attachments.values()][0];
      const name = String(att?.name || att?.filename || "").toLowerCase();
      const ct = String(att?.contentType || "").toLowerCase();
      const isPdf = ct.includes("pdf") || name.endsWith(".pdf");
      const isImage = ct.startsWith("image/") || /\.(png|jpg|jpeg|webp)$/i.test(name);
      if (!isPdf && !isImage) {
        await message.channel.send("❌ File must be a **PDF or image**.");
        return;
      }

      // 1) PAYMENT PROOF SESSION?
      let activePay = null;
      for (const s of pendingBuyerPaymentMap.values()) {
        if (s.buyerDiscordId === buyerDiscordId && nowMs() <= s.expiresAt) {
          activePay = s;
          break;
        }
      }

      if (activePay) {
        const rec = await base(WTB_TABLE).find(activePay.recordId).catch(() => null);
        if (!rec) {
          clearPendingPaymentSession(buyerDiscordId, activePay.recordId);
          buyerDmMsgMap.delete(dmKey(buyerDiscordId, activePay.recordId));
          await message.channel.send("❌ Could not find your deal anymore.");
          return;
        }

        const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
        if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
          clearPendingPaymentSession(buyerDiscordId, activePay.recordId);
          buyerDmMsgMap.delete(dmKey(buyerDiscordId, activePay.recordId));
          await message.channel.send("❌ Unauthorized proof upload blocked.");
          return;
        }

        // Save proof
        await base(WTB_TABLE).update(activePay.recordId, {
          [FIELD_PAYMENT_PROOF]: [{ url: att.url, filename: att.name || "payment-proof" }]
        });

        // Enable Upload Label button by editing the original DM message
        try {
          const dmMsgId = activePay.messageId;
          const dmChannelId = activePay.channelId;

          if (dmMsgId && dmChannelId) {
            const dmChannel = await client.channels.fetch(dmChannelId).catch(() => null);
            if (dmChannel?.isTextBased()) {
              const dmMsg = await dmChannel.messages.fetch(dmMsgId).catch(() => null);
              if (dmMsg) {
                const recordId = activePay.recordId;

                const row = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`${BTN_UPLOAD_PAYMENT_PROOF}:${recordId}`)
                    .setLabel("Upload Payment Proof")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setCustomId(`${BTN_UPLOAD_LABEL}:${recordId}`)
                    .setLabel("Upload Label")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(false)
                );

                await dmMsg.edit({ components: [row] });
              }
            }
          }
        } catch (e) {
          console.warn("Failed enabling label button:", e?.message || e);
        }

        clearPendingPaymentSession(buyerDiscordId, activePay.recordId);

        const jumpRow = dmJumpRow(activePay.channelId || message.channel.id, activePay.messageId);

        await message.channel.send({
          content: "✅ Payment proof received. You can now click **Upload Label**.",
          components: jumpRow ? [jumpRow] : []
        });
        return;
      }

      // 2) LABEL SESSION?
      const sessions = [];
      for (const s of pendingBuyerLabelMap.values()) {
        if (s.buyerDiscordId === buyerDiscordId && nowMs() <= s.expiresAt) sessions.push(s);
      }
      if (!sessions.length) {
        await message.channel.send("❌ No active upload session found. Please click **Upload Label** first.");
        return;
      }

      if (sessions.length > 1) {
        sessions.sort((a, b) => b.createdAt - a.createdAt);
        for (const s of sessions.slice(1)) {
          clearPendingLabelSession(s.buyerDiscordId, s.recordId);
        }
        await message.channel.send("⚠️ You had multiple active label sessions. I kept the newest one. Please upload the label file again now.");
      }

      sessions.sort((a, b) => b.createdAt - a.createdAt);
      const pending = sessions[0];

      if (!pending.tracking) {
        await message.channel.send("❌ Please click **Upload Label** first and submit the tracking number.");
        return;
      }

      let rec;
      try {
        rec = await base(WTB_TABLE).find(pending.recordId);
      } catch (e) {
        clearPendingLabelSession(buyerDiscordId, pending.recordId);
        buyerDmMsgMap.delete(dmKey(buyerDiscordId, pending.recordId));
        await message.channel.send("❌ Could not find your deal anymore.");
        return;
      }

      const existingLabelBefore = rec.get(FIELD_SHIPPING_LABEL);
      const alreadyHadLabel = Array.isArray(existingLabelBefore) && existingLabelBefore.length;
      console.log("[Label] pre-check", {
        recordId: pending.recordId,
        alreadyHadLabel,
        existingLabelCount: Array.isArray(existingLabelBefore) ? existingLabelBefore.length : 0
      });

      const buyerFromAirtable = firstText(rec.get(FIELD_BUYER_DISCORD_ID));
      if (!buyerFromAirtable || buyerFromAirtable !== buyerDiscordId) {
        clearPendingLabelSession(buyerDiscordId, pending.recordId);
        buyerDmMsgMap.delete(dmKey(buyerDiscordId, pending.recordId));
        await message.channel.send("❌ Unauthorized label upload blocked.");
        return;
      }

      try {
        await base(WTB_TABLE).update(pending.recordId, {
          [FIELD_TRACKING_NUMBER]: pending.tracking,
          [FIELD_SHIPPING_LABEL]: [{ url: att.url, filename: att.name || "label.pdf" }]
        });

        // Disable DM buttons after label received
        try {
          const dmMsgId = pending.messageId;
          const dmChannelId = pending.channelId;

          if (dmMsgId && dmChannelId) {
            const dmChannel = await client.channels.fetch(dmChannelId).catch(() => null);
            if (dmChannel?.isTextBased()) {
              const dmMsg = await dmChannel.messages.fetch(dmMsgId).catch(() => null);
              if (dmMsg) {
                const recordId = pending.recordId;

                const row = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`${BTN_UPLOAD_PAYMENT_PROOF}:${recordId}`)
                    .setLabel("Upload Payment Proof")
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                  new ButtonBuilder()
                    .setCustomId(`${BTN_UPLOAD_LABEL}:${recordId}`)
                    .setLabel("Upload Label")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true)
                );

                await dmMsg.edit({ components: [row] });
              }
            }
          }
        } catch (e) {
          console.warn("Failed disabling DM buttons after label:", e?.message || e);
        }

        // Send Make webhook ONLY once (first label upload)
        if (!alreadyHadLabel) {
          try {
            const payload = await buildMakePayload({ recordId: pending.recordId, client });

            console.log("[Make] label_uploaded check", {
              recordId: pending.recordId,
              alreadyHadLabel,
              urlSet: !!MAKE_MEMBER_WTB_WEBHOOK_URL
            });

            await fireMakeWebhook("label_uploaded", {
              ...payload,
              trackingNumber: pending.tracking,
              labelUrl: att.url,
              labelFilename: att.name || "label.pdf"
            });
          } catch (e) {
            console.error("Failed building/sending Make webhook (label):", e);
          }
        }

        clearPendingLabelSession(buyerDiscordId, pending.recordId);
        buyerDmMsgMap.delete(dmKey(buyerDiscordId, pending.recordId));

        await message.channel.send(`✅ Label saved.\n• Tracking: **${pending.tracking}**`);

        // forward to deal channel
        const dealChannelId = String(rec.get(FIELD_CLAIMED_CHANNEL_ID) || "").trim();
        if (dealChannelId) {
          const ch = await client.channels.fetch(dealChannelId).catch(() => null);
          if (ch?.isTextBased()) {
            await ch.send({
              content:
                `📦 **Shipping label received**\n` +
                `• Tracking: **${pending.tracking}**\n\n` +
                `📬\n` +
                `Please prepare the package and ensure it is packed in a clean, unbranded box with no unnecessary stickers or markings. **REMOVE ANY PRICETAGS!**\n\n` +
                `❌\n` +
                `Do not include anything inside the box, as this is not a standard deal.\n\n` +
                `📸\n` +
                `Please pack it as professionally as possible. If you're unsure, feel free to take a photo of the package and share it here before shipping.`,
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

    // -------- Seller 6-picture logic (guild only) --------
    if (!message.channel || message.channel.type !== ChannelType.GuildText) return;

    const data = sellerMap.get(message.channel.id);
    if (!data?.recordId) return;

    if (!data.confirmed) return;
    if (data.sellerDiscordId && message.author.id !== String(data.sellerDiscordId)) return;
    if (!message.attachments?.size) return;

    const imageUrls = [...message.attachments.values()]
      .filter((att) => String(att.contentType || "").startsWith("image/"))
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

  console.log("✅ registerMemberWtbClaimFlow: registered");
}

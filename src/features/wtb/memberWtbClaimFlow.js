import {
  Events,
  ChannelType,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder
} from "discord.js";

import { base } from "../../airtable/client.js";
import { CONFIG } from "../../config.js";
import { createTranscript } from "discord-html-transcripts";

/* =========================
   FIELD NAMES (Member WTBs)
   ========================= */

const T_WTB = () => base(CONFIG.wtbTable);
const T_SELLERS = () => base(CONFIG.sellersTable);

// Member WTB fields
const F_STATUS = "Fulfillment Status";
const F_NOTES = "Notes";

const F_SKU_SOFT = "SKU (Soft)";
const F_SIZE = "Size";
const F_BRAND = "Brand"; // optional, only for embeds

const F_CURRENT_PAYOUT = "Current Payout";
const F_MAX_PAYOUT = "Max Payout";
const F_LOCKED_PAYOUT = "Locked Payout";

const F_CLAIM_MSG_ID = "Claim Message ID";
const F_CLAIM_MSG_URL = "Claim Message URL";

const F_CLAIMED_CHANNEL_ID = "Claimed Channel ID";
const F_CLAIMED_MESSAGE_ID = "Claimed Message ID";
const F_CLAIMED_SELLER_ID = "Claimed Seller ID"; // link to Sellers Database
const F_CLAIMED_SELLER_DISCORD_ID = "Claimed Seller Discord ID";
const F_CLAIMED_SELLER_CONFIRMED = "Claimed Seller Confirmed?";
const F_CLAIMED_SELLER_VAT_TYPE = "Claimed Seller VAT Type"; // keep if you want, else remove

/* =========================
   PERMISSIONS / ADMIN
   ========================= */

const ADMIN_ROLE_IDS = (process.env.ADMIN_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// If you don’t set ADMIN_ROLE_IDS, it will allow only users with ManageGuild
function isAdminMember(member) {
  try {
    if (!member) return false;
    if (ADMIN_ROLE_IDS.length) {
      const roles = member.roles?.cache;
      return ADMIN_ROLE_IDS.some((id) => roles?.has(id));
    }
    return member.permissions?.has(PermissionsBitField.Flags.ManageGuild);
  } catch {
    return false;
  }
}

/* =========================
   DEAL CATEGORY PICKING
   ========================= */

const DEAL_CATEGORY_IDS = (process.env.MEMBER_WTB_DEAL_CATEGORY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function pickCategoryWithSpace(guild) {
  if (!DEAL_CATEGORY_IDS.length) return null;

  await guild.channels.fetch();

  const counts = new Map();
  for (const ch of guild.channels.cache.values()) {
    if (!ch.parentId) continue;
    counts.set(ch.parentId, (counts.get(ch.parentId) || 0) + 1);
  }

  const MAX = 50;
  for (const id of DEAL_CATEGORY_IDS) {
    const cat = guild.channels.cache.get(id);
    if (!cat) continue;
    if (cat.type !== ChannelType.GuildCategory) continue;
    const used = counts.get(id) || 0;
    if (used < MAX) return cat;
  }
  return null;
}

/* =========================
   HELPERS
   ========================= */

function upperTrim(v) {
  return String(v || "").trim().toUpperCase();
}

function toChannelSlug(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function extractChannelIdFromDiscordUrl(url) {
  // https://discord.com/channels/<guildId>/<channelId>/<messageId>
  const m = String(url || "").match(/discord\.com\/channels\/\d+\/(\d+)\/\d+/);
  return m ? m[1] : null;
}

function getNumberLike(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/[^\d.,-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// For seller lookups: allow "00001" -> "SE-00001" or already "SE-00001"
function normalizeSellerId(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.toUpperCase().startsWith("SE-")) {
    const digits = raw.replace(/\D/g, "");
    return `SE-${digits.padStart(5, "0")}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  return `SE-${digits.padStart(5, "0")}`;
}

/* =========================
   RUNTIME STATE
   ========================= */

const claimState = new Map(); // channelId -> { recordId, sellerRecordId, sellerDiscordId, lockedPayout, confirmed, confirmSent, dealEmbedId }
const uploadedImagesMap = new Map(); // channelId -> [imageUrls...]

/* =========================
   MAIN REGISTER
   ========================= */

export function registerMemberWtbClaimFlow(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      /* ======================================
         1) LISTING CLAIM BUTTON -> MODAL
         customId: member_wtb_claim_<recordId>
         ====================================== */
      if (interaction.isButton() && interaction.customId.startsWith("member_wtb_claim_")) {
        const recordId = interaction.customId.replace("member_wtb_claim_", "").trim();
        if (!recordId) return;

        // Safety: prevent double-claim
        let rec;
        try {
          rec = await T_WTB().find(recordId);
        } catch {
          return interaction.reply({ content: "❌ Could not find this WTB record.", ephemeral: true });
        }

        const status = String(rec.get(F_STATUS) || "").trim();
        const alreadyClaimedChannel = String(rec.get(F_CLAIMED_CHANNEL_ID) || "").trim();

        if (alreadyClaimedChannel || status.toLowerCase().includes("claim")) {
          return interaction.reply({ content: "⚠️ This deal is already being claimed.", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId(`member_wtb_claim_modal_${recordId}`)
          .setTitle("Claim Member WTB Deal");

        const sellerInput = new TextInputBuilder()
          .setCustomId("seller_id")
          .setLabel("Seller ID (e.g. 00001)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(sellerInput));

        return interaction.showModal(modal);
      }

      /* ======================================
         2) MODAL SUBMIT -> CREATE PRIVATE CHANNEL
         customId: member_wtb_claim_modal_<recordId>
         ====================================== */
      if (interaction.isModalSubmit() && interaction.customId.startsWith("member_wtb_claim_modal_")) {
        const recordId = interaction.customId.replace("member_wtb_claim_modal_", "").trim();
        const sellerIdInput = interaction.fields.getTextInputValue("seller_id");
        const sellerId = normalizeSellerId(sellerIdInput);

        if (!sellerId) {
          return interaction.reply({ content: "❌ Invalid Seller ID.", ephemeral: true });
        }

        // Load WTB
        const rec = await T_WTB().find(recordId);
        const sku = upperTrim(rec.get(F_SKU_SOFT));
        const size = String(rec.get(F_SIZE) || "").trim();
        const brand = String(rec.get(F_BRAND) || "").trim();

        // Lock payout at claim-time (IMPORTANT)
        const current = getNumberLike(rec.get(F_CURRENT_PAYOUT));
        const max = getNumberLike(rec.get(F_MAX_PAYOUT));
        const lockedPayout = current ?? max ?? null;

        if (!sku || !size || lockedPayout == null) {
          return interaction.reply({
            content: "❌ Missing SKU/Size/Payout on this record. Fix the Airtable record first.",
            ephemeral: true
          });
        }

        // Find seller record
        const sellers = await T_SELLERS()
          .select({
            filterByFormula: `{Seller ID} = "${sellerId}"`,
            maxRecords: 1
          })
          .firstPage();

        if (!sellers.length) {
          return interaction.reply({ content: `❌ Seller ID **${sellerId}** not found.`, ephemeral: true });
        }

        const sellerRecord = sellers[0];

        // Create channel
        const guild = await client.guilds.fetch(CONFIG.guildId);

        const pickedCategory = await pickCategoryWithSpace(guild);
        if (DEAL_CATEGORY_IDS.length && !pickedCategory) {
          return interaction.reply({
            content: "❌ All deal categories are full (50 channels each). Create a new category and add its ID to MEMBER_WTB_DEAL_CATEGORY_IDS.",
            ephemeral: true
          });
        }

        const suffix = recordId.slice(-5);
        const rawName = `wtb-${sku}-${size}-${suffix}`;
        const channelName = toChannelSlug(rawName);

        const channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          ...(pickedCategory ? { parent: pickedCategory.id } : {}),
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

        const embed = new EmbedBuilder()
          .setTitle("💸 Member WTB Claimed")
          .setColor(0xffed00)
          .setDescription(
            `**SKU:** ${sku}\n` +
              `**Size:** ${size}\n` +
              (brand ? `**Brand:** ${brand}\n` : "") +
              `**Locked Payout:** €${Number(lockedPayout).toFixed(2)}\n` +
              `**Seller (claimed with):** ${sellerId}`
          );

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("member_wtb_start_claim").setLabel("Process Claim").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("member_wtb_cancel_deal").setLabel("Cancel Deal").setStyle(ButtonStyle.Danger)
        );

        const dealMsg = await channel.send({ embeds: [embed], components: [row] });

        // Update Airtable status + locked payout + claimed info
        await T_WTB().update(recordId, {
          [F_STATUS]: "Claim Processing",
          [F_LOCKED_PAYOUT]: lockedPayout,
          [F_CLAIMED_CHANNEL_ID]: channel.id,
          [F_CLAIMED_MESSAGE_ID]: dealMsg.id,
          [F_CLAIMED_SELLER_ID]: [{ id: sellerRecord.id }],
          [F_CLAIMED_SELLER_DISCORD_ID]: interaction.user.id,
          [F_CLAIMED_SELLER_CONFIRMED]: false
        });

        // Disable claim button on listing message (so it doesn’t get claimed twice)
        try {
          const claimMsgId = String(rec.get(F_CLAIM_MSG_ID) || "").trim();
          const claimMsgUrl = String(rec.get(F_CLAIM_MSG_URL) || "").trim();
          const listingChannelId = extractChannelIdFromDiscordUrl(claimMsgUrl);

          if (claimMsgId && listingChannelId) {
            const listingChannel = await client.channels.fetch(listingChannelId);
            if (listingChannel?.isTextBased()) {
              const listingMsg = await listingChannel.messages.fetch(claimMsgId).catch(() => null);
              if (listingMsg) {
                const disabled = new ButtonBuilder()
                  .setCustomId(`member_wtb_claim_${recordId}`)
                  .setLabel("Claim Deal")
                  .setStyle(ButtonStyle.Secondary)
                  .setDisabled(true);

                await listingMsg.edit({
                  components: [new ActionRowBuilder().addComponents(disabled)]
                });
              }
            }
          }
        } catch (e) {
          console.warn("⚠️ Could not disable listing claim button:", e?.message || e);
        }

        // Cache state
        claimState.set(channel.id, {
          recordId,
          sellerRecordId: sellerRecord.id,
          sellerDiscordId: interaction.user.id,
          lockedPayout,
          confirmed: false,
          confirmSent: false,
          dealEmbedId: dealMsg.id
        });

        return interaction.reply({
          content: `✅ Claimed! Your deal channel is <#${channel.id}>.\nClick **Process Claim** inside that channel to verify your username and upload pictures.`,
          ephemeral: true
        });
      }

      /* ======================================
         3) PROCESS CLAIM -> ASK "IS THIS YOU?"
         ====================================== */
      if (interaction.isButton() && interaction.customId === "member_wtb_start_claim") {
        const channelId = interaction.channel?.id;
        if (!channelId) return;

        // Load from cache; if missing, recover from Airtable using channel id
        let data = claimState.get(channelId);
        if (!data?.recordId) {
          const recs = await T_WTB()
            .select({
              filterByFormula: `{${F_CLAIMED_CHANNEL_ID}} = "${channelId}"`,
              maxRecords: 1
            })
            .firstPage();
          if (recs.length) {
            const rec = recs[0];
            data = {
              recordId: rec.id,
              sellerRecordId: (rec.get(F_CLAIMED_SELLER_ID) || [])[0]?.id,
              sellerDiscordId: rec.get(F_CLAIMED_SELLER_DISCORD_ID),
              confirmed: !!rec.get(F_CLAIMED_SELLER_CONFIRMED),
              lockedPayout: getNumberLike(rec.get(F_LOCKED_PAYOUT))
            };
            claimState.set(channelId, data);
          }
        }

        if (!data?.sellerRecordId) {
          return interaction.reply({ content: "❌ Missing claimed Seller for this deal. Cancel and re-claim.", ephemeral: true });
        }

        const sellerRecord = await T_SELLERS().find(data.sellerRecordId);
        const sellerIdField = sellerRecord.get("Seller ID") || "Unknown";
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

      /* ======================================
         4) CONFIRM / REJECT SELLER
         ====================================== */
      if (interaction.isButton() && (interaction.customId === "member_wtb_confirm_seller" || interaction.customId === "member_wtb_reject_seller")) {
        const channelId = interaction.channel?.id;
        if (!channelId) return;

        let data = claimState.get(channelId) || {};

        try {
          await interaction.deferUpdate();
        } catch {
          // expired buttons etc.
        }

        if (interaction.customId === "member_wtb_confirm_seller") {
          claimState.set(channelId, { ...data, confirmed: true });

          // persist confirmed
          if (data.recordId) {
            await T_WTB().update(data.recordId, { [F_CLAIMED_SELLER_CONFIRMED]: true }).catch(() => null);
          }

          await interaction.message.edit({
            content: "✅ Seller ID confirmed.\nPlease upload **6 different** pictures of the pair like shown below to prove it is in-hand and complete.",
            components: []
          });

          // you can replace this image with your own guide image
          await interaction.channel.send({ files: ["https://i.imgur.com/JKaeeNz.png"] });

          return;
        }

        if (interaction.customId === "member_wtb_reject_seller") {
          await interaction.message.edit({
            content:
              "⚠️ Please check if the Seller ID was filled in correctly.\n\nIf it is wrong, cancel this deal and claim it again with the correct Seller ID.",
            components: []
          });
          return;
        }
      }

      /* ======================================
         5) CANCEL DEAL
         ====================================== */
      if (interaction.isButton() && interaction.customId === "member_wtb_cancel_deal") {
        await interaction.deferReply({ ephemeral: true }).catch(() => null);

        const channel = interaction.channel;
        const channelId = channel?.id;
        if (!channelId) return;

        let data = claimState.get(channelId);

        // Recover recordId if needed
        let recordId = data?.recordId;
        if (!recordId) {
          const recs = await T_WTB()
            .select({ filterByFormula: `{${F_CLAIMED_CHANNEL_ID}} = "${channelId}"`, maxRecords: 1 })
            .firstPage();
          if (recs.length) recordId = recs[0].id;
        }

        if (!recordId) return interaction.editReply("❌ Could not find Airtable record for this deal.");

        // Re-enable listing claim button
        try {
          const rec = await T_WTB().find(recordId);
          const claimMsgId = String(rec.get(F_CLAIM_MSG_ID) || "").trim();
          const claimMsgUrl = String(rec.get(F_CLAIM_MSG_URL) || "").trim();
          const listingChannelId = extractChannelIdFromDiscordUrl(claimMsgUrl);

          if (claimMsgId && listingChannelId) {
            const listingChannel = await client.channels.fetch(listingChannelId);
            if (listingChannel?.isTextBased()) {
              const listingMsg = await listingChannel.messages.fetch(claimMsgId).catch(() => null);
              if (listingMsg) {
                const enabled = new ButtonBuilder()
                  .setCustomId(`member_wtb_claim_${recordId}`)
                  .setLabel("Claim Deal")
                  .setStyle(ButtonStyle.Success)
                  .setDisabled(false);

                await listingMsg.edit({
                  components: [new ActionRowBuilder().addComponents(enabled)]
                });
              }
            }
          }
        } catch (e) {
          console.warn("⚠️ Could not re-enable listing claim button:", e?.message || e);
        }

        // Reset Airtable back to Outsource (timer continues from Created Time)
        await T_WTB().update(recordId, {
          [F_STATUS]: "Outsource",
          [F_CLAIMED_CHANNEL_ID]: "",
          [F_CLAIMED_MESSAGE_ID]: "",
          [F_CLAIMED_SELLER_ID]: [],
          [F_CLAIMED_SELLER_DISCORD_ID]: "",
          [F_CLAIMED_SELLER_CONFIRMED]: false,
          [F_CLAIMED_SELLER_VAT_TYPE]: null
        });

        // Transcript (optional)
        const transcriptsChannelId = process.env.MEMBER_WTB_TRANSCRIPTS_CHANNEL_ID;
        if (transcriptsChannelId) {
          try {
            const transcript = await createTranscript(channel, {
              limit: -1,
              returnBuffer: false,
              fileName: `transcript-${channel.name}.html`
            });

            const transcriptsChannel = await client.channels.fetch(transcriptsChannelId);
            if (transcriptsChannel?.isTextBased()) {
              await transcriptsChannel.send({
                content: `🗒️ Transcript for cancelled Member WTB deal **${channel.name}**`,
                files: [transcript]
              });
            }
          } catch (e) {
            console.warn("⚠️ Transcript failed:", e?.message || e);
          }
        }

        await interaction.editReply("✅ Deal cancelled. Channel will be deleted shortly.");

        claimState.delete(channelId);
        uploadedImagesMap.delete(channelId);

        setTimeout(() => channel.delete().catch(() => null), 3000);
        return;
      }

      /* ======================================
         6) CONFIRM DEAL (ADMIN)
         -> triggers Make webhook later (leave empty for now)
         ====================================== */
      if (interaction.isButton() && interaction.customId === "member_wtb_confirm_deal") {
        if (!isAdminMember(interaction.member)) {
          return interaction.reply({ content: "❌ You are not authorized to confirm the deal.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true }).catch(() => null);

        const channelId = interaction.channel?.id;
        if (!channelId) return;

        let data = claimState.get(channelId);

        let recordId = data?.recordId;
        if (!recordId) {
          const recs = await T_WTB()
            .select({ filterByFormula: `{${F_CLAIMED_CHANNEL_ID}} = "${channelId}"`, maxRecords: 1 })
            .firstPage();
          if (recs.length) recordId = recs[0].id;
        }

        if (!recordId) return interaction.editReply("❌ Could not find Airtable record for this deal.");

        const rec = await T_WTB().find(recordId);
        const locked = getNumberLike(rec.get(F_LOCKED_PAYOUT));
        const sku = upperTrim(rec.get(F_SKU_SOFT));
        const size = String(rec.get(F_SIZE) || "").trim();

        // Later: send to Make
        const makeUrl = String(process.env.MAKE_MEMBER_WTB_WEBHOOK_URL || "").trim();
        if (makeUrl) {
          try {
            await fetch(makeUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: "Member WTB Quick Deal",
                recordId,
                sku,
                size,
                lockedPayout: locked
              })
            });
          } catch (e) {
            console.warn("⚠️ Make webhook failed:", e?.message || e);
          }
        } else {
          console.log("ℹ️ MAKE_MEMBER_WTB_WEBHOOK_URL not set; skipping webhook call.");
        }

        await interaction.editReply(`✅ Deal confirmed.\nLocked payout: €${Number(locked ?? 0).toFixed(2)}`);

        // remove confirm button message components if you want (optional)
        return;
      }
    } catch (err) {
      console.error("❌ Interaction handler error:", err);
      try {
        if (interaction?.isRepliable() && !interaction.replied) {
          await interaction.reply({ content: "❌ Something went wrong.", ephemeral: true });
        }
      } catch {}
    }
  });

  /* ======================================
     MESSAGE HANDLER: count images until 6
     ====================================== */
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) return;
      if (!message.channel || message.channel.type !== ChannelType.GuildText) return;

      // Only act in channels that are member-wtb deal channels
      const channelId = message.channel.id;
      const data = claimState.get(channelId);
      if (!data?.recordId) return;

      // Only after seller confirmed? (optional)
      if (!data.confirmed) return;

      if (message.attachments.size === 0) return;

      const currentUploads = uploadedImagesMap.get(channelId) || [];

      const imageUrls = [...message.attachments.values()]
        .filter((att) => att.contentType?.startsWith("image/"))
        .map((att) => att.url);

      if (!imageUrls.length) return;

      currentUploads.push(...imageUrls);
      uploadedImagesMap.set(channelId, currentUploads);

      const uploadedCount = currentUploads.length;

      if (uploadedCount < 6) {
        await message.channel.send(`📸 You've uploaded ${uploadedCount}/6 required pictures.`);
        return;
      }

      if (uploadedCount >= 6 && !data.confirmSent) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("member_wtb_confirm_deal").setLabel("Confirm Deal").setStyle(ButtonStyle.Success)
        );

        await message.channel.send({
          content: "✅ All 6 pictures received. Admin can now confirm the deal.",
          components: [row]
        });

        claimState.set(channelId, { ...data, confirmSent: true });
      }
    } catch (err) {
      console.error("❌ MessageCreate handler error:", err);
    }
  });
}

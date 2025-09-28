// index.js
import 'dotenv/config';
import {
  Client, GatewayIntentBits, Partials, REST, Routes,
  SlashCommandBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle,
  ActionRowBuilder, ChannelType, PermissionFlagsBits
} from 'discord.js';
import { DateTime } from 'luxon';
import { parse } from 'csv-parse/sync';

const {
  DISCORD_TOKEN,
  GUILD_ID,
  WTB_FEED_CHANNEL_ID,     // <- #wtb
  WTB_CONTROL_CHANNEL_ID,  // <- #wtb-log (staff-only)
  TICKETS_CATEGORY_ID,     // <- "WTB Tickets" category
  STAFF_ROLE_ID,           // <- Staff/Mods role
  VERIFIED_ROLE_ID         // optional: gate who can upload
} = process.env;

const TZ = 'Europe/Amsterdam';
const MAX_ROWS = 50;         // CSV row cap per upload
const BUTTONS_PER_MSG = 25;  // Discord per-message button limit

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel, Partials.Message]
});

// Slash command (unique name so it won't clash with other bots)
const commands = [
  new SlashCommandBuilder()
    .setName('wtb-member-upload')
    .setDescription('Upload your daily WTB CSV (columns: sku,size).')
    .addAttachmentOption(o => o.setName('file').setDescription('CSV file').setRequired(true))
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const app = await client.application.fetch();
  await rest.put(Routes.applicationGuildCommands(app.id, GUILD_ID), { body: commands });
  console.log('Slash commands registered');
}

function todayString() {
  return DateTime.now().setZone(TZ).toFormat('yyyy-LL-dd');
}
function controlThreadName(userId) {
  return `wtb-${userId}-${todayString()}`;
}
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function shortId() {
  return Math.random().toString(36).slice(2, 8);
}

// Placeholder: show SKU as name for now (plug your API later)
async function getProductNameForSKU(sku) {
  return sku.trim().toUpperCase();
}

// Hidden control thread in #wtb-log = our "1/day" lock
async function getOrCreateControlThread(guild, userId) {
  const control = await guild.channels.fetch(WTB_CONTROL_CHANNEL_ID);
  if (!control) throw new Error('WTB_CONTROL_CHANNEL_ID not found');

  const active = await control.threads.fetchActive();
  const archived = await control.threads.fetchArchived({ limit: 100 });
  const name = controlThreadName(userId);
  const existing = [...active.threads.values(), ...archived.threads.values()]
    .find(t => t.name === name);
  if (existing) return existing;

  const startMsg = await control.send({ content: `Control thread for <@${userId}> on ${todayString()}` });
  const thread = await startMsg.startThread({ name, autoArchiveDuration: 1440 }); // 24h
  return thread;
}

// JSON state pinned in the control thread
async function loadState(thread) {
  const msgs = await thread.messages.fetch({ limit: 50 });
  const pinned = msgs.find(m => m.pinned && m.author.id === client.user.id);
  if (!pinned) return null;
  try { return JSON.parse(pinned.content.replace(/^​/, '')); } catch { return null; }
}
async function saveState(thread, state) {
  const msgs = await thread.messages.fetch({ limit: 50 });
  const pinned = msgs.find(m => m.pinned && m.author.id === client.user.id);
  const content = '​' + JSON.stringify(state); // zero-width to avoid accidental pings
  if (pinned) return pinned.edit({ content });
  const msg = await thread.send({ content });
  await msg.pin();
  return msg;
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'wtb-member-upload') {
      await handleUpload(interaction);
      return;
    }
    if (interaction.isButton()) {
      const [kind, ownerId, date, msgId, rowIndex] = interaction.customId.split('|');
      if (kind === 'sell') {
        await handleSellClick(interaction, { ownerId, date, msgId, rowIndex: Number(rowIndex) });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      await interaction.reply({ ephemeral: true, content: 'Error. Ping staff.' }).catch(()=>{});
    }
  }
});

async function handleUpload(interaction) {
  // Must be used in #wtb
  if (interaction.channelId !== WTB_FEED_CHANNEL_ID) {
    return interaction.reply({ ephemeral: true, content: `Use this command in <#${WTB_FEED_CHANNEL_ID}>.` });
  }
  // Optional: require Verified Seller role
  if (VERIFIED_ROLE_ID && !interaction.member.roles.cache.has(VERIFIED_ROLE_ID)) {
    return interaction.reply({ ephemeral: true, content: 'You need the Verified Seller role to use this command.' });
  }

  const userId = interaction.user.id;
  const feed = await interaction.guild.channels.fetch(WTB_FEED_CHANNEL_ID);
  if (!feed) return interaction.reply({ ephemeral: true, content: 'WTB channel not found.' });

  const att = interaction.options.getAttachment('file', true);
  const isCsv = (att.contentType && att.contentType.includes('csv')) || att.name.endsWith('.csv');
  if (!isCsv) return interaction.reply({ ephemeral: true, content: 'Upload a CSV file with header `sku,size`.' });

  await interaction.deferReply({ ephemeral: true });

  // Enforce 1/day via control thread — we REPLACE today’s list
  const controlThread = await getOrCreateControlThread(interaction.guild, userId);
  const existingState = await loadState(controlThread);
  if (existingState?.date === todayString() && existingState?.feedMessages?.length) {
    for (const mId of existingState.feedMessages) {
      try { const old = await feed.messages.fetch(mId); await old.delete(); } catch {}
    }
  }

  // Parse CSV
  const buf = Buffer.from(await (await fetch(att.url)).arrayBuffer());
  const rows = parse(buf.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
  if (!rows.length) return interaction.editReply({ content: 'CSV is empty.' });
  if (rows.length > MAX_ROWS) return interaction.editReply({ content: `Max ${MAX_ROWS} rows; you uploaded ${rows.length}.` });

  // Normalize + enrich
  const items = [];
  for (const [i, r] of rows.entries()) {
    const sku = (r.sku || r.SKU || '').toString().trim();
    const size = (r.size || r.Size || '').toString().trim();
    if (!sku || !size) continue;
    const name = await getProductNameForSKU(sku);
    items.push({ sku, size, name, idx: i });
  }
  if (!items.length) return interaction.editReply({ content: 'No valid rows (need columns: sku,size).' });

  // Post embeds (25-button limit per message)
  const messageIds = [];
  const batches = chunk(items, BUTTONS_PER_MSG);
  for (const batch of batches) {
    const fields = batch.map(it => ({
      name: `${it.name} (${it.sku})`,
      value: `Size: **${it.size}**`,
      inline: false
    }));

    const embed = new EmbedBuilder()
      .setTitle(`WTB List — ${interaction.user.username}`)
      .setDescription(`Date: ${todayString()} • Items: ${items.length}`)
      .addFields(fields)
      .setFooter({ text: `Uploader: ${interaction.user.id} • Expires 24h` });

    const rowsUI = [];
    for (let i = 0; i < batch.length; i += 5) {
      const row = new ActionRowBuilder();
      for (const it of batch.slice(i, i + 5)) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`sell|${interaction.user.id}|${todayString()}|PENDING|${it.idx}`)
            .setLabel('Sell')
            .setStyle(ButtonStyle.Success)
        );
      }
      rowsUI.push(row);
    }

    const sent = await feed.send({ embeds: [embed], components: rowsUI });
    messageIds.push(sent.id);

    // Patch message ID into the buttons
    const patched = sent.components.map(row => {
      row.components.forEach(btn => {
        const parts = btn.data.custom_id.split('|');
        parts[3] = sent.id;
        btn.setCustomId(parts.join('|'));
      });
      return row;
    });
    await sent.edit({ components: patched });
  }

  // Save state to control thread (pinned JSON)
  const state = {
    date: todayString(),
    ownerId: userId,
    feedMessages: messageIds,
    items: items.map(it => ({
      key: `${userId}|${todayString()}|${it.idx}`,
      sku: it.sku, size: it.size, name: it.name,
      claimed_by: null
    }))
  };
  await saveState(controlThread, state);

  await interaction.editReply({ content: `WTB posted ✅ (${items.length} items).` });
}

async function handleSellClick(interaction, { ownerId, date, msgId, rowIndex }) {
  if (interaction.user.id === ownerId) {
    return interaction.reply({ ephemeral: true, content: 'You cannot sell to your own WTB.' });
  }

  const controlThread = await getOrCreateControlThread(interaction.guild, ownerId);
  const state = await loadState(controlThread);
  if (!state || state.date !== date) {
    return interaction.reply({ ephemeral: true, content: 'This WTB list has expired.' });
  }

  const key = `${ownerId}|${date}|${rowIndex}`;
  const item = state.items.find(x => x.key === key);
  if (!item) return interaction.reply({ ephemeral: true, content: 'Item not found.' });
  if (item.claimed_by) {
    return interaction.reply({ ephemeral: true, content: 'Already claimed by another seller.' });
  }

  // Mark claimed
  item.claimed_by = interaction.user.id;
  await saveState(controlThread, state);

  // Disable the clicked button in the public message
  try {
    const feed = await interaction.guild.channels.fetch(WTB_FEED_CHANNEL_ID);
    const msg = await feed.messages.fetch(msgId);
    const updatedRows = msg.components.map(row => {
      row.components.forEach(btn => {
        const [kind, oId, dt, mId, idx] = btn.data.custom_id.split('|');
        if (kind === 'sell' && oId === ownerId && dt === date && mId === msgId && Number(idx) === rowIndex) {
          btn.setDisabled(true).setLabel('Claimed');
        }
      });
      return row;
    });
    await msg.edit({ components: updatedRows });
  } catch (e) {
    console.warn('Could not edit feed message:', e.message);
  }

  // Create a private ticket channel
  const parent = await interaction.guild.channels.fetch(TICKETS_CATEGORY_ID);
  const channelName = `wtb-${item.sku.toLowerCase()}-${item.size.replace(/\s+/g,'').toLowerCase()}-${shortId()}`.slice(0, 90);

  const ticket = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: parent?.id,
    permissionOverwrites: [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ]
  });

  const checklist = [
    '1) Confirm qty/price',
    '2) Upload proof photos',
    '3) Share shipping terms',
    '4) Mark deal agreed',
    '5) Post tracking',
    '6) Close ticket'
  ].join('\n');

  await ticket.send({
    content: `<@${ownerId}> <@${interaction.user.id}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle('WTB Ticket')
        .setDescription(`**${item.name}** (${item.sku}) • Size **${item.size}**\nBuyer: <@${ownerId}> • Seller: <@${interaction.user.id}>`)
        .addFields({ name: 'Checklist', value: checklist })
    ]
  });

  await interaction.reply({ ephemeral: true, content: `Ticket opened: <#${ticket.id}>` });
}

client.login(DISCORD_TOKEN);

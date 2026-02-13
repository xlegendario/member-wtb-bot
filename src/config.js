export const CONFIG = {
  discordToken: process.env.DISCORD_BOT_TOKEN,
  wtbChannelId: process.env.WTB_CHANNEL_ID,

  // ✅ for posting Quick Deal embeds
  guildId: process.env.GUILD_ID,
  memberWtbQuickDealsChannelId: process.env.MEMBER_WTB_QUICK_DEALS_CHANNEL_ID,

  airtableApiKey: process.env.AIRTABLE_API_KEY,
  airtableBaseId: process.env.AIRTABLE_BASE_ID,

  wtbTable: process.env.AIRTABLE_WTB_TABLE || "Member WTBs",
  sellersTable: process.env.AIRTABLE_SELLERS_TABLE || "Sellers Database",
  sellersDiscordIdField: process.env.AIRTABLE_SELLERS_DISCORD_ID_FIELD || "Discord ID",

  publicBaseUrl: process.env.PUBLIC_BASE_URL
};

export function assertConfig() {
  const required = [
    ["DISCORD_BOT_TOKEN", CONFIG.discordToken],
    ["WTB_CHANNEL_ID", CONFIG.wtbChannelId],

    // ✅ NEW required envs
    ["GUILD_ID", CONFIG.guildId],
    ["MEMBER_WTB_QUICK_DEALS_CHANNEL_ID", CONFIG.memberWtbQuickDealsChannelId],

    ["AIRTABLE_API_KEY", CONFIG.airtableApiKey],
    ["AIRTABLE_BASE_ID", CONFIG.airtableBaseId],
    ["PUBLIC_BASE_URL", CONFIG.publicBaseUrl]
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`Missing env vars: ${missing.join(", ")}`);
}

import { base } from "./client.js";
import { CONFIG } from "../config.js";

export async function findSellerRecordIdByDiscordId(discordId) {
  const records = await base(CONFIG.sellersTable)
    .select({
      maxRecords: 1,
      filterByFormula: `{${CONFIG.sellersDiscordIdField}} = "${discordId}"`
    })
    .firstPage();

  return records?.[0]?.id || null;
}

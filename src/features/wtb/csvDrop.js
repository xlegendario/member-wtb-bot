import { Events } from "discord.js";
import Papa from "papaparse";
import { CONFIG } from "../../config.js";
import { findSellerRecordIdByDiscordId } from "../../airtable/sellers.js";
import { createWtbBatch, toNumberOrNull } from "../../airtable/memberWtb.js";

function norm(v) {
  return (v ?? "").toString().trim();
}

function normalizeCsvRow(row) {
  const sku = norm(row.SKU ?? row.sku ?? row.Sku);
  const size = norm(row.Size ?? row.size ?? row.SIZE);

  const minPrice = toNumberOrNull(row["Min Price"] ?? row.MinPrice ?? row.min_price ?? row.min);
  const maxPrice = toNumberOrNull(row["Max Price"] ?? row.MaxPrice ?? row.max_price ?? row.max);

  if (!sku) return { ok: false, reason: "Missing SKU" };
  if (!size) return { ok: false, reason: "Missing Size" };
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    return { ok: false, reason: "Min Price > Max Price" };
  }

  return { ok: true, data: { sku, size, minPrice, maxPrice } };
}

export function registerCsvDropHandler(client) {
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot) return;
      if (message.channelId !== CONFIG.wtbChannelId) return;

      const attachment = [...message.attachments.values()]
        .find(a => (a.name || a.filename || "").toLowerCase().endsWith(".csv"));

      if (!attachment) return;

      const sellerRecordId = await findSellerRecordIdByDiscordId(message.author.id);
      if (!sellerRecordId) {
        await message.reply("❌ Your Discord ID is not found in **Sellers Database**. Please register first.");
        return;
      }

      // Download CSV first
      const res = await fetch(attachment.url);
      if (!res.ok) {
        await message.reply(`❌ Failed to download CSV (${res.status}).`);
        return;
      }
      const csvText = await res.text();

      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors?.length) {
        await message.reply(`❌ CSV parse error: ${parsed.errors[0].message}`);
        return;
      }

      const rows = parsed.data || [];
      const accepted = [];
      const rejected = [];

      for (let i = 0; i < rows.length; i++) {
        const nr = normalizeCsvRow(rows[i]);
        if (nr.ok) accepted.push(nr.data);
        else rejected.push(`Row ${i + 2}: ${nr.reason}`);
      }

      const created = await createWtbBatch({ sellerRecordId, rows: accepted });

      // Delete CSV message after success
      await message.delete().catch(() => null);

      const lines = [
        `✅ CSV imported for <@${message.author.id}>`,
        `• Created: **${created}**`,
        `• Rejected: **${rejected.length}**${rejected.length ? ` (showing up to 10)` : ""}`
      ];
      if (rejected.length) lines.push("```" + rejected.slice(0, 10).join("\n") + "```");

      await message.channel.send(lines.join("\n"));
    } catch (e) {
      console.error(e);
      try { await message.reply(`❌ Import failed: ${e.message}`); } catch {}
    }
  });
}

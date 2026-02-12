import { Events } from "discord.js";
import Papa from "papaparse";
import { CONFIG } from "../../config.js";
import { findSellerRecordIdByDiscordId } from "../../airtable/sellers.js";
import { createWtbBatch, toNumberOrNull } from "../../airtable/memberWtb.js";

function norm(v) {
  return (v ?? "").toString().trim();
}

function normalizeCsvRow(row) {
  const sku = norm(row.SKU ?? row.sku ?? row.Sku).toUpperCase();
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

async function safeDelete(msg) {
  try { await msg.delete(); } catch {}
}

async function safeDM(user, content) {
  try { await user.send(content); } catch {
    // User has DMs closed. Nothing we can do except maybe log.
  }
}

export function registerCsvDropHandler(client) {
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (message.channelId !== CONFIG.wtbChannelId) return;

    const attachment = [...message.attachments.values()]
      .find(a => (a.name || a.filename || "").toLowerCase().endsWith(".csv"));

    if (!attachment) return;

    // Optional: bot status message, auto-deleted
    const statusMsg = await message.channel.send(`⏳ Processing CSV for <@${message.author.id}>...`).catch(() => null);

    try {
      // Lookup seller
      const sellerRecordId = await findSellerRecordIdByDiscordId(message.author.id);
      if (!sellerRecordId) {
        // Delete the CSV message so it isn't visible
        await safeDelete(message);
        if (statusMsg) await safeDelete(statusMsg);

        await safeDM(
          message.author,
          "❌ Your Discord ID is not found in **Sellers Database**. Please register first, then re-upload your CSV."
        );
        return;
      }

      // Download CSV (before deletion)
      const res = await fetch(attachment.url);
      if (!res.ok) {
        await safeDelete(message);
        if (statusMsg) await safeDelete(statusMsg);

        await safeDM(message.author, `❌ Failed to download your CSV (HTTP ${res.status}). Please try again.`);
        return;
      }
      const csvText = await res.text();

      // Parse
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
      if (parsed.errors?.length) {
        await safeDelete(message);
        if (statusMsg) await safeDelete(statusMsg);

        await safeDM(message.author, `❌ CSV parse error: ${parsed.errors[0].message}`);
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

      // Create records
      const created = await createWtbBatch({ sellerRecordId, rows: accepted });

      // Always delete CSV message after processing
      await safeDelete(message);
      if (statusMsg) await safeDelete(statusMsg);

      // DM summary (private)
      const lines = [
        "✅ **CSV import complete**",
        `• Created: **${created}**`,
        `• Rejected: **${rejected.length}**`
      ];
      if (rejected.length) lines.push("```" + rejected.slice(0, 15).join("\n") + "```");

      await safeDM(message.author, lines.join("\n"));
    } catch (e) {
      // Ensure the channel stays clean even on crash
      await safeDelete(message);
      if (statusMsg) await safeDelete(statusMsg);

      await safeDM(message.author, `❌ Import failed: ${e.message}`);
    }
  });
}

import { base } from "./client.js";
import { CONFIG } from "../config.js";

export function toNumberOrNull(v) {
  const s = (v ?? "").toString().trim().replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function createSingleWtb({ sellerRecordId, sku, size, minPrice, maxPrice }) {
  await base(CONFIG.wtbTable).create([{
    fields: {
      "SKU (Soft)": sku,
      "Size": size,
      "Min Price": minPrice ?? undefined,
      "Max Price": maxPrice ?? undefined,
      "Seller": sellerRecordId ? [sellerRecordId] : undefined
    }
  }]);
}

export async function createWtbBatch({ sellerRecordId, rows }) {
  let created = 0;

  for (let i = 0; i < rows.length; i += 10) {
    const chunk = rows.slice(i, i + 10).map(r => ({
      fields: {
        "SKU (Soft)": r.sku,
        "Size": r.size,
        "Min Price": r.minPrice ?? undefined,
        "Max Price": r.maxPrice ?? undefined,
        "Seller": sellerRecordId ? [sellerRecordId] : undefined
      }
    }));

    await base(CONFIG.wtbTable).create(chunk);
    created += chunk.length;
  }

  return created;
}

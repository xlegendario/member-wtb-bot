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

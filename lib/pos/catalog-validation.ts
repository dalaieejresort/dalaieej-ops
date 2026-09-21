import type { CatalogItem } from "./types";

export function validateCatalogSkus(catalog: CatalogItem[]) {
  const bySku = new Map<string, CatalogItem[]>();
  for (const item of catalog) {
    if (item.isCategory) continue;
    const sku = (item.sku ?? item.id).trim().toUpperCase();
    const entries = bySku.get(sku) ?? [];
    entries.push(item);
    bySku.set(sku, entries);
  }
  const conflicts = [...bySku.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([sku, items]) => ({ sku, names: items.map((item) => item.name) }));
  const conflictingSkus = new Set(conflicts.map(({ sku }) => sku));
  return {
    // Never pick an arbitrary winner: both products would write the same SKU.
    items: catalog.filter((item) =>
      item.isCategory || !conflictingSkus.has((item.sku ?? item.id).trim().toUpperCase()),
    ),
    conflicts,
  };
}

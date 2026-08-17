import type { PriceMode } from "./types";

export type SaleItemDetailInput = {
  sku?: unknown;
  name?: unknown;
  category?: unknown;
  qty?: unknown;
  unitPrice?: unknown;
  priceMode?: unknown;
};

export type SaleItemDetail = {
  sku: string;
  name: string;
  category: string;
  qty: number;
  unitPrice: number;
  priceMode?: PriceMode;
};

function toFiniteNumber(value: unknown) {
  const cleaned = String(value ?? "").replace(/[₮,\s]/g, "");
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function normalizeSaleItemDetails(
  items: readonly SaleItemDetailInput[],
): SaleItemDetail[] {
  return items
    .filter(
      (item): item is SaleItemDetailInput =>
        Boolean(item) && typeof item === "object",
    )
    .map((item) => {
      const sku = String(item.sku ?? "").trim();
      const name = String(item.name ?? item.sku ?? "").trim();
      const category = String(item.category ?? "").trim() || "Үйлчилгээ";
      const qty = toFiniteNumber(item.qty ?? 1);
      const unitPrice = toFiniteNumber(item.unitPrice);
      const priceMode: PriceMode | undefined =
        item.priceMode === "guest" || item.priceMode === "staff"
          ? item.priceMode
          : undefined;

      return {
        sku,
        name,
        category,
        qty,
        unitPrice,
        ...(priceMode ? { priceMode } : {}),
      };
    })
    .filter((item) => item.name && item.qty > 0 && item.unitPrice >= 0);
}

export function serializeSaleItemDetails(
  items: readonly SaleItemDetailInput[],
) {
  return JSON.stringify(normalizeSaleItemDetails(items));
}

export function parseSaleItemDetails(value: unknown): SaleItemDetail[] {
  const text = String(value ?? "").trim();
  if (!text) return [];

  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? normalizeSaleItemDetails(parsed) : [];
  } catch {
    return [];
  }
}

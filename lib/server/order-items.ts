import "server-only";

import type { SaleItemDetailInput } from "@/lib/pos/sale-item-details";
import { normalizeSaleItemDetails } from "@/lib/pos/sale-item-details";

export const ORDER_ITEMS_SHEET_TITLES = [
  process.env.GOOGLE_ORDER_ITEMS_SHEET_TITLE,
  "Order_Items",
  "order_items",
].filter(Boolean) as string[];

export const ORDER_ITEM_HEADERS = [
  "line_id",
  "transaction_id",
  "line_index",
  "timestamp",
  "business_date",
  "session_id",
  "staff",
  "room_or_guest",
  "sku",
  "item_name",
  "category",
  "quantity",
  "unit_price",
  "line_total",
  "price_mode",
  "price_source",
  "revision_id",
  "revision_type",
  "recorded_at",
] as const;

export type OrderItemContext = {
  transactionId: string;
  timestamp: string;
  businessDate: string;
  sessionId: string;
  staff: string;
  roomOrGuest: string;
  revisionId: string;
  revisionType: "original" | "edit" | "backfill";
  priceSource?: "recorded" | "catalog" | "unknown";
  recordedAt?: string;
};

export function makeOrderItemRecords(
  items: readonly SaleItemDetailInput[],
  context: OrderItemContext,
) {
  const normalizedItems = normalizeSaleItemDetails(items);
  const recordedAt = context.recordedAt ?? new Date().toISOString();

  return normalizedItems.map((item, index) => ({
    line_id: `${context.transactionId}:${context.revisionId}:${index + 1}`,
    transaction_id: context.transactionId,
    line_index: index + 1,
    timestamp: context.timestamp,
    business_date: context.businessDate,
    session_id: context.sessionId,
    staff: context.staff,
    room_or_guest: context.roomOrGuest,
    sku: item.sku,
    item_name: item.name,
    category: item.category,
    quantity: item.qty,
    unit_price: item.unitPrice,
    line_total: item.qty * item.unitPrice,
    price_mode: item.priceMode ?? "",
    price_source: context.priceSource ?? "recorded",
    revision_id: context.revisionId,
    revision_type: context.revisionType,
    recorded_at: recordedAt,
  }));
}

export function orderItemValues(
  record: Record<string, unknown>,
  headers: readonly string[] = ORDER_ITEM_HEADERS,
) {
  return headers.map((header) => record[header] ?? "");
}

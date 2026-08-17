import type { PriceMode } from "@/lib/pos/types";

export type LiveOrderItem = {
  sku?: string;
  name: string;
  category?: string;
  qty: number;
  unitPrice: number;
  priceMode?: PriceMode;
};

export type LiveOrder = {
  transactionId: string;
  businessDate: string;
  timestamp: string;
  staff: string;
  paymentMethod: string;
  roomOrGuest: string;
  subtotal: number;
  discount: number;
  total: number;
  originalTotal: number;
  paidAmount: number;
  balance: number;
  itemCount: number;
  itemSummary: string;
  qpayInvoiceId: string;
  notes: string;
  items?: LiveOrderItem[];
  updatedAt: string;
};

export type LiveOrdersResponse = {
  initialized: boolean;
  orders: LiveOrder[];
  checkedAt: string;
};

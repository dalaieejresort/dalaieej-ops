"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FALLBACK_CATALOG, STAFF } from "@/lib/pos/data";
import type {
  CartLine,
  CatalogItem,
  ItemCategory,
  PriceMode,
} from "@/lib/pos/types";
import { formatMNT, formatNumber } from "@/lib/pos/utils";
import styles from "./DayansoftSkin.module.css";

type CatalogResponseItem = {
  sku: string;
  name: string;
  category?: string;
  price: number;
  guestPrice?: number;
  staffPrice?: number;
  stock?: number;
};

type CatalogStatus = "loading" | "ready" | "sample";
type SaleStatus = "idle" | "saving" | "success" | "error";
type RegisterCartLine = CartLine & { category: ItemCategory };
type BankTransferStatus = "idle" | "paid";

type DayStatus = "loading" | "ready" | "saving" | "error";
type DayModalMode = "open" | "close" | null;
type VoidStatus = "idle" | "loading" | "saving" | "success" | "error";

type DayTotals = {
  salesTotal: number;
  paymentTotal: number;
  cashPaymentTotal: number;
  cardPaymentTotal: number;
  qpayPaymentTotal: number;
  otherPaymentTotal: number;
  roomChargeTotal: number;
  expectedCash: number;
};

type DayItemTotal = {
  name: string;
  quantity: number;
};

type DaySession = {
  businessDate: string;
  openedAt: string;
  openedBy: string;
  startingCash: number;
  status: "open" | "closed" | string;
  closedAt: string;
  closedBy: string;
  countedCash: number;
  expectedCash: number;
  cashDifference: number;
  paymentTotal: number;
  cashPaymentTotal: number;
  cardPaymentTotal: number;
  qpayPaymentTotal: number;
  otherPaymentTotal: number;
  roomChargeTotal: number;
  salesTotal: number;
  notes: string;
};

type RecentSale = {
  transactionId: string;
  timestamp: string;
  staff: string;
  paymentMethod: string;
  paidStatus: string;
  roomOrGuest: string;
  total: number;
  saleTotal?: number;
  paidAmount: number;
  paidToDate?: number;
  balance?: number;
  historyKind?: "sale" | "payment";
  refundableAmount: number;
  itemCount?: number;
  itemSummary: string;
  qpayInvoiceId?: string;
  cashReceived?: number;
  changeDue?: number;
  notes: string;
};

type RegisterMode = "sale" | "charges" | "history";
type SettlementMethod = "cash" | "card" | "bank";
type PartialPaymentOption = SettlementMethod | "balance";
type SettlementStatus = "idle" | "saving" | "success" | "error";

const REGISTER_MODE_STORAGE_KEY = "dalaieej.register.mode";
const REGISTER_CATEGORY_STORAGE_KEY = "dalaieej.register.category";
const SHARED_SALES_SYNC_INTERVAL_MS = 60000;
const SHARED_REFRESH_FOCUS_COOLDOWN_MS = 30000;
const DAY_SESSION_SYNC_INTERVAL_MS = 10000;
const CATALOG_RETRY_DELAY_MS = 15000;
const CATALOG_RETRY_INTERVAL_MS = 120000;
const PRINT_BILL_BUTTON_LABEL = "Гал тогоо / Бар билл хэвлэх";

function isRegisterMode(value: string | null): value is RegisterMode {
  return value === "sale" || value === "charges" || value === "history";
}

function getDaySessionSignature(session: DaySession | null) {
  if (!session) return "";

  return [
    session.businessDate,
    session.status,
    session.openedAt,
    session.closedAt,
    session.startingCash,
  ].join("|");
}

type SettlementPaymentLine = {
  id: string;
  method: SettlementMethod;
  methodLabel: string;
  amount: number;
  cashReceived: number;
  changeDue: number;
  qpayInvoiceId: string;
};

type UnpaidCharge = {
  transactionId: string;
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
};

type ChargeEditItem = {
  sku?: string;
  name: string;
  category?: string;
  qty: number;
  unitPrice: number;
  priceMode?: PriceMode;
};

type UnpaidChargeDetail = UnpaidCharge & {
  paidStatus?: string;
  items?: ChargeEditItem[];
};

type ChargeGroup = {
  key: string;
  label: string;
  charges: UnpaidCharge[];
  total: number;
  paidAmount: number;
  originalTotal: number;
  latestTimestamp: string;
};

type PrintableSale = {
  id: string;
  createdAt: Date;
  items: RegisterCartLine[];
  total: number;
  isPaid: boolean;
  paymentLabel: string;
  staffName: string;
  roomNumber: string;
  cashReceived: number;
  changeDue: number;
  qpayInvoiceId: string;
};

type DayClosePrintReport = {
  businessDate: string;
  openedAt: string;
  closedAt: string;
  openedBy: string;
  closedBy: string;
  staffName: string;
  startingCash: number;
  countedCash: number;
  expectedCash: number;
  cashDifference: number;
  totals: DayTotals;
  itemTotals: DayItemTotal[];
  notes: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "Бүгд",
  food: "Хоол",
  beer: "Бар",
  soft: "Ундаа",
  cocktail: "Коктейль",
  dessert: "Амттан",
  Дессерт: "Дессерт",
  Десерт: "Дессерт",
  gift: "Карт",
  menu: "Меню",
};

const CATEGORY_ACCENTS: Record<string, string> = {
  all: "#111827",
  food: "#2f6f73",
  beer: "#8a5a12",
  soft: "#2563eb",
  cocktail: "#7c3aed",
  dessert: "#be4b75",
  Дессерт: "#be4b75",
  Десерт: "#be4b75",
  gift: "#047857",
  menu: "#374151",
  Тамхи: "#64748b",
  Ундаа: "#2563eb",
  Пиво: "#8a5a12",
  Вино: "#9f1239",
  Архи: "#4338ca",
  Коктейль: "#7c3aed",
  Коктейл: "#7c3aed",
  "Цай, кофе": "#166534",
  "Халуун ундаа": "#c2410c",
  печень: "#854d0e",
  "Европ, Ази хоол": "#2f6f73",
  "\"I\" хоол": "#c2410c",
  "\"II\" хоол": "#2f6f73",
  Хачир: "#6b7280",
  "Монгол хоол": "#991b1b",
  Шөл: "#c2410c",
  "Цагаан хоол": "#166534",
  "Хүүхдийн хоол": "#ea580c",
  "Өдрийн онцлох хоол": "#dc2626",
  Сет: "#7c2d12",
  Түрээс: "#1d4ed8",
  "Түрээс, цагийн": "#1d4ed8",
  Түрээсийн: "#1d4ed8",
  "Түрээсийн бараа": "#1d4ed8",
  "Түрээсийн зүйлс": "#1d4ed8",
  Үйлчилгээ: "#475569",
};

const PAYMENT_METHODS = [
  { id: "cash", label: "Бэлэн" },
  { id: "card", label: "Карт" },
  { id: "bank", label: "Данс" },
  { id: "room", label: "Байшин/Зочин" },
  { id: "partial", label: "Хэсэгчилсэн" },
] as const;

type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

const SETTLEMENT_METHODS = [
  { id: "cash", label: "Бэлэн" },
  { id: "card", label: "Карт" },
  { id: "bank", label: "Данс" },
] as const satisfies Array<{ id: SettlementMethod; label: string }>;

const CASH_DENOMINATIONS = [500, 1000, 5000, 10000, 20000, 50000];
const ROOM_NUMBERS = Array.from({ length: 18 }, (_, index) =>
  String(index + 1),
);
const EMPTY_DAY_TOTALS: DayTotals = {
  salesTotal: 0,
  paymentTotal: 0,
  cashPaymentTotal: 0,
  cardPaymentTotal: 0,
  qpayPaymentTotal: 0,
  otherPaymentTotal: 0,
  roomChargeTotal: 0,
  expectedCash: 0,
};

function inferCategory(name: string): ItemCategory {
  const normalized = name.toLowerCase();

  if (
    normalized.includes("коктейл") ||
    normalized.includes("cocktail") ||
    normalized.includes("mojito") ||
    normalized.includes("мохито")
  ) {
    return "cocktail";
  }

  if (
    normalized.includes("цай") ||
    normalized.includes("tea") ||
    normalized.includes("кофе") ||
    normalized.includes("coffee") ||
    normalized.includes("americano") ||
    normalized.includes("espresso") ||
    normalized.includes("latte") ||
    normalized.includes("капучино") ||
    normalized.includes("cappuccino")
  ) {
    return "Халуун ундаа";
  }

  if (
    normalized.includes("cola") ||
    normalized.includes("fanta") ||
    normalized.includes("ундаа") ||
    normalized.includes("ус")
  ) {
    return "soft";
  }

  if (
    normalized.includes("beer") ||
    normalized.includes("пиво") ||
    normalized.includes("шар айраг") ||
    normalized.includes("hennessy") ||
    normalized.includes("blanche")
  ) {
    return "beer";
  }

  if (normalized.includes("карт") || normalized.includes("gift")) {
    return "gift";
  }

  if (
    normalized.includes("амттан") ||
    normalized.includes("dessert") ||
    normalized.includes("дессерт") ||
    normalized.includes("десерт")
  ) {
    return "dessert";
  }

  return "food";
}

function normalizeCategory(category: unknown, name: string): ItemCategory {
  const sheetCategory = String(category ?? "").trim();
  return sheetCategory || inferCategory(name);
}

function getCategoryLabel(category: ItemCategory | "all") {
  return CATEGORY_LABELS[category] ?? category;
}

function getCategoryAccent(category: ItemCategory | "all") {
  return CATEGORY_ACCENTS[category] ?? "#374151";
}

function normalizeCatalogRow(row: CatalogResponseItem): CatalogItem {
  return {
    id: row.sku,
    sku: row.sku,
    name: row.name,
    price: row.price,
    guestPrice: row.guestPrice,
    staffPrice: row.staffPrice,
    stock: row.stock,
    category: normalizeCategory(row.category, row.name),
  };
}

function getDisplayProducts(catalog: CatalogItem[]) {
  const source = catalog.length > 0 ? catalog : FALLBACK_CATALOG;
  return source.filter((item) => !item.isCategory && item.price > 0);
}

function hasStaffPrice(item: CatalogItem) {
  return typeof item.staffPrice === "number" && item.staffPrice > 0;
}

function hasGuestPrice(item: CatalogItem) {
  if (typeof item.guestPrice === "number") {
    return item.guestPrice > 0;
  }

  return item.price > 0 && !hasStaffPrice(item);
}

function getDefaultPriceMode(item: CatalogItem): PriceMode {
  return hasGuestPrice(item) || !hasStaffPrice(item) ? "guest" : "staff";
}

function getPriceForMode(item: CatalogItem, priceMode: PriceMode) {
  return priceMode === "staff" && hasStaffPrice(item)
    ? item.staffPrice ?? item.price
    : item.guestPrice ?? item.price;
}

function getCartLineId(item: CatalogItem, priceMode: PriceMode) {
  return `${item.sku ?? item.id}:${priceMode}`;
}

function getPriceModeLabel(priceMode?: PriceMode) {
  if (!priceMode) return "Гараар";
  return priceMode === "staff" ? "Ажилчин үнэ" : "Амрагч үнэ";
}

function getChargeReferenceKey(value: string) {
  return value.trim().toLowerCase();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatReceiptDate(date: Date) {
  return date.toLocaleString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printablePage(title: string, body: string) {
  return `<!doctype html>
<html lang="mn">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: 80mm auto; margin: 3mm; }
      * { box-sizing: border-box; }
      html { margin: 0; padding: 0; background: #fff; }
      body {
        width: 72mm;
        margin: 0 auto;
        padding: 0;
        color: #000;
        background: #fff;
        font-family: Helvetica, Arial, sans-serif;
        font-size: 11px;
        line-height: 1.25;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      h1 {
        margin: 0 0 4px;
        text-align: center;
        font-size: 18px;
        font-weight: 900;
        letter-spacing: 0;
      }
      h2 {
        margin: 0 0 7px;
        text-align: center;
        font-size: 12px;
        font-weight: 800;
      }
      .meta {
        display: grid;
        gap: 2px;
        margin: 7px 0;
        border-top: 1px dashed #000;
        border-bottom: 1px dashed #000;
        padding: 5px 0;
      }
      .row {
        display: flex;
        justify-content: space-between;
        gap: 6px;
        align-items: baseline;
      }
      .row span:last-child,
      .row strong:last-child {
        text-align: right;
        overflow-wrap: anywhere;
      }
      .items { margin-top: 6px; }
      .item {
        break-inside: avoid;
        border-bottom: 1px solid #ddd;
        padding: 5px 0;
      }
      .item-main {
        display: grid;
        grid-template-columns: 28px minmax(0, 1fr) 54px;
        gap: 5px;
        align-items: baseline;
      }
      .qty {
        font-size: 18px;
        font-weight: 900;
      }
      .name {
        font-size: 12px;
        font-weight: 800;
        overflow-wrap: anywhere;
      }
      .price {
        font-size: 11px;
        font-weight: 800;
        text-align: right;
        white-space: nowrap;
      }
      .total {
        margin-top: 8px;
        border-top: 2px solid #000;
        padding-top: 7px;
        font-size: 15px;
        font-weight: 900;
      }
      .prep-ticket + .prep-ticket {
        margin-top: 14px;
        padding-top: 10px;
        border-top: 1px dashed #000;
        break-before: page;
        page-break-before: always;
      }
      .prep-ticket .item-main {
        grid-template-columns: 46px minmax(0, 1fr);
      }
      .prep-ticket .qty {
        font-size: 24px;
      }
      .prep-ticket .name {
        font-size: 16px;
        font-weight: 900;
      }
      .prep-ticket.with-prices .item-main {
        grid-template-columns: 46px minmax(0, 1fr) 58px;
      }
      .prep-ticket.with-prices .price {
        font-size: 12px;
      }
      .note {
        margin-top: 9px;
        text-align: center;
        font-size: 10px;
      }
      .cut {
        margin-top: 12px;
        border-top: 1px dashed #000;
        height: 4px;
      }
      @media screen {
        body {
          max-width: 320px;
          padding: 12px;
          box-shadow: 0 0 0 1px #ddd;
        }
      }
    </style>
  </head>
  <body>${body}<div class="cut"></div></body>
</html>`;
}

function openPrintWindow() {
  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) return false;

  return printWindow;
}

function closePrintWindow(printWindow: Window | false) {
  if (!printWindow || printWindow.closed) return;
  printWindow.close();
}

function printHtml(title: string, body: string, reservedWindow?: Window | false) {
  const printWindow = reservedWindow ?? openPrintWindow();
  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(printablePage(title, body));
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 150);
  return true;
}

const KITCHEN_TICKET_KEYWORDS = [
  "food",
  "хоол",
  "шөл",
  "soup",
  "салат",
  "salad",
  "амттан",
  "dessert",
  "дессерт",
  "десерт",
  "тараг",
  "yogurt",
  "бялуу",
  "cake",
  "чизкейк",
  "cheesecake",
  "тирамису",
  "tiramisu",
  "панакота",
  "panna cotta",
  "пирог",
  "pie",
  "пицца",
  "пизза",
  "pizza",
  "паста",
  "pasta",
  "калзони",
  "calzone",
  "лазан",
  "lasagn",
  "болонез",
  "bolognese",
  "карбонара",
  "carbonara",
  "сүүтэй цай",
  "suutei tsai",
  "milk tea",
  "зөгийн балтай сүү",
  "зөгийн бал",
  "honey milk",
  "халуун вино",
  "халуун дарс",
  "hot wine",
  "mulled wine",
  "глинтвейн",
  "аарц",
  "халуун шоколад",
  "hot chocolate",
  "какао",
  "хачир",
  "монгол",
  "европ",
  "ази",
  "сет",
  "set",
];

const BAR_TICKET_KEYWORDS = [
  "чацаргана",
  "sea buckthorn",
  "зайрмаг",
  "ice cream",
  "мороженое",
  "печень",
  "жигнэмэг",
  "cookie",
  "cookies",
  "biscuit",
  "вафли",
  "wafer",
  "чихэр",
  "candy",
  "packaged sweet",
  "packaged sweets",
];

function normalizeTicketText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/["'`]/g, "")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("mn-MN");
}

function isKitchenTicketItem(item: RegisterCartLine) {
  const searchableText = `${normalizeTicketText(item.category)} ${normalizeTicketText(item.name)}`;
  if (BAR_TICKET_KEYWORDS.some((keyword) => searchableText.includes(keyword))) {
    return false;
  }

  return KITCHEN_TICKET_KEYWORDS.some((keyword) =>
    searchableText.includes(keyword),
  );
}

function splitPrepTicketItems(items: RegisterCartLine[]) {
  return items.reduce(
    (groups, item) => {
      if (isKitchenTicketItem(item)) {
        groups.kitchen.push(item);
      } else {
        groups.other.push(item);
      }

      return groups;
    },
    { kitchen: [] as RegisterCartLine[], other: [] as RegisterCartLine[] },
  );
}

function prepTicketSection(
  sale: PrintableSale,
  title: string,
  note: string,
  items: RegisterCartLine[],
  options: { showPrices?: boolean } = {},
) {
  const sectionTotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const showPrices = options.showPrices === true;

  return `<section class="prep-ticket${showPrices ? " with-prices" : ""}">
    <h1>DALAI EEJ</h1>
    <h2>${escapeHtml(title)}</h2>
    <div class="meta">
      <div class="row"><strong>Дугаар</strong><span>${escapeHtml(sale.id)}</span></div>
      <div class="row"><strong>Цаг</strong><span>${escapeHtml(formatReceiptDate(sale.createdAt))}</span></div>
      <div class="row"><strong>Ажилтан</strong><span>${escapeHtml(sale.staffName)}</span></div>
      <div class="row"><strong>Төлөв</strong><span>${sale.isPaid ? "Төлөгдсөн" : "Төлбөр хүлээгдэж байна"}</span></div>
      ${
        sale.roomNumber
          ? `<div class="row"><strong>Байшин/Зочин</strong><span>${escapeHtml(sale.roomNumber)}</span></div>`
          : ""
      }
    </div>
    <div class="items">
      ${items
        .map(
          (item) => `<div class="item">
            <div class="item-main">
              <span class="qty">${item.quantity}x</span>
              <span class="name">${escapeHtml(item.name)}</span>
              ${
                showPrices
                  ? `<span class="price">${formatNumber(item.price * item.quantity)}</span>`
                  : ""
              }
            </div>
          </div>`,
        )
        .join("")}
    </div>
    ${
      showPrices
        ? `<div class="row total"><span>Нийт</span><span>${formatMNT(sectionTotal)}</span></div>`
        : ""
    }
    <div class="note">${escapeHtml(note)}</div>
  </section>`;
}

function billBody(sale: PrintableSale) {
  const { kitchen } = splitPrepTicketItems(sale.items);
  const sections = [
    kitchen.length > 0
      ? prepTicketSection(sale, "Гал тогоо", "Гал тогоонд", kitchen)
      : "",
    sale.items.length > 0
      ? prepTicketSection(sale, "Бар / Бусад", "Бар / Бусад", sale.items, {
          showPrices: true,
        })
      : "",
  ].filter(Boolean);

  return sections.join("");
}

function receiptBody(sale: PrintableSale) {
  return `<h1>DALAI EEJ</h1>
    <h2>Төлбөрийн баримт</h2>
    <div class="meta">
      <div class="row"><strong>Дугаар</strong><span>${escapeHtml(sale.id)}</span></div>
      <div class="row"><strong>Цаг</strong><span>${escapeHtml(formatReceiptDate(sale.createdAt))}</span></div>
      <div class="row"><strong>Ажилтан</strong><span>${escapeHtml(sale.staffName)}</span></div>
      <div class="row"><strong>Төлбөр</strong><span>${escapeHtml(sale.paymentLabel)}</span></div>
      ${
        sale.roomNumber
          ? `<div class="row"><strong>Байшин/Зочин</strong><span>${escapeHtml(sale.roomNumber)}</span></div>`
          : ""
      }
    </div>
    <div class="items">
      ${sale.items
        .map(
          (item) => `<div class="item">
            <div class="item-main">
              <span>${item.quantity}x</span>
              <span class="name">${escapeHtml(item.name)}</span>
              <span class="price">${formatNumber(item.price * item.quantity)}</span>
            </div>
          </div>`,
        )
        .join("")}
    </div>
    <div class="row total"><span>Нийт</span><span>${formatMNT(sale.total)}</span></div>
    ${
      sale.cashReceived
        ? `<div class="row"><span>Авсан</span><strong>${formatMNT(sale.cashReceived)}</strong></div>
           <div class="row"><span>Хариулт</span><strong>${formatMNT(sale.changeDue)}</strong></div>`
        : ""
    }
    <div class="note">Баярлалаа</div>`;
}

function printReceipt(sale: PrintableSale, reservedWindow?: Window | false) {
  return printHtml("Баримт", receiptBody(sale), reservedWindow);
}

function printBill(sale: PrintableSale, reservedWindow?: Window | false) {
  return printHtml("Билл", billBody(sale), reservedWindow);
}

function formatDayCloseTime(value: string) {
  return value ? formatReceiptDate(parseSaleTimestamp(value)) : "";
}

function dayCloseBody(report: DayClosePrintReport) {
  const summaryRows: Array<[string, number]> = [
    ["Нийт борлуулалт", report.totals.salesTotal],
    ["Нийт төлбөр", report.totals.paymentTotal],
    ["Бэлэн төлбөр", report.totals.cashPaymentTotal],
    ["Карт", report.totals.cardPaymentTotal],
    ["QPay / Данс", report.totals.qpayPaymentTotal],
    ["Бусад төлбөр", report.totals.otherPaymentTotal],
    ["Байшин/зочинд бичсэн", report.totals.roomChargeTotal],
    ["Эхлэх бэлэн мөнгө", report.startingCash],
    ["Бэлнээр байх ёстой", report.expectedCash],
    ["Тоолсон бэлэн мөнгө", report.countedCash],
  ];

  return `<h1>DALAI EEJ</h1>
    <h2>Өдрийн хаалт</h2>
    <div class="meta">
      <div class="row"><strong>Огноо</strong><span>${escapeHtml(report.businessDate)}</span></div>
      ${
        report.openedAt
          ? `<div class="row"><strong>Нээсэн</strong><span>${escapeHtml(formatDayCloseTime(report.openedAt))}</span></div>`
          : ""
      }
      ${
        report.closedAt
          ? `<div class="row"><strong>Хаасан</strong><span>${escapeHtml(formatDayCloseTime(report.closedAt))}</span></div>`
          : ""
      }
      <div class="row"><strong>Нээсэн ажилтан</strong><span>${escapeHtml(report.openedBy || report.staffName)}</span></div>
      <div class="row"><strong>Хаасан ажилтан</strong><span>${escapeHtml(report.closedBy || report.staffName)}</span></div>
    </div>
    <div class="items">
      ${summaryRows
        .map(
          ([label, amount]) => `<div class="item">
            <div class="row">
              <span>${escapeHtml(label)}</span>
              <strong>${formatMNT(amount)}</strong>
            </div>
          </div>`,
        )
        .join("")}
    </div>
    <div class="row total"><span>Зөрүү</span><span>${formatMNT(report.cashDifference)}</span></div>
    ${
      report.itemTotals.length > 0
        ? `<h2>Бараагаар зарагдсан тоо</h2>
          <div class="items">
            ${report.itemTotals
              .map(
                (item, index) => `<div class="item">
                  <div class="row">
                    <span>${index + 1}. ${escapeHtml(item.name)}</span>
                    <strong>${formatNumber(item.quantity)}</strong>
                  </div>
                </div>`,
              )
              .join("")}
          </div>`
        : ""
    }
    ${
      report.notes.trim()
        ? `<div class="note">Тайлбар: ${escapeHtml(report.notes.trim())}</div>`
        : ""
    }`;
}

function printDayCloseReport(
  report: DayClosePrintReport,
  reservedWindow?: Window | false,
) {
  return printHtml("Өдрийн хаалт", dayCloseBody(report), reservedWindow);
}

function getSettlementPaymentLabel(lines: SettlementPaymentLine[]) {
  return lines
    .map((line) => {
      const invoice = line.qpayInvoiceId ? ` ${line.qpayInvoiceId}` : "";
      return `${line.methodLabel}${invoice} ${formatNumber(line.amount)}`;
    })
    .join(" + ");
}

function buildSettlementReceiptSale(
  charges: UnpaidCharge[],
  paymentsByTransaction: Map<string, Array<{ amount: number }>>,
  lines: SettlementPaymentLine[],
  staffName: string,
  roomLabel: string,
): PrintableSale {
  const total = lines.reduce((sum, line) => sum + line.amount, 0);
  const items = charges.flatMap((charge): RegisterCartLine[] => {
    const paidAmount = (
      paymentsByTransaction.get(charge.transactionId) ?? []
    ).reduce((sum, payment) => sum + payment.amount, 0);

    if (paidAmount <= 0) return [];

    return [
      {
        id: charge.transactionId,
        sku: charge.transactionId,
        name: charge.itemSummary || charge.transactionId,
        price: paidAmount,
        category: "Үйлчилгээ",
        quantity: 1,
        staff: staffName,
      },
    ];
  });
  const singleCashLine =
    lines.length === 1 && lines[0].method === "cash" ? lines[0] : null;

  return {
    id: lines[0]?.id ?? "PAY",
    createdAt: new Date(),
    items:
      items.length > 0
        ? items
        : [
            {
              id: "settlement",
              name: "Өр төлбөр",
              price: total,
              category: "Үйлчилгээ",
              quantity: 1,
              staff: staffName,
            },
          ],
    total,
    isPaid: true,
    paymentLabel: getSettlementPaymentLabel(lines),
    staffName,
    roomNumber: roomLabel,
    cashReceived: singleCashLine?.cashReceived ?? 0,
    changeDue: singleCashLine?.changeDue ?? 0,
    qpayInvoiceId: lines
      .map((line) => line.qpayInvoiceId)
      .filter(Boolean)
      .join(", "),
  };
}

function parseSaleTimestamp(timestamp: string) {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function buildHistoryReceiptSale(sale: RecentSale): PrintableSale {
  return {
    id: sale.transactionId,
    createdAt: parseSaleTimestamp(sale.timestamp),
    items: [
      {
        id: sale.transactionId,
        name:
          sale.paidStatus === "partial"
            ? `Өр төлбөр: ${sale.itemSummary || sale.transactionId}`
            : sale.itemSummary || sale.transactionId,
        price: sale.total,
        category: "Үйлчилгээ",
        quantity: 1,
        staff: sale.staff,
      },
    ],
    total: sale.total,
    isPaid: true,
    paymentLabel: sale.paymentMethod,
    staffName: sale.staff,
    roomNumber: sale.roomOrGuest,
    cashReceived: sale.cashReceived ?? 0,
    changeDue: sale.changeDue ?? 0,
    qpayInvoiceId: sale.qpayInvoiceId ?? "",
  };
}

function buildChargeBillSale(
  charges: UnpaidChargeDetail[],
  fallbackStaffName: string,
  roomLabel: string,
): PrintableSale {
  const items = charges.flatMap((charge): RegisterCartLine[] => {
    const detailItems = (charge.items ?? []).filter(
      (item) => item.name && item.qty > 0 && item.unitPrice >= 0,
    );

    if (detailItems.length > 0) {
      return detailItems.map((item, index) => {
        const sku = item.sku?.trim() || undefined;
        const quantity = Math.max(
          Math.round(Number.isFinite(item.qty) ? item.qty : 1),
          1,
        );
        const price = Math.max(
          Math.round(Number.isFinite(item.unitPrice) ? item.unitPrice : 0),
          0,
        );

        return {
          id: `${charge.transactionId}-${sku ?? index + 1}`,
          sku,
          name: item.name,
          price,
          priceMode: item.priceMode,
          category: item.category || "Үйлчилгээ",
          quantity,
          staff: charge.staff || fallbackStaffName,
        };
      });
    }

    return [
      {
        id: charge.transactionId,
        sku: charge.transactionId,
        name: charge.itemSummary || charge.transactionId,
        price: charge.originalTotal || charge.total,
        category: "Үйлчилгээ",
        quantity: 1,
        staff: charge.staff || fallbackStaffName,
      },
    ];
  });

  return {
    id: charges.map((charge) => charge.transactionId).join(", ") || "BILL",
    createdAt: parseSaleTimestamp(charges[0]?.timestamp ?? ""),
    items,
    total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    isPaid: false,
    paymentLabel: "Төлбөр хүлээгдэж байна",
    staffName: charges[0]?.staff || fallbackStaffName,
    roomNumber: roomLabel || charges[0]?.roomOrGuest || "",
    cashReceived: 0,
    changeDue: 0,
    qpayInvoiceId: charges
      .map((charge) => charge.qpayInvoiceId)
      .filter(Boolean)
      .join(", "),
  };
}

function getChargeGroupKey(charge: UnpaidCharge) {
  return (charge.roomOrGuest || "Байшин/Зочин").trim().toLowerCase();
}

function getChargeGroupLabel(charge: UnpaidCharge) {
  return charge.roomOrGuest || "Байшин/Зочин";
}

function buildChargeGroups(charges: UnpaidCharge[]) {
  const groups = new Map<string, ChargeGroup>();

  for (const charge of charges) {
    const key = getChargeGroupKey(charge);
    const existing = groups.get(key);

    if (existing) {
      existing.charges.push(charge);
      existing.total += charge.total;
      existing.paidAmount += charge.paidAmount;
      existing.originalTotal += charge.originalTotal;
      existing.latestTimestamp = charge.timestamp || existing.latestTimestamp;
    } else {
      groups.set(key, {
        key,
        label: getChargeGroupLabel(charge),
        charges: [charge],
        total: charge.total,
        paidAmount: charge.paidAmount,
        originalTotal: charge.originalTotal,
        latestTimestamp: charge.timestamp,
      });
    }
  }

  return Array.from(groups.values()).sort((first, second) =>
    first.label.localeCompare(second.label),
  );
}

interface RegisterAppProps {
  businessDate: string;
}

export function RegisterApp({ businessDate }: RegisterAppProps) {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>("loading");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "all">(
    "all",
  );
  const [staffName, setStaffName] = useState(STAFF[0] ?? "Staff");
  const [cart, setCart] = useState<RegisterCartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodId>(
    PAYMENT_METHODS[0].id,
  );
  const [cashReceived, setCashReceived] = useState(0);
  const [cardTerminalApproved, setCardTerminalApproved] = useState(false);
  const [partialPaymentMethod, setPartialPaymentMethod] =
    useState<SettlementMethod>("cash");
  const [partialPaymentOption, setPartialPaymentOption] =
    useState<PartialPaymentOption>("cash");
  const [partialPaymentAmount, setPartialPaymentAmount] = useState(0);
  const [partialPaymentLines, setPartialPaymentLines] = useState<
    SettlementPaymentLine[]
  >([]);
  const [customItemName, setCustomItemName] = useState("");
  const [customItemAmount, setCustomItemAmount] = useState(0);
  const [roomNumber, setRoomNumber] = useState("");
  const [saleStatus, setSaleStatus] = useState<SaleStatus>("idle");
  const [saleMessage, setSaleMessage] = useState("");
  const [lastSale, setLastSale] = useState<PrintableSale | null>(null);
  const [saleSequence, setSaleSequence] = useState(0);
  const [bankTransferStatus, setBankTransferStatus] =
    useState<BankTransferStatus>("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [dayStatus, setDayStatus] = useState<DayStatus>("loading");
  const [dayMessage, setDayMessage] = useState("");
  const [daySession, setDaySession] = useState<DaySession | null>(null);
  const [dayTotals, setDayTotals] = useState<DayTotals>(EMPTY_DAY_TOTALS);
  const [dayItemTotals, setDayItemTotals] = useState<DayItemTotal[]>([]);
  const [dayModalMode, setDayModalMode] = useState<DayModalMode>(null);
  const [dayCashAmount, setDayCashAmount] = useState(0);
  const [dayNotes, setDayNotes] = useState("");
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidStatus, setVoidStatus] = useState<VoidStatus>("idle");
  const [voidMessage, setVoidMessage] = useState("");
  const [recentSales, setRecentSales] = useState<RecentSale[]>([]);
  const [selectedVoidTransactionId, setSelectedVoidTransactionId] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [voidRefundMethod, setVoidRefundMethod] = useState("Бэлэн");
  const [registerMode, setRegisterMode] = useState<RegisterMode>("sale");
  const [historySales, setHistorySales] = useState<RecentSale[]>([]);
  const [historyStatus, setHistoryStatus] = useState<CatalogStatus>("loading");
  const [historyMessage, setHistoryMessage] = useState("");
  const [selectedHistoryTransactionId, setSelectedHistoryTransactionId] =
    useState("");
  const [unpaidCharges, setUnpaidCharges] = useState<UnpaidCharge[]>([]);
  const [chargesStatus, setChargesStatus] = useState<CatalogStatus>("loading");
  const [chargesMessage, setChargesMessage] = useState("");
  const [selectedChargeGroupKey, setSelectedChargeGroupKey] = useState("");
  const [selectedChargeIds, setSelectedChargeIds] = useState<string[]>([]);
  const [editingCharge, setEditingCharge] = useState<UnpaidCharge | null>(null);
  const [deletingChargeId, setDeletingChargeId] = useState("");
  const [settlementMethod, setSettlementMethod] =
    useState<SettlementMethod>("cash");
  const [settlementPaymentAmount, setSettlementPaymentAmount] = useState(0);
  const [settlementLines, setSettlementLines] = useState<SettlementPaymentLine[]>([]);
  const [settlementStatus, setSettlementStatus] =
    useState<SettlementStatus>("idle");
  const [settlementMessage, setSettlementMessage] = useState("");
  const selectedChargeGroupKeyRef = useRef("");
  const uiPreferencesLoadedRef = useRef(false);
  const lastSharedRefreshAtRef = useRef(0);
  const daySessionSignatureRef = useRef("");
  const localIdSequenceRef = useRef(0);

  function getNextLocalId(prefix: string) {
    localIdSequenceRef.current += 1;
    return `${prefix}-${localIdSequenceRef.current}`;
  }

  const loadCatalog = useCallback(async (options?: { fresh?: boolean }) => {
    try {
      const response = await fetch(
        options?.fresh ? "/api/inventory?fresh=1" : "/api/inventory",
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Catalogue request failed");

      const data = (await response.json()) as CatalogResponseItem[];
      if (!Array.isArray(data) || data.length === 0) {
        setCatalog([]);
        setCatalogStatus("sample");
        return;
      }

      setCatalog(data.map(normalizeCatalogRow));
      setCatalogStatus("ready");
    } catch {
      setCatalog([]);
      setCatalogStatus("sample");
    }
  }, []);

  const applyUnpaidCharges = useCallback((charges: UnpaidCharge[]) => {
    const groups = buildChargeGroups(charges);
    const nextGroup =
      groups.find((group) => group.key === selectedChargeGroupKeyRef.current) ??
      groups[0] ??
      null;

    setUnpaidCharges(charges);
    selectedChargeGroupKeyRef.current = nextGroup?.key ?? "";
    setSelectedChargeGroupKey(nextGroup?.key ?? "");
    setSelectedChargeIds(
      nextGroup?.charges.map((charge) => charge.transactionId) ?? [],
    );
  }, []);

  const applySalesHistory = useCallback((history: RecentSale[]) => {
    setHistorySales(history);
    setSelectedHistoryTransactionId((current) =>
      history.some((sale) => sale.transactionId === current)
        ? current
        : history[0]?.transactionId ?? "",
    );
  }, []);

  const loadUnpaidCharges = useCallback(async (options?: { fresh?: boolean; silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setChargesStatus("loading");
      setChargesMessage("");
    }

    try {
      const response = await fetch(
        options?.fresh ? "/api/sales?fresh=1" : "/api/sales",
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { charges?: UnpaidCharge[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өр төлбөрүүдийг авч чадсангүй");
      }

      const charges = Array.isArray(data?.charges) ? data.charges : [];
      applyUnpaidCharges(charges);
      setChargesStatus("ready");
    } catch (error) {
      if (silent) return;

      setUnpaidCharges([]);
      setChargesStatus("sample");
      selectedChargeGroupKeyRef.current = "";
      setSelectedChargeGroupKey("");
      setSelectedChargeIds([]);
      setChargesMessage(
        error instanceof Error ? error.message : "Өр төлбөрүүдийг авч чадсангүй",
      );
    }
  }, [applyUnpaidCharges]);

  const loadSalesHistory = useCallback(async (options?: { fresh?: boolean; silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setHistoryStatus("loading");
      setHistoryMessage("");
    }

    try {
      const params = new URLSearchParams({ businessDate });
      if (options?.fresh) params.set("fresh", "1");
      const response = await fetch(
        `/api/sales?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { history?: RecentSale[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Төлөгдсөн түүх авч чадсангүй");
      }

      const history = Array.isArray(data?.history) ? data.history : [];
      applySalesHistory(history);
      setHistoryStatus("ready");
    } catch (error) {
      if (silent) return;

      setHistorySales([]);
      setSelectedHistoryTransactionId("");
      setHistoryStatus("sample");
      setHistoryMessage(
        error instanceof Error ? error.message : "Төлөгдсөн түүх авч чадсангүй",
      );
    }
  }, [applySalesHistory, businessDate]);

  const loadSharedSalesData = useCallback(async (options?: { fresh?: boolean; silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setChargesStatus("loading");
      setHistoryStatus("loading");
      setChargesMessage("");
      setHistoryMessage("");
    }

    try {
      const params = new URLSearchParams({ businessDate });
      if (options?.fresh) params.set("fresh", "1");
      const response = await fetch(
        `/api/sales?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { charges?: UnpaidCharge[]; history?: RecentSale[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өр, түүх шинэчилж чадсангүй");
      }

      applyUnpaidCharges(Array.isArray(data?.charges) ? data.charges : []);
      applySalesHistory(Array.isArray(data?.history) ? data.history : []);
      setChargesStatus("ready");
      setHistoryStatus("ready");
    } catch (error) {
      if (silent) return;

      setUnpaidCharges([]);
      selectedChargeGroupKeyRef.current = "";
      setSelectedChargeGroupKey("");
      setSelectedChargeIds([]);
      setChargesStatus("sample");
      setHistorySales([]);
      setSelectedHistoryTransactionId("");
      setHistoryStatus("sample");
      const message =
        error instanceof Error ? error.message : "Өр, түүх шинэчилж чадсангүй";
      setChargesMessage(message);
      setHistoryMessage(message);
    }
  }, [applySalesHistory, applyUnpaidCharges, businessDate]);

  const loadDayStatus = useCallback(async (options?: { fresh?: boolean; silent?: boolean }) => {
    const silent = options?.silent ?? false;
    if (!silent) {
      setDayStatus("loading");
      setDayMessage("");
    }

    try {
      const params = new URLSearchParams({ businessDate });
      if (options?.fresh) params.set("fresh", "1");
      const response = await fetch(
        `/api/day?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | {
            session?: DaySession | null;
            totals?: DayTotals;
            itemTotals?: DayItemTotal[];
            error?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өдрийн төлөв авч чадсангүй");
      }

      const nextSession = data?.session ?? null;
      daySessionSignatureRef.current = getDaySessionSignature(nextSession);
      setDaySession(nextSession);
      setDayTotals(data?.totals ?? EMPTY_DAY_TOTALS);
      setDayItemTotals(data?.itemTotals ?? []);
      setDayStatus("ready");
    } catch (error) {
      if (silent) return;

      setDaySession(null);
      setDayTotals(EMPTY_DAY_TOTALS);
      setDayItemTotals([]);
      setDayStatus("error");
      setDayMessage(
        error instanceof Error ? error.message : "Өдрийн төлөв авч чадсангүй",
      );
    }
  }, [businessDate]);

  const loadDaySession = useCallback(async (options?: { fresh?: boolean }) => {
    if (dayStatus === "saving") return;

    try {
      const params = new URLSearchParams({
        businessDate,
        sessionOnly: "1",
      });
      if (options?.fresh) params.set("fresh", "1");
      const response = await fetch(
        `/api/day?${params.toString()}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { session?: DaySession | null; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өдрийн төлөв авч чадсангүй");
      }

      const nextSession = data?.session ?? null;
      const previousSignature = daySessionSignatureRef.current;
      const nextSignature = getDaySessionSignature(nextSession);
      const changed = previousSignature !== nextSignature;

      daySessionSignatureRef.current = nextSignature;
      setDaySession(nextSession);
      setDayStatus((current) => current === "saving" ? current : "ready");

      if (changed) {
        setDayModalMode((current) => {
          if (current === "open" && nextSession?.status === "open") return null;
          if (current === "close" && nextSession?.status !== "open") return null;
          return current;
        });
        void loadDayStatus({ fresh: true, silent: true });
      }
    } catch {
      // Silent sync should not interrupt the cashier flow.
    }
  }, [businessDate, dayStatus, loadDayStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      lastSharedRefreshAtRef.current = Date.now();
      void loadCatalog();
      void loadSharedSalesData();
      void loadDayStatus();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCatalog, loadDayStatus, loadSharedSalesData]);

  useEffect(() => {
    const refreshSharedState = (force = false) => {
      const now = Date.now();
      if (
        !force &&
        now - lastSharedRefreshAtRef.current < SHARED_REFRESH_FOCUS_COOLDOWN_MS
      ) {
        return;
      }

      lastSharedRefreshAtRef.current = now;
      void loadDayStatus({ silent: true });
      void loadSharedSalesData({ silent: true });
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        refreshSharedState();
      }
    };
    const refreshWhenFocused = () => {
      refreshSharedState();
    };
    const interval = window.setInterval(
      () => refreshSharedState(true),
      SHARED_SALES_SYNC_INTERVAL_MS,
    );

    window.addEventListener("focus", refreshWhenFocused);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenFocused);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadDayStatus, loadSharedSalesData]);

  useEffect(() => {
    const syncDaySession = (options?: { fresh?: boolean }) => {
      if (document.visibilityState === "visible") {
        void loadDaySession(options);
      }
    };
    const syncFreshDaySession = () => syncDaySession({ fresh: true });
    const syncDaySessionWhenVisible = () => {
      if (document.visibilityState === "visible") {
        syncFreshDaySession();
      }
    };
    const interval = window.setInterval(
      () => syncDaySession(),
      DAY_SESSION_SYNC_INTERVAL_MS,
    );

    window.addEventListener("focus", syncFreshDaySession);
    document.addEventListener("visibilitychange", syncDaySessionWhenVisible);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncFreshDaySession);
      document.removeEventListener(
        "visibilitychange",
        syncDaySessionWhenVisible,
      );
    };
  }, [loadDaySession]);

  useEffect(() => {
    if (catalogStatus !== "sample") return;

    const retryCatalog = () => {
      if (document.visibilityState === "visible") {
        void loadCatalog();
      }
    };
    const retryWhenVisible = () => {
      if (document.visibilityState === "visible") {
        retryCatalog();
      }
    };
    const retryTimer = window.setTimeout(
      retryCatalog,
      CATALOG_RETRY_DELAY_MS,
    );
    const retryInterval = window.setInterval(
      retryCatalog,
      CATALOG_RETRY_INTERVAL_MS,
    );

    window.addEventListener("focus", retryCatalog);
    document.addEventListener("visibilitychange", retryWhenVisible);

    return () => {
      window.clearTimeout(retryTimer);
      window.clearInterval(retryInterval);
      window.removeEventListener("focus", retryCatalog);
      document.removeEventListener("visibilitychange", retryWhenVisible);
    };
  }, [catalogStatus, loadCatalog]);

  useEffect(() => {
    const storedMode = window.localStorage.getItem(REGISTER_MODE_STORAGE_KEY);
    const storedCategory = window.localStorage.getItem(
      REGISTER_CATEGORY_STORAGE_KEY,
    );

    const readyTimer = window.setTimeout(() => {
      if (isRegisterMode(storedMode)) {
        setRegisterMode(storedMode);
      }
      if (storedCategory) {
        setActiveCategory(storedCategory);
      }
      uiPreferencesLoadedRef.current = true;
    }, 0);

    return () => window.clearTimeout(readyTimer);
  }, []);

  useEffect(() => {
    if (!uiPreferencesLoadedRef.current) return;
    window.localStorage.setItem(REGISTER_MODE_STORAGE_KEY, registerMode);
  }, [registerMode]);

  useEffect(() => {
    if (!uiPreferencesLoadedRef.current) return;
    window.localStorage.setItem(REGISTER_CATEGORY_STORAGE_KEY, activeCategory);
  }, [activeCategory]);

  useEffect(() => {
    function syncFullscreenState() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    syncFullscreenState();
    document.addEventListener("fullscreenchange", syncFullscreenState);

    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  const products = useMemo(() => getDisplayProducts(catalog), [catalog]);

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((item) => {
      const matchesCategory =
        activeCategory === "all" || item.category === activeCategory;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.name.toLowerCase().includes(normalizedQuery) ||
        item.sku?.toLowerCase().includes(normalizedQuery);

      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, products, query]);

  const categories = useMemo(() => {
    const unique = Array.from(new Set(products.map((item) => item.category)));
    return ["all", ...unique];
  }, [products]);

  useEffect(() => {
    if (
      products.length > 0 &&
      activeCategory !== "all" &&
      !categories.includes(activeCategory)
    ) {
      const resetTimer = window.setTimeout(() => setActiveCategory("all"), 0);
      return () => window.clearTimeout(resetTimer);
    }
  }, [activeCategory, categories, products.length]);

  const cartTotal = cart.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  const isEditingCharge = Boolean(editingCharge);
  const selectedPayment =
    PAYMENT_METHODS.find((method) => method.id === paymentMethod) ??
    PAYMENT_METHODS[0];
  const cashRequired = paymentMethod === "cash";
  const cardRequired = paymentMethod === "card";
  const cashShort = Math.max(cartTotal - cashReceived, 0);
  const changeDue = Math.max(cashReceived - cartTotal, 0);
  const roomRequired = paymentMethod === "room";
  const bankTransferRequired = paymentMethod === "bank";
  const partialRequired = paymentMethod === "partial";
  const bankTransferConfirmed = bankTransferStatus === "paid";
  const partialPaymentLineTotal = partialPaymentLines.reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  const partialRemaining = Math.max(cartTotal - partialPaymentLineTotal, 0);
  const partialDraftOverRemaining = partialPaymentAmount > partialRemaining;
  const partialSaleFullyPaid =
    partialRequired &&
    partialPaymentLines.length > 0 &&
    partialRemaining === 0;
  const partialSaleHasBalance = partialRequired && partialRemaining > 0;
  const partialBalanceOptionSelected = partialPaymentOption === "balance";
  const canAddPartialPaymentLine =
    partialRequired &&
    cartTotal > 0 &&
    partialRemaining > 0 &&
    partialPaymentAmount > 0 &&
    !partialDraftOverRemaining;
  const dayOpen = daySession?.status === "open";
  const dayClosed = daySession?.status === "closed";
  const dayNonCashPaymentTotal =
    dayTotals.cardPaymentTotal + dayTotals.qpayPaymentTotal;
  const dayCashDifference = dayCashAmount - dayTotals.expectedCash;
  const dayCloseHasVariance =
    dayModalMode === "close" && dayCashDifference !== 0;
  const canSubmitDaySession =
    dayStatus !== "saving" &&
    dayCashAmount >= 0 &&
    (!dayCloseHasVariance || dayNotes.trim().length > 0);
  const selectedVoidSale =
    recentSales.find((sale) => sale.transactionId === selectedVoidTransactionId) ??
    null;
  const selectedHistorySale =
    historySales.find((sale) => sale.transactionId === selectedHistoryTransactionId) ??
    null;
  const selectedHistorySaleTotal =
    selectedHistorySale?.saleTotal ?? selectedHistorySale?.total ?? 0;
  const selectedHistoryBalance = selectedHistorySale?.balance ?? 0;
  const selectedHistoryPaidToDate =
    selectedHistorySale?.paidToDate ?? selectedHistorySale?.paidAmount ?? 0;
  const selectedHistoryPaymentTitle =
    selectedHistorySale?.historyKind === "payment" ? "Энэ удаа төлсөн" : "Нийт төлсөн";
  const canSubmitVoid =
    voidStatus !== "saving" &&
    Boolean(selectedVoidSale) &&
    voidReason.trim().length > 0;
  const canCompleteSale =
    dayOpen &&
    cart.length > 0 &&
    saleStatus !== "saving" &&
    (!isEditingCharge || roomRequired) &&
    (!cashRequired || cashShort === 0) &&
    (!cardRequired || cardTerminalApproved) &&
    (!roomRequired || roomNumber.trim().length > 0) &&
    (!bankTransferRequired || bankTransferConfirmed) &&
    (!partialRequired ||
      (partialPaymentLines.length > 0 &&
        partialPaymentAmount === 0 &&
        (partialRemaining === 0 || roomNumber.trim().length > 0)));
  const completeSaleLabel = saleStatus === "saving"
    ? "Хадгалж байна"
    : isEditingCharge
      ? "Засвар хадгалах"
    : !dayOpen
      ? "Өдрөө нээнэ үү"
    : roomRequired
      ? "Байшин/зочинд бичих"
    : partialRequired
      ? partialPaymentLines.length === 0
        ? "Төлбөрийн мөр нэмнэ үү"
        : partialPaymentAmount > 0
          ? "Мөр нэмэх эсвэл арилгах"
          : partialRemaining === 0
            ? "Төлбөр хаах"
        : roomNumber.trim().length === 0
          ? "Үлдэгдэл бичих хүнээ оруулна уу"
          : "Хэсэгчилсэн хадгалах"
      : cardRequired
        ? cardTerminalApproved
          ? "Карт борлуулалт хадгалах"
          : "Терминал баталгаажуулна уу"
      : bankTransferRequired
        ? bankTransferConfirmed
          ? "Дансны борлуулалт хадгалах"
          : "Данс шалгаж баталгаажуулна уу"
        : "Төлбөр авах";
  const chargeGroups = useMemo(
    () => buildChargeGroups(unpaidCharges),
    [unpaidCharges],
  );
  const selectedChargeGroup =
    chargeGroups.find((group) => group.key === selectedChargeGroupKey) ?? null;
  const selectedCharges = unpaidCharges.filter((charge) =>
    selectedChargeIds.includes(charge.transactionId),
  );
  const selectedChargeTotal = selectedCharges.reduce(
    (sum, charge) => sum + charge.total,
    0,
  );
  const selectedChargeOriginalTotal = selectedCharges.reduce(
    (sum, charge) => sum + charge.originalTotal,
    0,
  );
  const selectedChargePaidAmount = selectedCharges.reduce(
    (sum, charge) => sum + charge.paidAmount,
    0,
  );
  const settlementLineTotal = settlementLines.reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  const settlementRemaining = Math.max(
    selectedChargeTotal - settlementLineTotal,
    0,
  );
  const settlementDraftAmount = settlementPaymentAmount;
  const settlementDraftOverRemaining = settlementDraftAmount > settlementRemaining;
  const canAddSettlementLine =
    selectedCharges.length > 0 &&
    settlementStatus !== "saving" &&
    settlementRemaining > 0 &&
    settlementDraftAmount > 0 &&
    !settlementDraftOverRemaining;
  const canSettleCharge =
    selectedCharges.length > 0 &&
    settlementLines.length > 0 &&
    settlementStatus !== "saving";
  const settlementSubmitLabel = settlementStatus === "saving"
    ? "Бичиж байна"
    : settlementLines.length === 0
      ? "Төлбөр нэмнэ үү"
    : settlementRemaining === 0
      ? "Төлбөр хаах"
      : "Үлдэгдэлтэй хадгалах";
  function addToCart(item: CatalogItem, priceMode: PriceMode = getDefaultPriceMode(item)) {
    setSaleStatus("idle");
    setSaleMessage("");
    setLastSale(null);
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();
    const resolvedPriceMode =
      priceMode === "guest" && !hasGuestPrice(item) && hasStaffPrice(item)
        ? "staff"
        : priceMode;
    const lineId = getCartLineId(item, resolvedPriceMode);
    const linePrice = getPriceForMode(item, resolvedPriceMode);
    setCart((current) => {
      const existing = current.find((line) => line.id === lineId);
      if (existing) {
        return current.map((line) =>
          line.id === lineId
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }

      return [
        ...current,
        {
          id: lineId,
          sku: item.sku,
          name: item.name,
          price: linePrice,
          priceMode: resolvedPriceMode,
          category: item.category,
          quantity: 1,
          staff: staffName,
        },
      ];
    });
  }

  function updateQuantity(id: string, quantity: number) {
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();
    setCart((current) =>
      current
        .map((line) => (line.id === id ? { ...line, quantity } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function setCustomAmountInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    setCustomItemAmount(Number.isFinite(amount) ? amount : 0);
  }

  function addCustomAmountToCart() {
    const amount = Math.round(customItemAmount);
    if (amount <= 0) {
      setSaleStatus("error");
      setSaleMessage("Гараар нэмэх дүнгээ оруулна уу");
      return;
    }

    setSaleStatus("idle");
    setSaleMessage("");
    setLastSale(null);
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();

    const name = customItemName.trim() || "Гараар нэмсэн төлбөр";
    const id = getNextLocalId("custom");
    setCart((current) => [
      ...current,
      {
        id,
        name,
        price: amount,
        category: "Үйлчилгээ",
        quantity: 1,
        staff: staffName,
      },
    ]);
    setCustomItemName("");
    setCustomItemAmount(0);
  }

  function clearCurrentSale() {
    setCart([]);
    setCashReceived(0);
    setRoomNumber("");
    setSaleStatus("idle");
    setSaleMessage("");
    setLastSale(null);
    setEditingCharge(null);
    setPaymentMethod("cash");
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();
  }

  function selectPaymentMethod(method: PaymentMethodId) {
    if (isEditingCharge && method !== "room") return;

    setPaymentMethod(method);
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function resetBankTransferPayment() {
    setBankTransferStatus("idle");
  }

  function resetPartialPaymentState() {
    setPartialPaymentLines([]);
    resetPartialPaymentDraft();
  }

  function resetPartialPaymentDraft() {
    setPartialPaymentMethod("cash");
    setPartialPaymentOption("cash");
    setPartialPaymentAmount(0);
  }

  function selectPartialPaymentMethod(method: SettlementMethod) {
    setPartialPaymentMethod(method);
    setPartialPaymentOption(method);
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function selectPartialBalanceOption() {
    if (partialPaymentLines.length === 0) {
      setSaleStatus("error");
      setSaleMessage("Эхлээд төлсөн мөрөө нэмнэ үү");
      return;
    }

    if (partialRemaining === 0) {
      setSaleStatus("error");
      setSaleMessage("Үлдэгдэл байхгүй, төлбөрөө хаана уу");
      return;
    }

    if (partialPaymentAmount > 0) {
      setSaleStatus("error");
      setSaleMessage("Бичсэн дүнгээ Мөр нэмэхээр баталгаажуулна уу");
      return;
    }

    setPartialPaymentOption("balance");
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function setPartialPaymentAmountInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    setPartialPaymentAmount(Number.isFinite(amount) ? amount : 0);
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function addPartialPaymentLine() {
    if (!canAddPartialPaymentLine) {
      if (partialDraftOverRemaining) {
        setSaleStatus("error");
        setSaleMessage("Төлөх мөр үлдэгдлээс их байна");
        return;
      }

      if (partialPaymentAmount <= 0) {
        setSaleStatus("error");
        setSaleMessage("Нэмэх дүнгээ оруулна уу");
        return;
      }

      return;
    }

    const methodLabel =
      SETTLEMENT_METHODS.find((method) => method.id === partialPaymentMethod)
        ?.label ?? partialPaymentMethod;
    setPartialPaymentLines((current) => [
      ...current,
      {
        id: getNextLocalId("sale-payment"),
        method: partialPaymentMethod,
        methodLabel,
        amount: partialPaymentAmount,
        cashReceived:
          partialPaymentMethod === "cash" ? partialPaymentAmount : 0,
        changeDue: 0,
        qpayInvoiceId: "",
      },
    ]);
    setSaleStatus("idle");
    setSaleMessage("");
    resetPartialPaymentDraft();
  }

  function removePartialPaymentLine(id: string) {
    setPartialPaymentLines((current) => current.filter((line) => line.id !== id));
    if (partialPaymentLines.length <= 1) {
      setPartialPaymentOption("cash");
    }
    setSaleStatus("idle");
    setSaleMessage("");
  }

  function setCashInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    setCashReceived(Number.isFinite(amount) ? amount : 0);
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function openDayModal(mode: Exclude<DayModalMode, null>) {
    setDayModalMode(mode);
    setDayStatus("ready");
    setDayMessage("");
    setDayNotes("");
    setDayCashAmount(mode === "open" ? daySession?.startingCash ?? 0 : 0);
  }

  function setDayCashInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    setDayCashAmount(Number.isFinite(amount) ? amount : 0);
    if (dayStatus === "error") {
      setDayStatus("ready");
      setDayMessage("");
    }
  }

  async function submitDaySession() {
    if (!dayModalMode || dayStatus === "saving") return;
    if (!canSubmitDaySession) {
      setDayStatus("error");
      setDayMessage("Зөрүүтэй бол тайлбар бичнэ үү");
      return;
    }

    const actionMode = dayModalMode;
    const countedCash = dayCashAmount;
    const notes = dayNotes;
    const dayCloseWindow = actionMode === "close" ? openPrintWindow() : false;

    setDayStatus("saving");
    setDayMessage("");

    try {
      const response = await fetch("/api/day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionMode,
          businessDate,
          staffName,
          startingCash: actionMode === "open" ? dayCashAmount : undefined,
          countedCash: actionMode === "close" ? countedCash : undefined,
          notes,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            session?: DaySession | null;
            totals?: DayTotals;
            itemTotals?: DayItemTotal[];
            error?: string;
          }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өдрийн төлөв хадгалж чадсангүй");
      }

      const nextSession = data?.session ?? null;
      const nextTotals = data?.totals ?? EMPTY_DAY_TOTALS;
      const nextItemTotals = data?.itemTotals ?? [];
      const closeReportPrinted =
        actionMode === "close" && nextSession
          ? printDayCloseReport(
              {
                businessDate,
                openedAt: nextSession.openedAt,
                closedAt: nextSession.closedAt,
                openedBy: nextSession.openedBy,
                closedBy: nextSession.closedBy,
                staffName,
                startingCash: nextSession.startingCash,
                countedCash,
                expectedCash: nextTotals.expectedCash,
                cashDifference: countedCash - nextTotals.expectedCash,
                totals: nextTotals,
                itemTotals: nextItemTotals,
                notes,
              },
              dayCloseWindow,
            )
          : false;

      daySessionSignatureRef.current = getDaySessionSignature(nextSession);
      setDaySession(nextSession);
      setDayTotals(nextTotals);
      setDayItemTotals(nextItemTotals);
      setDayModalMode(null);
      setDayCashAmount(0);
      setDayNotes("");
      setDayStatus("ready");
      setDayMessage(
        actionMode === "open"
          ? "Өдөр нээгдлээ"
          : [
              "Өдрийн хаалт хадгалагдлаа",
              closeReportPrinted
                ? "Хаалт хэвлэгдэж байна"
                : "Хаалтын хэвлэх цонх нээгдсэнгүй",
            ].join(" · "),
      );
    } catch (error) {
      closePrintWindow(dayCloseWindow);
      setDayStatus("error");
      setDayMessage(
        error instanceof Error ? error.message : "Өдрийн төлөв хадгалж чадсангүй",
      );
    }
  }

  async function loadVoidableSales() {
    setVoidStatus("loading");
    setVoidMessage("");

    try {
      const response = await fetch(
        `/api/voids?businessDate=${encodeURIComponent(businessDate)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { sales?: RecentSale[]; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Борлуулалтын жагсаалт авч чадсангүй");
      }

      const sales = Array.isArray(data?.sales) ? data.sales : [];
      setRecentSales(sales);
      setSelectedVoidTransactionId((current) =>
        sales.some((sale) => sale.transactionId === current)
          ? current
          : sales[0]?.transactionId ?? "",
      );
      setVoidStatus("idle");
    } catch (error) {
      setRecentSales([]);
      setSelectedVoidTransactionId("");
      setVoidStatus("error");
      setVoidMessage(
        error instanceof Error
          ? error.message
          : "Борлуулалтын жагсаалт авч чадсангүй",
      );
    }
  }

  function openVoidModal() {
    if (!dayOpen) {
      setVoidStatus("error");
      setVoidMessage("Буцаалт хийхээс өмнө өдрөө нээнэ үү");
      openDayModal("open");
      return;
    }

    setVoidModalOpen(true);
    setVoidReason("");
    setVoidRefundMethod("Бэлэн");
    setVoidMessage("");
    void loadVoidableSales();
  }

  async function submitVoidSale() {
    if (!selectedVoidSale || !canSubmitVoid) {
      setVoidStatus("error");
      setVoidMessage("Буцаах борлуулалт болон шалтгаанаа сонгоно уу");
      return;
    }

    setVoidStatus("saving");
    setVoidMessage("");

    try {
      const response = await fetch("/api/voids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: selectedVoidSale.transactionId,
          businessDate,
          staffName,
          reason: voidReason,
          refundMethod:
            selectedVoidSale.refundableAmount > 0
              ? voidRefundMethod
              : "No refund",
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { refundAmount?: number; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Буцаалт хадгалж чадсангүй");
      }

      setVoidReason("");
      await Promise.all([
        loadVoidableSales(),
        loadDayStatus({ fresh: true }),
        loadSharedSalesData({ fresh: true }),
      ]);
      setVoidStatus("success");
      setVoidMessage(
        `Буцаалт хадгалагдлаа${
          Number(data?.refundAmount ?? 0) > 0
            ? ` · ${formatMNT(Number(data?.refundAmount ?? 0))}`
            : ""
        }`,
      );
    } catch (error) {
      setVoidStatus("error");
      setVoidMessage(
        error instanceof Error ? error.message : "Буцаалт хадгалж чадсангүй",
      );
    }
  }

  function selectRegisterMode(mode: RegisterMode) {
    if (mode !== "sale" && editingCharge) {
      setEditingCharge(null);
      setCart([]);
      setCashReceived(0);
      setRoomNumber("");
      setPaymentMethod("cash");
      setCardTerminalApproved(false);
      resetBankTransferPayment();
      resetPartialPaymentState();
      setLastSale(null);
      resetSettlementPaymentState();
    }
    setRegisterMode(mode);
    setSaleStatus("idle");
    setSaleMessage("");
    setSettlementStatus("idle");
    setSettlementMessage("");
    if (mode === "charges" || mode === "history") {
      void loadSharedSalesData();
    }
  }

  function selectChargeGroup(group: ChargeGroup) {
    selectedChargeGroupKeyRef.current = group.key;
    setSelectedChargeGroupKey(group.key);
    setSelectedChargeIds(group.charges.map((charge) => charge.transactionId));
    resetSettlementPaymentState();
  }

  function toggleSelectedCharge(transactionId: string) {
    setSelectedChargeIds((current) => {
      const next = current.includes(transactionId)
        ? current.filter((id) => id !== transactionId)
        : [...current, transactionId];
      return next;
    });
    resetSettlementPaymentState();
  }

  function startAdditionalCharge(group: ChargeGroup) {
    setRegisterMode("sale");
    setEditingCharge(null);
    setPaymentMethod("room");
    setRoomNumber(group.label);
    setCart([]);
    setCashReceived(0);
    setCardTerminalApproved(false);
    resetBankTransferPayment();
    resetPartialPaymentState();
    setLastSale(null);
    setSaleStatus("idle");
    setSaleMessage(`${group.label} дээр нэмэлт захиалга бичнэ`);
    resetSettlementPaymentState();
  }

  function buildChargeEditCartLines(items: ChargeEditItem[], charge: UnpaidCharge) {
    if (items.length === 0) {
      return [
        {
          id: getNextLocalId("edit"),
          name: charge.itemSummary || charge.transactionId,
          price: charge.originalTotal || charge.total,
          category: "Үйлчилгээ",
          quantity: 1,
          staff: staffName,
        },
      ];
    }

    return items.map((item, index) => {
      const priceMode: PriceMode =
        item.priceMode === "staff" ? "staff" : "guest";
      const sku = item.sku?.trim() || undefined;

      return {
        id: sku ? `${sku}:${priceMode}` : getNextLocalId(`edit-${index + 1}`),
        sku,
        name: item.name,
        price: Math.round(item.unitPrice),
        priceMode: sku ? priceMode : undefined,
        category: item.category || "Үйлчилгээ",
        quantity: Math.max(Math.round(item.qty), 1),
        staff: staffName,
      };
    });
  }

  async function startEditingCharge(charge: UnpaidCharge) {
    if (charge.paidAmount > 0) {
      setSettlementStatus("error");
      setSettlementMessage(
        "Хэсэгчилсэн төлбөр орсон өрийг засахгүй. Үлдэгдлийг хаах эсвэл буцаалт ашиглана уу.",
      );
      return;
    }

    resetSettlementPaymentState();
    setSettlementStatus("idle");
    setSettlementMessage("Захиалга уншиж байна");

    try {
      const response = await fetch(
        `/api/sales?transactionId=${encodeURIComponent(charge.transactionId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json().catch(() => null)) as
        | { charge?: UnpaidChargeDetail; error?: string }
        | null;

      if (!response.ok || !data?.charge) {
        throw new Error(data?.error ?? "Өрийн захиалга уншиж чадсангүй");
      }

      const detailedCharge = data.charge;
      const editLines = buildChargeEditCartLines(
        detailedCharge.items ?? [],
        detailedCharge,
      );

      setEditingCharge(detailedCharge);
      setCart(editLines);
      setPaymentMethod("room");
      setRoomNumber(detailedCharge.roomOrGuest || charge.roomOrGuest);
      setCashReceived(0);
      setCardTerminalApproved(false);
      resetBankTransferPayment();
      resetPartialPaymentState();
      setLastSale(null);
      setSaleStatus("idle");
      setSaleMessage(`${charge.transactionId} засаж байна`);
      setSettlementStatus("idle");
      setSettlementMessage("");
      setRegisterMode("sale");
    } catch (error) {
      setSettlementStatus("error");
      setSettlementMessage(
        error instanceof Error
          ? error.message
          : "Өрийн захиалга уншиж чадсангүй",
      );
    }
  }

  async function deleteCharge(charge: UnpaidCharge) {
    if (deletingChargeId) return;

    if (!dayOpen) {
      setSettlementStatus("error");
      setSettlementMessage("Өр устгахаас өмнө өдрөө нээнэ үү");
      openDayModal("open");
      return;
    }

    if (charge.paidAmount > 0) {
      setSettlementStatus("error");
      setSettlementMessage(
        "Төлбөр орсон өрийг шууд устгахгүй. Буцаалт эсвэл хэсэгчилсэн төлбөрийн засвар ашиглана уу.",
      );
      return;
    }

    setDeletingChargeId(charge.transactionId);
    setSettlementStatus("saving");
    setSettlementMessage(`${charge.transactionId} өрийг устгаж байна`);

    try {
      const response = await fetch("/api/voids", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: charge.transactionId,
          businessDate,
          staffName,
          reason: `Өрөөс устгасан: ${charge.roomOrGuest || charge.transactionId}`,
          refundMethod: "No refund",
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өр устгаж чадсангүй");
      }

      setSelectedChargeIds((current) =>
        current.filter((id) => id !== charge.transactionId),
      );
      if (editingCharge?.transactionId === charge.transactionId) {
        clearCurrentSale();
      }
      setSettlementLines([]);
      resetSettlementDraft();
      await Promise.allSettled([
        loadSharedSalesData({ fresh: true }),
        loadDayStatus({ fresh: true }),
        voidModalOpen ? loadVoidableSales() : Promise.resolve(),
      ]);
      setSettlementStatus("success");
      setSettlementMessage(`${charge.transactionId} өр устгагдлаа`);
    } catch (error) {
      setSettlementStatus("error");
      setSettlementMessage(
        error instanceof Error ? error.message : "Өр устгаж чадсангүй",
      );
    } finally {
      setDeletingChargeId("");
    }
  }

  function resetSettlementDraft() {
    setSettlementMethod("cash");
    setSettlementPaymentAmount(0);
  }

  function resetSettlementPaymentState() {
    setSettlementLines([]);
    setSettlementStatus("idle");
    setSettlementMessage("");
    resetSettlementDraft();
  }

  function selectSettlementMethod(method: SettlementMethod) {
    setSettlementMethod(method);
    setSettlementStatus("idle");
    setSettlementMessage("");
  }

  function updateSettlementDraftAmount(amount: number) {
    const nextAmount = Number.isFinite(amount) ? amount : 0;
    setSettlementPaymentAmount(nextAmount);
  }

  function setSettlementAmountInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    updateSettlementDraftAmount(amount);
    if (settlementStatus === "error") {
      setSettlementStatus("idle");
      setSettlementMessage("");
    }
  }

  function addSettlementLine() {
    if (!canAddSettlementLine) {
      if (settlementDraftOverRemaining) {
        setSettlementStatus("error");
        setSettlementMessage("Төлөх мөр үлдэгдлээс их байна");
        return;
      }

      if (settlementDraftAmount <= 0) {
        setSettlementStatus("error");
        setSettlementMessage("Нэмэх дүнгээ оруулна уу");
        return;
      }

      return;
    }

    const methodLabel =
      SETTLEMENT_METHODS.find((method) => method.id === settlementMethod)
        ?.label ?? settlementMethod;
    setSettlementLines((current) => [
      ...current,
      {
        id: getNextLocalId("payment"),
        method: settlementMethod,
        methodLabel,
        amount: settlementDraftAmount,
        cashReceived: settlementMethod === "cash" ? settlementDraftAmount : 0,
        changeDue: 0,
        qpayInvoiceId: "",
      },
    ]);
    setSettlementStatus("idle");
    setSettlementMessage("");
    resetSettlementDraft();
  }

  function removeSettlementLine(id: string) {
    setSettlementLines((current) => current.filter((line) => line.id !== id));
    setSettlementStatus("idle");
    setSettlementMessage("");
  }

  async function settleSelectedCharge() {
    if (selectedCharges.length === 0 || settlementStatus === "saving") return;
    if (settlementLines.length === 0) return;

    const shouldAutoPrintSettlementReceipt = settlementRemaining === 0;
    const receiptWindow = shouldAutoPrintSettlementReceipt
      ? openPrintWindow()
      : false;
    setSettlementStatus("saving");
    setSettlementMessage("");

    try {
      const paymentsByTransaction = new Map<
        string,
        Array<{
          paymentMethod: string;
          amount: number;
          cashReceived: number;
          changeDue: number;
          qpayInvoiceId: string;
        }>
      >();
      const remainingByTransaction = selectedCharges.map((charge) => ({
        charge,
        remaining: charge.total,
      }));

      for (const line of settlementLines) {
        let remainingLineAmount = line.amount;
        let tenderDetailsRecorded = false;

        for (const item of remainingByTransaction) {
          if (remainingLineAmount <= 0) break;
          if (item.remaining <= 0) continue;

          const amount = Math.min(remainingLineAmount, item.remaining);
          const payments = paymentsByTransaction.get(item.charge.transactionId) ?? [];
          payments.push({
            paymentMethod: line.methodLabel,
            amount,
            cashReceived: tenderDetailsRecorded ? 0 : line.cashReceived,
            changeDue: tenderDetailsRecorded ? 0 : line.changeDue,
            qpayInvoiceId: line.qpayInvoiceId,
          });
          tenderDetailsRecorded = true;
          paymentsByTransaction.set(item.charge.transactionId, payments);
          item.remaining -= amount;
          remainingLineAmount -= amount;
        }
      }

      if (paymentsByTransaction.size === 0) {
        throw new Error("Төлбөр бичих сонгосон мөр алга байна");
      }

      const settlementReceipt = buildSettlementReceiptSale(
        selectedCharges,
        paymentsByTransaction,
        settlementLines,
        staffName,
        selectedChargeGroup?.label ?? selectedCharges[0]?.roomOrGuest ?? "",
      );

      for (const [transactionId, payments] of paymentsByTransaction) {
        const response = await fetch("/api/sales", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactionId,
            staffName,
            payments,
          }),
        });
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        if (!response.ok) {
          throw new Error(data?.error ?? "Өр төлбөр хааж чадсангүй");
        }
      }

      const receiptPrinted = shouldAutoPrintSettlementReceipt
        ? printReceipt(settlementReceipt, receiptWindow)
        : false;
      setSettlementStatus("success");
      setSettlementMessage(
        [
          settlementRemaining === 0
            ? `${selectedChargeGroup?.label ?? "Өр"} төлбөр хаагдлаа`
            : `${selectedChargeGroup?.label ?? "Өр"} хэсэгчилсэн төлбөр бичигдлээ`,
          shouldAutoPrintSettlementReceipt
            ? receiptPrinted
              ? "Баримт автоматаар хэвлэгдэж байна"
              : "Баримтын цонх нээгдсэнгүй"
            : "",
        ].filter(Boolean).join(" · "),
      );
      setSettlementLines([]);
      resetSettlementDraft();
      await loadSharedSalesData({ fresh: true });
    } catch (error) {
      closePrintWindow(receiptWindow);
      setSettlementStatus("error");
      setSettlementMessage(
        error instanceof Error ? error.message : "Өр төлбөр хааж чадсангүй",
      );
    }
  }

  function setChargeReference(value: string) {
    setRoomNumber(value);
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      setSaleStatus("error");
      setSaleMessage("Бүтэн дэлгэцийн горим нээж чадсангүй");
    }
  }

  function getPaymentLogLabel() {
    if (partialRequired) {
      if (partialRemaining === 0) {
        return `Хувааж төлсөн: ${getSettlementPaymentLabel(partialPaymentLines)}`;
      }

      return `Хэсэгчилсэн: ${getSettlementPaymentLabel(partialPaymentLines)}, үлдэгдэл ${formatNumber(partialRemaining)}`;
    }

    if (!cashRequired) return selectedPayment.label;

    return `${selectedPayment.label} төлсөн ${formatNumber(cashReceived)}, хариулт ${formatNumber(changeDue)}`;
  }

  function buildCurrentBillSale(): PrintableSale {
    return {
      id: `BILL-${(saleSequence + 1).toString().padStart(4, "0")}`,
      createdAt: new Date(),
      items: cart,
      total: cartTotal,
      isPaid: false,
      paymentLabel: "Төлбөр хүлээгдэж байна",
      staffName,
      roomNumber: roomNumber.trim(),
      cashReceived: 0,
      changeDue: 0,
      qpayInvoiceId: "",
    };
  }

  function printCurrentBill() {
    if (cart.length === 0) return;

    const printed = printBill(buildCurrentBillSale());
    if (!printed) {
      setSaleStatus("error");
      setSaleMessage("Биллийн цонх нээгдсэнгүй");
      return;
    }

    setSaleStatus("success");
    setSaleMessage("Билл хэвлэж байна");
  }

  async function printSelectedChargeBill() {
    if (selectedCharges.length === 0 || settlementStatus === "saving") return;

    const chargeBillWindow = openPrintWindow();
    if (!chargeBillWindow) {
      setSettlementStatus("error");
      setSettlementMessage("Биллийн цонх нээгдсэнгүй");
      return;
    }

    const chargesToPrint = selectedCharges;
    setSettlementStatus("saving");
    setSettlementMessage("Билл бэлдэж байна");

    const detailResults = await Promise.allSettled(
      chargesToPrint.map(async (charge) => {
        const response = await fetch(
          `/api/sales?transactionId=${encodeURIComponent(charge.transactionId)}`,
          { cache: "no-store" },
        );
        const data = (await response.json().catch(() => null)) as
          | { charge?: UnpaidChargeDetail; error?: string }
          | null;

        if (!response.ok || !data?.charge) {
          throw new Error(data?.error ?? "Өрийн захиалга уншиж чадсангүй");
        }

        return data.charge;
      }),
    );
    const detailedCharges = detailResults.map((result, index) =>
      result.status === "fulfilled" ? result.value : chargesToPrint[index],
    );
    const hasFallbackCharge = detailResults.some(
      (result) => result.status === "rejected",
    );
    const printed = printBill(
      buildChargeBillSale(
        detailedCharges,
        staffName,
        selectedChargeGroup?.label ?? chargesToPrint[0]?.roomOrGuest ?? "",
      ),
      chargeBillWindow,
    );

    if (!printed) {
      setSettlementStatus("error");
      setSettlementMessage("Биллийн цонх нээгдсэнгүй");
      return;
    }

    setSettlementStatus("success");
    setSettlementMessage(
      hasFallbackCharge
        ? "Билл хэвлэж байна · Зарим мөрийг товчоор хэвлэв"
        : "Билл хэвлэж байна",
    );
  }

  async function saveEditedCharge() {
    if (!editingCharge || saleStatus === "saving") return;
    const chargeReference = roomNumber.trim();

    if (!chargeReference) {
      setSaleStatus("error");
      setSaleMessage("Байшин, нэр эсвэл утас оруулна уу");
      return;
    }

    setSaleStatus("saving");
    setSaleMessage("");

    try {
      const response = await fetch("/api/sales", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_unpaid",
          transactionId: editingCharge.transactionId,
          staffName,
          room: chargeReference,
          total: cartTotal,
          items: cart.map((line) => ({
            sku: line.sku ?? "",
            name: line.name,
            category: line.category,
            qty: line.quantity,
            unitPrice: line.price,
          })),
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "Өрийн захиалга засаж чадсангүй");
      }

      const editedTransactionId = editingCharge.transactionId;
      selectedChargeGroupKeyRef.current = getChargeReferenceKey(chargeReference);
      setEditingCharge(null);
      setCart([]);
      setCashReceived(0);
      setCardTerminalApproved(false);
      setRoomNumber("");
      resetBankTransferPayment();
      resetPartialPaymentState();
      setLastSale(null);
      setRegisterMode("charges");
      setSaleStatus("success");
      setSettlementLines([]);
      resetSettlementDraft();
      setSettlementStatus("success");
      setSettlementMessage(`${editedTransactionId} захиалгын засвар хадгалагдлаа`);
      await Promise.allSettled([
        loadSharedSalesData({ fresh: true }),
        loadDayStatus({ fresh: true }),
      ]);
    } catch (error) {
      setSaleStatus("error");
      setSaleMessage(
        error instanceof Error
          ? error.message
          : "Өрийн захиалга засаж чадсангүй",
      );
    }
  }

  async function completeSale() {
    if (cart.length === 0 || saleStatus === "saving") return;
    if (!dayOpen) {
      setSaleStatus("error");
      setSaleMessage("Борлуулалт хийхээс өмнө өдрөө нээнэ үү");
      openDayModal("open");
      return;
    }
    if (isEditingCharge) {
      await saveEditedCharge();
      return;
    }
    if (cashRequired && cashShort > 0) {
      setSaleStatus("error");
      setSaleMessage(`${formatMNT(cashShort)} дутуу байна`);
      return;
    }
    if (cardRequired && !cardTerminalApproved) {
      setSaleStatus("error");
      setSaleMessage("Картын терминал баталгаажсан эсэхийг тэмдэглэнэ үү");
      return;
    }
    if (roomRequired && roomNumber.trim().length === 0) {
      setSaleStatus("error");
      setSaleMessage("Байшин, нэр эсвэл утас оруулна уу");
      return;
    }
    if (bankTransferRequired && !bankTransferConfirmed) {
      setSaleStatus("error");
      setSaleMessage("Дансны орлогоо мобайл банк дээр шалгаж баталгаажуулна уу");
      return;
    }
    if (partialRequired && partialPaymentLines.length === 0) {
      setSaleStatus("error");
      setSaleMessage("Эхлээд төлсөн мөрөө нэмнэ үү");
      return;
    }
    if (partialRequired && partialPaymentAmount > 0) {
      setSaleStatus("error");
      setSaleMessage("Бичсэн дүнгээ Мөр нэмэхээр баталгаажуулна уу");
      return;
    }
    if (partialRequired && partialRemaining > 0 && roomNumber.trim().length === 0) {
      setSaleStatus("error");
      setSaleMessage("Үлдэгдэл бичих байшин, нэр эсвэл утас оруулна уу");
      return;
    }

    const chargeReference =
      roomRequired || (partialRequired && partialRemaining > 0)
        ? roomNumber.trim()
        : "";
    const shouldAutoPrintReceipt = !roomRequired && !partialRequired;
    const shouldAutoPrintRoomBill = roomRequired;
    const receiptWindow = shouldAutoPrintReceipt ? openPrintWindow() : false;
    const roomBillWindow = shouldAutoPrintRoomBill ? openPrintWindow() : false;

    setSaleStatus("saving");
    setSaleMessage("");
    const nextSaleSequence = saleSequence + 1;
    const completedSale: PrintableSale = {
      id: `SALE-${nextSaleSequence.toString().padStart(4, "0")}`,
      createdAt: new Date(),
      items: cart,
      total: cartTotal,
      isPaid: !roomRequired && (!partialRequired || partialSaleFullyPaid),
      paymentLabel: getPaymentLogLabel(),
      staffName,
      roomNumber: chargeReference,
      cashReceived: cashRequired ? cashReceived : 0,
      changeDue: cashRequired ? changeDue : 0,
      qpayInvoiceId: "",
    };
    const partialPayments = partialRequired
      ? partialPaymentLines.map((line) => ({
          paymentMethod: line.methodLabel,
          amount: line.amount,
          cashReceived: line.cashReceived,
          changeDue: line.changeDue,
          qpayInvoiceId: line.qpayInvoiceId,
          notes: `Initial partial sale payment; balance ${partialRemaining}`,
        }))
      : undefined;

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            sku: line.sku ?? line.id,
            name: line.name,
            category: line.category,
            qty: line.quantity,
            unitPrice: line.price,
          })),
          method: completedSale.paymentLabel,
          room: chargeReference,
          staffName,
          paidStatus: roomRequired || partialSaleHasBalance ? "unpaid" : "paid",
          total: completedSale.total,
          cashReceived: completedSale.cashReceived,
          changeDue: completedSale.changeDue,
          qpayInvoiceId: completedSale.qpayInvoiceId,
          payments: partialPayments,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? "Sale could not be logged");
      }

      setCart([]);
      setCashReceived(0);
      setCardTerminalApproved(false);
      setRoomNumber("");
      resetBankTransferPayment();
      resetPartialPaymentState();
      if (partialRequired) {
        setPaymentMethod("cash");
      }
      setLastSale(completedSale);
      setSaleSequence(nextSaleSequence);
      const receiptPrinted = shouldAutoPrintReceipt
        ? printReceipt(completedSale, receiptWindow)
        : false;
      const roomBillPrinted = shouldAutoPrintRoomBill
        ? printBill(completedSale, roomBillWindow)
        : false;
      setSaleStatus("success");
      if (roomRequired || partialSaleHasBalance) {
        selectedChargeGroupKeyRef.current = getChargeReferenceKey(chargeReference);
        if (roomRequired) {
          setRegisterMode("charges");
        }
        setSettlementStatus("success");
        setSettlementMessage(
          partialRequired
            ? `${chargeReference} дээр ${formatMNT(partialRemaining)} үлдэгдэл бичигдлээ.`
            : `${chargeReference} өр хэсэгт нэмэгдлээ. Төлбөр хаахад бэлэн.`,
        );
      }
      await Promise.allSettled([
        loadSharedSalesData({ fresh: true }),
        loadDayStatus({ fresh: true }),
      ]);
      setSaleMessage(
        [
          `${formatMNT(cartTotal)} хадгаллаа`,
          partialSaleFullyPaid ? "Хувааж төлсөн борлуулалт хаагдлаа" : "",
          partialSaleHasBalance
            ? `${chargeReference} дээр ${formatMNT(partialRemaining)} үлдэгдэл бичигдлээ`
            : "",
          shouldAutoPrintReceipt
            ? receiptPrinted
              ? "Баримт автоматаар хэвлэгдэж байна"
              : "Баримтын цонх нээгдсэнгүй"
            : "",
          shouldAutoPrintRoomBill
            ? roomBillPrinted
              ? "Билл автоматаар хэвлэгдэж байна"
              : "Биллийн цонх нээгдсэнгүй"
            : "Билл хэвлэх товчоор гаргана уу",
        ]
          .filter(Boolean)
          .join(" · "),
      );
    } catch (error) {
      closePrintWindow(receiptWindow);
      closePrintWindow(roomBillWindow);
      setSaleStatus("error");
      setSaleMessage(
        error instanceof Error
          ? error.message
          : "Sale could not be logged",
      );
    }
  }

  return (
    <div className={`${styles.dayansoftPos} flex min-h-dvh flex-col bg-[#f3f4f6] text-[#111827]`}>
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[#d1d5db] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold leading-tight">Dalai Eej POS</h1>
          <p className="text-xs font-medium text-[#6b7280]">{businessDate}</p>
        </div>

        <div className="flex rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-1">
          <button
            type="button"
            onClick={() => selectRegisterMode("sale")}
            className={`h-9 rounded px-3 text-sm font-extrabold ${
              registerMode === "sale"
                ? "bg-[#111827] text-white"
                : "text-[#374151] hover:bg-white"
            }`}
          >
            Борлуулалт
          </button>
          <button
            type="button"
            onClick={() => selectRegisterMode("charges")}
            className={`h-9 rounded px-3 text-sm font-extrabold ${
              registerMode === "charges"
                ? "bg-[#111827] text-white"
                : "text-[#374151] hover:bg-white"
            }`}
          >
            Өр
            {unpaidCharges.length > 0 ? ` (${unpaidCharges.length})` : ""}
          </button>
          <button
            type="button"
            onClick={() => selectRegisterMode("history")}
            className={`h-9 rounded px-3 text-sm font-extrabold ${
              registerMode === "history"
                ? "bg-[#111827] text-white"
                : "text-[#374151] hover:bg-white"
            }`}
          >
            Түүх
            {historySales.length > 0 ? ` (${historySales.length})` : ""}
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div
            className={`flex h-10 items-center rounded-md border px-3 text-xs font-black ${
              dayOpen
                ? "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]"
                : dayClosed
                  ? "border-[#e5e7eb] bg-[#f8fafc] text-[#374151]"
                  : "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]"
            }`}
          >
            {dayStatus === "loading"
              ? "Өдөр..."
              : dayOpen
                ? `Нээлттэй · ${formatMNT(daySession?.startingCash ?? 0)}`
                : dayClosed
                  ? "Хаалттай"
                  : "Өдөр нээгээгүй"}
          </div>
          <button
            type="button"
            onClick={() => openDayModal(dayOpen ? "close" : "open")}
            className={`h-10 rounded-md px-3 text-sm font-black text-white ${
              dayOpen
                ? "bg-[#b91c1c] hover:bg-[#991b1b]"
                : "bg-[#047857] hover:bg-[#065f46]"
            }`}
          >
            {dayOpen ? "Хаалт хийх" : "Өдөр нээх"}
          </button>
          <button
            type="button"
            onClick={openVoidModal}
            className="h-10 rounded-md border border-[#fecaca] bg-white px-3 text-sm font-black text-[#b91c1c] hover:bg-[#fef2f2]"
          >
            Буцаалт
          </button>
          <select
            value={staffName}
            onChange={(event) => setStaffName(event.target.value)}
            className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold"
            aria-label="Ажилтан"
          >
            {STAFF.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void loadCatalog({ fresh: true });
              void loadSharedSalesData({ fresh: true });
              void loadDayStatus({ fresh: true });
            }}
            className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold hover:bg-[#f8fafc]"
          >
            Шинэчлэх
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold hover:bg-[#f8fafc]"
          >
            {isFullscreen ? "Цонхтой" : "Бүтэн дэлгэц"}
          </button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="flex min-h-[360px] flex-col border-r border-[#d1d5db] lg:min-h-0">
          {registerMode === "sale" ? (
            <>
              <div className="shrink-0 border-b border-[#d1d5db] bg-white px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="min-w-[220px] flex-1">
                    <span className="sr-only">Бараа хайх</span>
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      type="search"
                      placeholder="Бараа эсвэл код хайх"
                      className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-base font-semibold text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </label>

                  <div className="flex max-w-full gap-2 overflow-x-auto">
                    {categories.map((category) => (
                      <button
                        key={category}
                        type="button"
                        onClick={() => setActiveCategory(category)}
                        className={`h-11 shrink-0 rounded-md border px-3 text-sm font-bold ${
                          activeCategory === category
                            ? "border-transparent text-white"
                            : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#f8fafc]"
                        }`}
                        style={
                          activeCategory === category
                            ? { backgroundColor: getCategoryAccent(category) }
                            : undefined
                        }
                      >
                        {getCategoryLabel(category)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_140px_120px]">
                  <label>
                    <span className="sr-only">Гараар нэмэх нэр</span>
                    <input
                      value={customItemName}
                      onChange={(event) => setCustomItemName(event.target.value)}
                      type="text"
                      placeholder="Гараар нэмэх: нэр / тайлбар"
                      className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-semibold text-[#111827] outline-none placeholder:text-[#9ca3af] focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </label>
                  <label>
                    <span className="sr-only">Гараар нэмэх дүн</span>
                    <input
                      value={
                        customItemAmount ? formatNumber(customItemAmount) : ""
                      }
                      onChange={(event) =>
                        setCustomAmountInput(event.target.value)
                      }
                      type="text"
                      inputMode="numeric"
                      placeholder="Дүн"
                      className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-right text-sm font-semibold text-[#111827] tabular-nums outline-none placeholder:text-[#9ca3af] focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={addCustomAmountToCart}
                    disabled={customItemAmount <= 0}
                    className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-extrabold hover:bg-[#eef2ff] disabled:opacity-40"
                  >
                    Нэмэх
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {catalogStatus === "sample" && (
                  <div className="mb-3 rounded-md border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-sm font-medium text-[#92400e]">
                    Google Sheets холбогдоогүй байна. Туршилтын жагсаалт ашиглаж байна.
                  </div>
                )}

                {catalogStatus === "loading" ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {Array.from({ length: 10 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-32 rounded-md border border-[#e5e7eb] bg-white"
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                    {visibleProducts.map((item) => (
                      <div
                        key={item.id}
                        data-testid="product-tile"
                        className="flex h-36 flex-col justify-between rounded-md border border-[#d1d5db] bg-white p-3 text-left shadow-sm transition hover:border-[#2563eb] hover:shadow"
                      >
                        <button
                          type="button"
                          onClick={() => addToCart(item)}
                          className="min-h-0 flex-1 text-left"
                        >
                          <span className="break-words text-sm font-bold leading-snug text-[#111827]">
                            {item.name}
                          </span>
                        </button>
                        <div className="flex items-end justify-between gap-2">
                          <span className="text-xs font-medium text-[#6b7280]">
                            {item.sku}
                          </span>
                          <div className="flex flex-col items-end gap-1">
                            {hasGuestPrice(item) ? (
                              <button
                                type="button"
                                onClick={() => addToCart(item, "guest")}
                                className="rounded bg-[#ecfdf5] px-2 py-1 text-sm font-extrabold text-[#047857] hover:bg-[#d1fae5] active:scale-[0.98]"
                              >
                                Амрагч {formatNumber(item.guestPrice ?? item.price)}
                              </button>
                            ) : null}
                            {hasStaffPrice(item) ? (
                              <button
                                type="button"
                                onClick={() => addToCart(item, "staff")}
                                className="rounded bg-[#eef2ff] px-2 py-1 text-[11px] font-extrabold text-[#3730a3] hover:bg-[#e0e7ff] active:scale-[0.98]"
                              >
                                Ажилчин {formatNumber(item.staffPrice ?? 0)}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : registerMode === "charges" ? (
            <>
              <div className="shrink-0 border-b border-[#d1d5db] bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black">Өр төлбөрүүд</h2>
                    <p className="text-xs font-semibold text-[#6b7280]">
                      Байшин, нэр, утсаар бичсэн төлөгдөөгүй борлуулалт
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadUnpaidCharges()}
                    className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-bold hover:bg-[#f8fafc]"
                  >
                    Шинэчлэх
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {chargesStatus === "loading" ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-28 rounded-md border border-[#e5e7eb] bg-white"
                      />
                    ))}
                  </div>
                ) : chargesMessage ? (
                  <div className="rounded-md border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-sm font-bold text-[#92400e]">
                    {chargesMessage}
                  </div>
                ) : chargeGroups.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Одоогоор хаагдаагүй өр алга.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {chargeGroups.map((group) => (
                      <button
                        key={group.key}
                        type="button"
                        onClick={() => selectChargeGroup(group)}
                        className={`rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-[#2563eb] hover:shadow ${
                          selectedChargeGroupKey === group.key
                            ? "border-[#111827] ring-2 ring-[#111827]"
                            : "border-[#d1d5db]"
                        }`}
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-base font-black">
                              {group.label}
                            </p>
                            <p className="text-xs font-semibold text-[#6b7280]">
                              {group.charges.length} төлбөр · {group.latestTimestamp}
                            </p>
                          </div>
                          <span className="shrink-0 text-lg font-black text-[#b91c1c]">
                            {formatMNT(group.total)}
                          </span>
                        </div>
                        <p className="break-words text-sm font-semibold text-[#374151]">
                          {group.charges
                            .map((charge) => charge.itemSummary)
                            .filter(Boolean)
                            .slice(0, 2)
                            .join(" · ") || `${group.charges.length} төлбөр`}
                        </p>
                        {group.paidAmount > 0 && (
                          <p className="mt-2 text-xs font-bold text-[#047857]">
                            Төлсөн {formatMNT(group.paidAmount)} · Үлдэгдэл{" "}
                            {formatMNT(group.total)}
                          </p>
                        )}
                        <p className="mt-2 break-words text-xs font-bold text-[#6b7280]">
                          {group.charges
                            .map((charge) => charge.transactionId)
                            .slice(0, 3)
                            .join(", ")}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="shrink-0 border-b border-[#d1d5db] bg-white px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-black">Төлөгдсөн түүх</h2>
                    <p className="text-xs font-semibold text-[#6b7280]">
                      Өнөөдрийн борлуулалт болон өр төлөлт, баримт дахин хэвлэх
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadSalesHistory()}
                    className="h-10 rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-bold hover:bg-[#f8fafc]"
                  >
                    Шинэчлэх
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {historyStatus === "loading" ? (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-28 rounded-md border border-[#e5e7eb] bg-white"
                      />
                    ))}
                  </div>
                ) : historyMessage ? (
                  <div className="rounded-md border border-[#f59e0b] bg-[#fffbeb] px-3 py-2 text-sm font-bold text-[#92400e]">
                    {historyMessage}
                  </div>
                ) : historySales.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Өнөөдрийн борлуулалт / өр төлөлт алга.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                    {historySales.map((sale) => {
                      const balance = sale.balance ?? 0;
                      const isPartial = sale.paidStatus === "partial" || balance > 0;

                      return (
                        <button
                          key={sale.transactionId}
                          type="button"
                          onClick={() =>
                            setSelectedHistoryTransactionId(sale.transactionId)
                          }
                          className={`rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-[#2563eb] hover:shadow ${
                            selectedHistoryTransactionId === sale.transactionId
                              ? "border-[#111827] ring-2 ring-[#111827]"
                              : "border-[#d1d5db]"
                          }`}
                        >
                          <div className="mb-2 flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="break-words text-base font-black">
                                {sale.transactionId}
                              </p>
                              <p className="text-xs font-semibold text-[#6b7280]">
                                {sale.timestamp} · {sale.staff}
                              </p>
                            </div>
                            <span className="shrink-0 text-lg font-black text-[#047857]">
                              {formatMNT(sale.total)}
                            </span>
                          </div>
                          <p className="break-words text-sm font-semibold text-[#374151]">
                            {sale.itemSummary || sale.paymentMethod}
                          </p>
                          <p className="mt-2 text-xs font-bold text-[#6b7280]">
                            {sale.paymentMethod} ·{" "}
                            {isPartial ? "Хэсэгчилсэн" : "Төлсөн"}{" "}
                            {formatMNT(sale.paidAmount)}
                            {balance > 0 ? ` · Үлдэгдэл ${formatMNT(balance)}` : ""}
                            {sale.roomOrGuest ? ` · ${sale.roomOrGuest}` : ""}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="flex min-h-[420px] flex-col bg-white">
          {registerMode === "sale" ? (
            <>
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d1d5db] px-4">
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold">
                {isEditingCharge ? "Өрийн захиалга засах" : "Одоогийн борлуулалт"}
              </h2>
              {editingCharge && (
                <p className="truncate text-xs font-bold text-[#6b7280]">
                  {editingCharge.transactionId} · {editingCharge.roomOrGuest}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={clearCurrentSale}
              disabled={cart.length === 0 && !editingCharge}
              className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#374151] hover:bg-[#f8fafc] disabled:opacity-40"
            >
              {isEditingCharge ? "Болих" : "Цэвэрлэх"}
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6 text-center text-sm font-medium text-[#6b7280]">
                Бараа сонгоно уу
              </div>
            ) : (
              <div className="divide-y divide-[#e5e7eb]">
                {cart.map((line) => (
                  <div key={line.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="break-words text-sm font-bold">
                          {line.name}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-[#6b7280]">
                          {formatNumber(line.price)} x {line.quantity}
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold text-[#3730a3]">
                          {getPriceModeLabel(line.priceMode)}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-extrabold">
                        {formatNumber(line.price * line.quantity)}
                      </p>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <div className="grid grid-cols-[40px_48px_40px] rounded-md border border-[#cbd5e1]">
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(line.id, line.quantity - 1)
                          }
                          className="h-10 border-r border-[#cbd5e1] text-lg font-bold hover:bg-[#f8fafc]"
                          aria-label="Тоо хасах"
                        >
                          -
                        </button>
                        <span className="flex h-10 items-center justify-center text-sm font-extrabold">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateQuantity(line.id, line.quantity + 1)
                          }
                          className="h-10 border-l border-[#cbd5e1] text-lg font-bold hover:bg-[#f8fafc]"
                          aria-label="Тоо нэмэх"
                        >
                          +
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateQuantity(line.id, 0)}
                        className="h-10 rounded-md border border-[#fecaca] px-3 text-sm font-bold text-[#b91c1c] hover:bg-[#fef2f2]"
                      >
                        Хасах
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-[#d1d5db] p-3">
            <div className="mb-2 grid grid-cols-[minmax(0,1fr)_156px] items-center gap-2">
              <div className="min-w-0">
                <span className="text-xs font-semibold text-[#6b7280]">Нийт</span>
                <div className="truncate text-2xl font-black tracking-normal">
                  {formatMNT(cartTotal)}
                </div>
              </div>
              <button
                type="button"
                onClick={printCurrentBill}
                disabled={cart.length === 0}
                className="h-11 rounded-md border border-[#cbd5e1] bg-white px-2 text-[11px] font-extrabold leading-tight text-[#111827] hover:bg-[#f8fafc] disabled:opacity-40"
              >
                {PRINT_BILL_BUTTON_LABEL}
              </button>
            </div>

            <div className="mb-2 grid grid-cols-3 gap-1.5">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => selectPaymentMethod(method.id)}
                  disabled={isEditingCharge && method.id !== "room"}
                  className={`h-9 rounded-md border px-1 text-[11px] font-extrabold leading-tight ${
                    paymentMethod === method.id
                      ? "border-[#111827] bg-[#111827] text-white"
                      : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#f8fafc]"
                  } disabled:bg-[#f3f4f6] disabled:text-[#9ca3af]`}
                >
                  {method.label}
                </button>
              ))}
            </div>

            {cashRequired && (
              <div className="mb-2 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-2">
                <div className="mb-1.5 grid grid-cols-2 gap-2">
                  <label>
                    <span className="mb-0.5 block text-[11px] font-bold text-[#6b7280]">
                      Авсан мөнгө
                    </span>
                    <input
                      value={cashReceived ? formatNumber(cashReceived) : ""}
                      onChange={(event) => setCashInput(event.target.value)}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-right text-sm font-black outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </label>
                  <div>
                    <span className="mb-0.5 block text-[11px] font-bold text-[#6b7280]">
                      Хариулт
                    </span>
                    <div
                      className={`flex h-9 items-center justify-end rounded-md border px-2 text-sm font-black ${
                        cashShort > 0
                          ? "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]"
                          : "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]"
                      }`}
                    >
                      {cashShort > 0
                        ? `-${formatNumber(cashShort)}`
                        : formatNumber(changeDue)}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCashReceived(cartTotal)}
                    className="h-8 rounded-md border border-[#cbd5e1] bg-white text-[11px] font-extrabold hover:bg-[#eef2ff]"
                  >
                    Яг дүн
                  </button>
                  {CASH_DENOMINATIONS.map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() =>
                        setCashReceived((current) => current + amount)
                      }
                      className="h-8 rounded-md border border-[#cbd5e1] bg-white text-[11px] font-extrabold hover:bg-[#eef2ff]"
                    >
                      +{formatNumber(amount)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCashReceived(0)}
                    className="h-8 rounded-md border border-[#fecaca] bg-white text-[11px] font-extrabold text-[#b91c1c] hover:bg-[#fef2f2]"
                  >
                    Арилгах
                  </button>
                </div>
              </div>
            )}

            {cardRequired && (
              <div className="mb-2 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-[#6b7280]">
                      Терминалын дүн
                    </p>
                    <p className="text-lg font-black">
                      {formatMNT(cartTotal)}
                    </p>
                  </div>
                  <span
                    className={`rounded-sm px-2 py-1 text-[11px] font-black ${
                      cardTerminalApproved
                        ? "bg-[#ecfdf5] text-[#047857]"
                        : "bg-white text-[#6b7280]"
                    }`}
                  >
                    {cardTerminalApproved ? "Баталгаажсан" : "Хүлээгдэж байна"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCardTerminalApproved((current) => !current);
                    if (saleStatus === "error") {
                      setSaleStatus("idle");
                      setSaleMessage("");
                    }
                  }}
                  className={`h-9 w-full rounded-md border text-xs font-extrabold ${
                    cardTerminalApproved
                      ? "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]"
                      : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                  }`}
                >
                  Терминал дээр төлөгдсөн
                </button>
              </div>
            )}

            {roomRequired && (
              <div className="mb-2 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-2">
                <span className="mb-1 block text-[11px] font-bold text-[#6b7280]">
                  Байшингийн дугаар
                </span>
                <div className="mb-2 grid grid-cols-6 gap-1.5">
                  {ROOM_NUMBERS.map((number) => (
                    <button
                      key={number}
                      type="button"
                      onClick={() => setChargeReference(number)}
                      className={`h-8 rounded-md border text-xs font-extrabold ${
                        roomNumber === number
                          ? "border-[#111827] bg-[#111827] text-white"
                          : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                      }`}
                    >
                      {number}
                    </button>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-0.5 block text-[11px] font-bold text-[#6b7280]">
                    Эсвэл нэр / утас / тайлбар
                  </span>
                  <input
                    value={roomNumber}
                    onChange={(event) =>
                      setChargeReference(event.target.value)
                    }
                    type="text"
                    inputMode="text"
                    placeholder="ж: Энхээ 99112233, lunch guest"
                    className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm font-bold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                  />
                </label>
              </div>
            )}

            {bankTransferRequired && (
              <div className="mb-2 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-2">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold text-[#6b7280]">
                      Дансны дүн
                    </p>
                    <p className="text-lg font-black">
                      {formatMNT(cartTotal)}
                    </p>
                  </div>
                  <span
                    className={`rounded-sm px-2 py-1 text-[11px] font-black ${
                      bankTransferConfirmed
                        ? "bg-[#ecfdf5] text-[#047857]"
                        : "bg-white text-[#6b7280]"
                    }`}
                  >
                    {bankTransferConfirmed ? "Баталгаажсан" : "Мобайл банк шалгана"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setBankTransferStatus((current) =>
                      current === "paid" ? "idle" : "paid",
                    );
                    if (saleStatus === "error") {
                      setSaleStatus("idle");
                      setSaleMessage("");
                    }
                  }}
                  className={`h-9 w-full rounded-md border text-xs font-extrabold ${
                    bankTransferConfirmed
                      ? "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]"
                      : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                  }`}
                >
                  Мобайл банкаар орсон
                </button>
              </div>
            )}

            {partialRequired && (
              <div className="mb-2 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-2">
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-[#d1d5db] bg-white px-2 py-1.5">
                    <p className="text-[11px] font-bold text-[#6b7280]">
                      Нэмсэн төлбөр
                    </p>
                    <p className="text-sm font-black text-[#047857]">
                      {formatMNT(partialPaymentLineTotal)}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#d1d5db] bg-white px-2 py-1.5">
                    <p className="text-[11px] font-bold text-[#6b7280]">
                      Үлдэгдэл
                    </p>
                    <p
                      className={`text-sm font-black ${
                        partialRemaining === 0
                          ? "text-[#047857]"
                          : "text-[#b91c1c]"
                      }`}
                    >
                      {formatMNT(partialRemaining)}
                    </p>
                  </div>
                </div>

                {partialPaymentLines.length > 0 && (
                  <div className="mb-2 overflow-hidden rounded-md border border-[#d1d5db] bg-white">
                    {partialPaymentLines.map((line) => (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-2 border-b border-[#e5e7eb] px-2 py-1.5 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-black">
                            {line.methodLabel}
                          </p>
                          <p className="text-[11px] font-bold text-[#6b7280]">
                            {formatMNT(line.amount)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePartialPaymentLine(line.id)}
                          className="h-7 w-7 rounded-md border border-[#fecaca] text-xs font-black text-[#b91c1c] hover:bg-[#fef2f2]"
                          aria-label="Төлбөрийн мөр устгах"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  {SETTLEMENT_METHODS.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      onClick={() => selectPartialPaymentMethod(method.id)}
                      className={`h-8 rounded-md border text-[11px] font-extrabold ${
                        !partialBalanceOptionSelected &&
                        partialPaymentMethod === method.id
                          ? "border-[#111827] bg-[#111827] text-white"
                          : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                      }`}
                    >
                      {method.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={selectPartialBalanceOption}
                  disabled={
                    partialPaymentLines.length === 0 ||
                    partialPaymentAmount > 0 ||
                    partialRemaining === 0
                  }
                  className={`mb-2 h-8 w-full rounded-md border text-[11px] font-extrabold ${
                    partialBalanceOptionSelected
                      ? "border-[#111827] bg-[#111827] text-white"
                      : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                  } disabled:border-[#d1d5db] disabled:bg-[#e5e7eb] disabled:text-[#6b7280]`}
                >
                  Үлдэгдэл бичих
                </button>

                {partialRemaining === 0 && (
                  <div className="mb-2 rounded-md border border-[#bbf7d0] bg-[#ecfdf5] px-2 py-2 text-xs font-black text-[#047857]">
                    Бүх төлбөр нэмэгдсэн. Төлбөр хаах товчийг дарна уу.
                  </div>
                )}

                {!partialBalanceOptionSelected && partialRemaining > 0 && (
                  <div className="mb-2 rounded-md border border-[#d1d5db] bg-white p-2">
                    <label className="mb-2 block">
                      <span className="mb-0.5 block text-[11px] font-bold text-[#6b7280]">
                        Төлсөн дүн
                      </span>
                      <input
                        value={
                          partialPaymentAmount
                            ? formatNumber(partialPaymentAmount)
                            : ""
                        }
                        onChange={(event) =>
                          setPartialPaymentAmountInput(event.target.value)
                        }
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-right text-base font-black outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={addPartialPaymentLine}
                      disabled={!canAddPartialPaymentLine}
                      className="h-10 w-full rounded-md bg-[#111827] text-xs font-black text-white hover:bg-[#374151] disabled:bg-[#9ca3af]"
                    >
                      Мөр нэмэх
                    </button>
                  </div>
                )}

                {partialBalanceOptionSelected && partialRemaining > 0 && (
                  <div>
                  <div className="mb-2 rounded-md border border-[#fecaca] bg-[#fef2f2] px-2 py-2">
                    <p className="text-[11px] font-bold text-[#6b7280]">
                      Үлдэгдэл
                    </p>
                    <p className="text-base font-black text-[#b91c1c]">
                      {formatMNT(partialRemaining)}
                    </p>
                  </div>
                  <div className="mb-2 grid grid-cols-6 gap-1.5">
                    {ROOM_NUMBERS.map((number) => (
                      <button
                        key={number}
                        type="button"
                        onClick={() => setChargeReference(number)}
                        className={`h-8 rounded-md border text-xs font-extrabold ${
                          roomNumber === number
                            ? "border-[#111827] bg-[#111827] text-white"
                            : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#eef2ff]"
                        }`}
                      >
                        {number}
                      </button>
                    ))}
                  </div>
                  <input
                    value={roomNumber}
                    onChange={(event) => setChargeReference(event.target.value)}
                    type="text"
                    inputMode="text"
                    placeholder="ж: Энхээ 99112233, lunch guest"
                      className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white px-2 text-sm font-bold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </div>
                )}
              </div>
            )}

            {saleMessage && (
              <div
                className={`mb-2 rounded-md px-2 py-1.5 text-xs font-bold ${
                  saleStatus === "error"
                    ? "bg-[#fef2f2] text-[#b91c1c]"
                    : "bg-[#ecfdf5] text-[#047857]"
                }`}
              >
                {saleMessage}
              </div>
            )}

            {lastSale && (
              <div className="mb-2 grid gap-2">
                <button
                  type="button"
                  onClick={() => printBill(lastSale)}
                  className="h-10 w-full rounded-md border border-[#cbd5e1] bg-white text-xs font-extrabold leading-tight hover:bg-[#f8fafc]"
                >
                  {PRINT_BILL_BUTTON_LABEL}
                </button>
                {lastSale.isPaid && (
                  <button
                    type="button"
                    onClick={() => printReceipt(lastSale)}
                    className="h-9 w-full rounded-md border border-[#cbd5e1] bg-white text-xs font-extrabold hover:bg-[#f8fafc]"
                  >
                    Баримт дахин хэвлэх
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              data-testid="complete-sale"
              onClick={completeSale}
              disabled={!canCompleteSale}
              className="h-12 w-full rounded-md bg-[#047857] text-sm font-black text-white hover:bg-[#065f46] disabled:bg-[#9ca3af]"
            >
              {completeSaleLabel}
            </button>
          </div>
            </>
          ) : registerMode === "charges" ? (
            <>
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d1d5db] px-4">
                <h2 className="text-base font-bold">Өр хаах</h2>
                <button
                  type="button"
                  onClick={() => void loadUnpaidCharges()}
                  className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#374151] hover:bg-[#f8fafc]"
                >
                  Шинэчлэх
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!selectedChargeGroup ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Хаах өр сонгоно уу.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md border border-[#d1d5db] bg-[#f8fafc] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-lg font-black">
                            {selectedChargeGroup.label}
                          </p>
                          <p className="mt-1 break-words text-xs font-bold text-[#6b7280]">
                            {selectedChargeGroup.charges.length} төлбөрөөс{" "}
                            {selectedCharges.length} сонгосон
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => startAdditionalCharge(selectedChargeGroup)}
                          className="shrink-0 rounded-md border border-[#047857] bg-white px-3 py-2 text-xs font-black text-[#047857] hover:bg-[#ecfdf5]"
                        >
                          Дээр нь нэмэх
                        </button>
                      </div>
                    </div>

                    <div className="rounded-md border border-[#d1d5db] bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-[#6b7280]">
                          Сонгох төлбөрүүд
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedChargeIds(
                              selectedChargeGroup.charges.map(
                                (charge) => charge.transactionId,
                              ),
                            );
                            resetSettlementPaymentState();
                          }}
                          className="rounded-md border border-[#cbd5e1] px-2 py-1 text-xs font-black hover:bg-[#f8fafc]"
                        >
                          Бүгд
                        </button>
                      </div>
                      <div className="space-y-2">
                        {selectedChargeGroup.charges.map((charge) => {
                          const checked = selectedChargeIds.includes(
                            charge.transactionId,
                          );

                          return (
                            <div
                              key={charge.transactionId}
                              className={`rounded-md border p-2 ${
                                checked
                                  ? "border-[#111827] bg-[#f8fafc]"
                                  : "border-[#e5e7eb] bg-white"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    toggleSelectedCharge(charge.transactionId)
                                  }
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <p className="break-words text-sm font-black">
                                    <span
                                      className={`mr-1 rounded-sm px-1.5 py-0.5 text-[10px] ${
                                        checked
                                          ? "bg-[#111827] text-white"
                                          : "bg-[#e5e7eb] text-[#374151]"
                                      }`}
                                    >
                                      {checked ? "Сонгосон" : "Сонгох"}
                                    </span>
                                    {charge.itemSummary ||
                                      `${charge.itemCount} бараа`}
                                  </p>
                                  <p className="mt-0.5 text-xs font-bold text-[#6b7280]">
                                    {charge.transactionId} · {charge.timestamp}
                                  </p>
                                </button>
                                <div className="flex shrink-0 flex-col items-end gap-2">
                                  <span className="text-sm font-black">
                                    {formatMNT(charge.total)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => void startEditingCharge(charge)}
                                    className="h-8 rounded-md border border-[#bfdbfe] bg-white px-2 text-xs font-black text-[#1d4ed8] hover:bg-[#eff6ff]"
                                  >
                                    Засах
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteCharge(charge)}
                                    disabled={
                                      deletingChargeId === charge.transactionId ||
                                      charge.paidAmount > 0 ||
                                      settlementStatus === "saving"
                                    }
                                    className="h-8 rounded-md border border-[#fecaca] bg-white px-2 text-xs font-black text-[#b91c1c] hover:bg-[#fef2f2] disabled:border-[#e5e7eb] disabled:text-[#9ca3af]"
                                  >
                                    {deletingChargeId === charge.transactionId
                                      ? "Устгаж..."
                                      : "Устгах"}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="rounded-md border border-[#d1d5db] bg-white p-3">
                      <div className="flex items-end justify-between gap-3">
                        <span className="text-sm font-semibold text-[#6b7280]">
                          Сонгосон төлөх дүн
                        </span>
                        <span className="text-3xl font-black tracking-normal">
                          {formatMNT(selectedChargeTotal)}
                        </span>
                      </div>
                      {selectedChargePaidAmount > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                          <div>
                            <p className="text-xs font-bold text-[#6b7280]">
                              Анхны дүн
                            </p>
                            <p className="font-black">
                              {formatMNT(selectedChargeOriginalTotal)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-[#6b7280]">
                              Өмнө төлсөн
                            </p>
                            <p className="font-black text-[#047857]">
                              {formatMNT(selectedChargePaidAmount)}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-[#d1d5db] p-4">
                {selectedCharges.length > 0 && (
                  <>
                    <div className="mb-3 grid grid-cols-3 gap-2">
                      <div className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2">
                        <p className="text-[11px] font-bold text-[#6b7280]">
                          Нийт
                        </p>
                        <p className="truncate text-sm font-black">
                          {formatMNT(selectedChargeTotal)}
                        </p>
                      </div>
                      <div className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2">
                        <p className="text-[11px] font-bold text-[#6b7280]">
                          Нэмсэн
                        </p>
                        <p className="truncate text-sm font-black text-[#047857]">
                          {formatMNT(settlementLineTotal)}
                        </p>
                      </div>
                      <div className="rounded-md border border-[#e5e7eb] bg-white px-3 py-2">
                        <p className="text-[11px] font-bold text-[#6b7280]">
                          Үлдэгдэл
                        </p>
                        <p className="truncate text-sm font-black text-[#b91c1c]">
                          {formatMNT(settlementRemaining)}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void printSelectedChargeBill()}
                      disabled={settlementStatus === "saving"}
                      className="mb-3 h-11 w-full rounded-md border border-[#cbd5e1] bg-white text-sm font-black leading-tight text-[#111827] hover:bg-[#f8fafc] disabled:opacity-40"
                    >
                      {PRINT_BILL_BUTTON_LABEL}
                    </button>

                    {settlementLines.length > 0 && (
                      <div className="mb-3 rounded-md border border-[#d1d5db] bg-white">
                        <div className="border-b border-[#e5e7eb] px-3 py-2 text-xs font-black text-[#6b7280]">
                          Нэмсэн төлбөрүүд
                        </div>
                        <div className="divide-y divide-[#e5e7eb]">
                          {settlementLines.map((line) => (
                            <div
                              key={line.id}
                              className="flex items-center justify-between gap-2 px-3 py-2"
                            >
                              <div>
                                <p className="text-sm font-black">
                                  {line.methodLabel}
                                </p>
                                {line.qpayInvoiceId && (
                                  <p className="text-xs font-bold text-[#6b7280]">
                                    {line.qpayInvoiceId}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-black">
                                  {formatMNT(line.amount)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeSettlementLine(line.id)}
                                  className="h-8 rounded-md border border-[#fecaca] px-2 text-xs font-black text-[#b91c1c] hover:bg-[#fef2f2]"
                                >
                                  Хасах
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center justify-between border-t border-[#e5e7eb] px-3 py-2 text-sm">
                          <span className="font-bold text-[#6b7280]">
                            Үлдэх
                          </span>
                          <span className="font-black">
                            {formatMNT(settlementRemaining)}
                          </span>
                        </div>
                      </div>
                    )}

                    {settlementRemaining > 0 && (
                      <div className="mb-3 grid grid-cols-3 gap-2">
                        {SETTLEMENT_METHODS.map((method) => (
                          <button
                            key={method.id}
                            type="button"
                            onClick={() => selectSettlementMethod(method.id)}
                            className={`h-11 rounded-md border text-sm font-extrabold ${
                              settlementMethod === method.id
                                ? "border-[#111827] bg-[#111827] text-white"
                                : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#f8fafc]"
                            }`}
                          >
                            {method.label}
                          </button>
                        ))}
                      </div>
                    )}

                    {settlementRemaining > 0 && (
                      <div className="mb-3 rounded-md border border-[#d1d5db] bg-white p-3">
                        {settlementLines.length > 0 && (
                          <div className="mb-3 rounded-md border border-[#fecaca] bg-[#fef2f2] px-3 py-2">
                            <p className="text-xs font-bold text-[#6b7280]">
                              Үлдэгдэл
                            </p>
                            <p className="text-lg font-black text-[#b91c1c]">
                              {formatMNT(settlementRemaining)}
                            </p>
                          </div>
                        )}

                        <label className="mb-3 block">
                          <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                            Төлсөн дүн
                          </span>
                          <input
                            value={
                              settlementPaymentAmount
                                ? formatNumber(settlementPaymentAmount)
                                : ""
                            }
                            onChange={(event) =>
                              setSettlementAmountInput(event.target.value)
                            }
                            type="text"
                            inputMode="numeric"
                            placeholder="0"
                            className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-right text-base font-black outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                          />
                        </label>

                        {settlementDraftOverRemaining && (
                          <div className="mb-3 rounded-md bg-[#fef2f2] px-3 py-2 text-sm font-bold text-[#b91c1c]">
                            Төлөх мөр үлдэгдлээс их байна
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={addSettlementLine}
                          disabled={!canAddSettlementLine}
                          className="h-11 w-full rounded-md bg-[#111827] text-sm font-black text-white hover:bg-[#374151] disabled:bg-[#9ca3af]"
                        >
                          Мөр нэмэх
                        </button>
                      </div>
                    )}

                    {settlementRemaining === 0 && (
                      <div className="mb-3 rounded-md border border-[#bbf7d0] bg-[#ecfdf5] px-3 py-2 text-sm font-black text-[#047857]">
                        Бүх төлбөр нэмэгдсэн. Төлбөр хаах товчийг дарна уу.
                      </div>
                    )}

                    {settlementMessage && (
                      <div
                        className={`mb-3 rounded-md px-3 py-2 text-sm font-bold ${
                          settlementStatus === "error"
                            ? "bg-[#fef2f2] text-[#b91c1c]"
                            : "bg-[#ecfdf5] text-[#047857]"
                        }`}
                      >
                        {settlementMessage}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={settleSelectedCharge}
                      disabled={!canSettleCharge}
                      className="h-14 w-full rounded-md bg-[#047857] text-base font-black text-white hover:bg-[#065f46] disabled:bg-[#9ca3af]"
                    >
                      {settlementSubmitLabel}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d1d5db] px-4">
                <h2 className="text-base font-bold">Түүх дэлгэрэнгүй</h2>
                <button
                  type="button"
                  onClick={() => void loadSalesHistory()}
                  className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#374151] hover:bg-[#f8fafc]"
                >
                  Шинэчлэх
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {!selectedHistorySale ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Төлөгдсөн борлуулалт сонгоно уу.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-md border border-[#d1d5db] bg-[#f8fafc] p-3">
                      <p className="break-words text-lg font-black">
                        {selectedHistorySale.transactionId}
                      </p>
                      <p className="mt-1 break-words text-xs font-bold text-[#6b7280]">
                        {selectedHistorySale.timestamp} ·{" "}
                        {selectedHistorySale.staff || "Staff"}
                      </p>
                    </div>

                    <div className="rounded-md border border-[#d1d5db] bg-white p-3">
                      <div className="flex items-end justify-between gap-3">
                        <span className="text-sm font-semibold text-[#6b7280]">
                          {selectedHistoryPaymentTitle}
                        </span>
                        <span className="text-3xl font-black tracking-normal">
                          {formatMNT(selectedHistorySale.paidAmount)}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs font-bold text-[#6b7280]">
                            Борлуулалтын дүн
                          </p>
                          <p className="font-black">
                            {formatMNT(selectedHistorySaleTotal)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-[#6b7280]">
                            Нийт төлсөн
                          </p>
                          <p className="font-black">
                            {formatMNT(selectedHistoryPaidToDate)}
                          </p>
                        </div>
                        {selectedHistoryBalance > 0 && (
                          <div>
                            <p className="text-xs font-bold text-[#6b7280]">
                              Үлдэгдэл
                            </p>
                            <p className="font-black text-[#b45309]">
                              {formatMNT(selectedHistoryBalance)}
                            </p>
                          </div>
                        )}
                        <div>
                          <p className="text-xs font-bold text-[#6b7280]">
                            Бараа
                          </p>
                          <p className="font-black">
                            {selectedHistorySale.itemCount ?? 1}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-[#d1d5db] bg-white p-3">
                      <p className="text-xs font-bold text-[#6b7280]">
                        Төлбөрийн хэлбэр
                      </p>
                      <p className="mt-1 break-words text-sm font-black">
                        {selectedHistorySale.paymentMethod || "Төлсөн"}
                      </p>
                      {selectedHistorySale.qpayInvoiceId && (
                        <p className="mt-2 break-words text-xs font-bold text-[#6b7280]">
                          Лавлагаа: {selectedHistorySale.qpayInvoiceId}
                        </p>
                      )}
                      {selectedHistorySale.roomOrGuest && (
                        <p className="mt-2 break-words text-xs font-bold text-[#6b7280]">
                          Байшин / зочин: {selectedHistorySale.roomOrGuest}
                        </p>
                      )}
                    </div>

                    <div className="rounded-md border border-[#d1d5db] bg-white p-3">
                      <p className="text-xs font-bold text-[#6b7280]">
                        Борлуулалт
                      </p>
                      <p className="mt-1 break-words text-sm font-black">
                        {selectedHistorySale.itemSummary ||
                          selectedHistorySale.transactionId}
                      </p>
                      {selectedHistorySale.notes && (
                        <p className="mt-2 break-words text-xs font-bold text-[#6b7280]">
                          {selectedHistorySale.notes}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="shrink-0 border-t border-[#d1d5db] p-4">
                <button
                  type="button"
                  onClick={() => {
                    if (selectedHistorySale) {
                      printReceipt(buildHistoryReceiptSale(selectedHistorySale));
                    }
                  }}
                  disabled={!selectedHistorySale}
                  className="h-14 w-full rounded-md bg-[#047857] text-base font-black text-white hover:bg-[#065f46] disabled:bg-[#9ca3af]"
                >
                  Баримт дахин хэвлэх
                </button>
              </div>
            </>
          )}
        </aside>
      </main>

      {voidModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="flex max-h-[88dvh] w-full max-w-[760px] flex-col rounded-md border border-[#cbd5e1] bg-white shadow-xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#e5e7eb] px-4">
              <h3 className="text-sm font-black">Буцаалт / хүчингүй</h3>
              <button
                type="button"
                onClick={() => setVoidModalOpen(false)}
                className="h-8 w-8 rounded-md border border-[#cbd5e1] text-lg font-bold hover:bg-[#f8fafc]"
                aria-label="Буцаалтын цонх хаах"
              >
                x
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-h-0 overflow-y-auto border-b border-[#e5e7eb] p-3 md:border-b-0 md:border-r">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-xs font-bold text-[#6b7280]">
                    Өнөөдрийн борлуулалт
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadVoidableSales()}
                    className="h-9 rounded-md border border-[#cbd5e1] bg-white px-3 text-xs font-black hover:bg-[#f8fafc]"
                  >
                    Шинэчлэх
                  </button>
                </div>

                {voidStatus === "loading" ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-24 rounded-md border border-[#e5e7eb] bg-[#f8fafc]"
                      />
                    ))}
                  </div>
                ) : recentSales.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Буцаах боломжтой борлуулалт алга.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {recentSales.map((sale) => (
                      <button
                        key={sale.transactionId}
                        type="button"
                        onClick={() => setSelectedVoidTransactionId(sale.transactionId)}
                        className={`w-full rounded-md border p-3 text-left hover:border-[#2563eb] ${
                          selectedVoidTransactionId === sale.transactionId
                            ? "border-[#111827] ring-2 ring-[#111827]"
                            : "border-[#d1d5db]"
                        }`}
                      >
                        <div className="mb-1 flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black">
                              {sale.transactionId}
                            </p>
                            <p className="text-xs font-semibold text-[#6b7280]">
                              {sale.timestamp} · {sale.staff}
                            </p>
                          </div>
                          <span className="shrink-0 text-base font-black">
                            {formatMNT(sale.total)}
                          </span>
                        </div>
                        <p className="break-words text-sm font-semibold text-[#374151]">
                          {sale.itemSummary || sale.paymentMethod}
                        </p>
                        <p className="mt-2 text-xs font-bold text-[#6b7280]">
                          {sale.paymentMethod} · {sale.paidStatus}
                          {sale.roomOrGuest ? ` · ${sale.roomOrGuest}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="shrink-0 p-4">
                {selectedVoidSale ? (
                  <>
                    <div className="mb-3 rounded-md border border-[#e5e7eb] bg-[#f8fafc] p-3">
                      <p className="text-xs font-bold text-[#6b7280]">
                        Сонгосон
                      </p>
                      <p className="text-base font-black">
                        {selectedVoidSale.transactionId}
                      </p>
                      <p className="mt-1 break-words text-sm font-semibold">
                        {selectedVoidSale.itemSummary || selectedVoidSale.paymentMethod}
                      </p>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="font-bold text-[#6b7280]">Буцаах дүн</span>
                        <span className="font-black">
                          {formatMNT(selectedVoidSale.refundableAmount)}
                        </span>
                      </div>
                    </div>

                    {selectedVoidSale.refundableAmount > 0 && (
                      <div className="mb-3">
                        <p className="mb-2 text-xs font-bold text-[#6b7280]">
                          Буцаах хэлбэр
                        </p>
                        <div className="grid grid-cols-3 gap-2">
                          {["Бэлэн", "Карт", "Данс"].map((method) => (
                            <button
                              key={method}
                              type="button"
                              onClick={() => setVoidRefundMethod(method)}
                              className={`h-10 rounded-md border text-sm font-black ${
                                voidRefundMethod === method
                                  ? "border-[#111827] bg-[#111827] text-white"
                                  : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#f8fafc]"
                              }`}
                            >
                              {method}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="mb-3 block">
                      <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                        Шалтгаан
                      </span>
                      <input
                        value={voidReason}
                        onChange={(event) => setVoidReason(event.target.value)}
                        type="text"
                        placeholder="ж: буруу бараа, давхар бичсэн"
                        className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-bold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                      />
                    </label>

                    {voidMessage && (
                      <div
                        className={`mb-3 rounded-md px-3 py-2 text-sm font-bold ${
                          voidStatus === "error"
                            ? "bg-[#fef2f2] text-[#b91c1c]"
                            : "bg-[#ecfdf5] text-[#047857]"
                        }`}
                      >
                        {voidMessage}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={submitVoidSale}
                      disabled={!canSubmitVoid}
                      className="h-12 w-full rounded-md bg-[#b91c1c] text-base font-black text-white hover:bg-[#991b1b] disabled:bg-[#9ca3af]"
                    >
                      {voidStatus === "saving"
                        ? "Хадгалж байна"
                        : "Буцаалт хадгалах"}
                    </button>
                  </>
                ) : (
                  <div className="flex min-h-48 items-center justify-center px-6 text-center text-sm font-semibold text-[#6b7280]">
                    Борлуулалт сонгоно уу.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {dayModalMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-[560px] rounded-md border border-[#cbd5e1] bg-white shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-[#e5e7eb] px-4">
              <h3 className="text-sm font-black">
                {dayModalMode === "open" ? "Өдөр нээх" : "Өдрийн хаалт"}
              </h3>
              <button
                type="button"
                onClick={() => setDayModalMode(null)}
                className="h-8 w-8 rounded-md border border-[#cbd5e1] text-lg font-bold hover:bg-[#f8fafc]"
                aria-label="Өдрийн цонх хаах"
              >
                x
              </button>
            </div>

            <div className="p-4">
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2">
                  <p className="text-xs font-bold text-[#6b7280]">Огноо</p>
                  <p className="text-base font-black">{businessDate}</p>
                </div>
                <div className="rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2">
                  <p className="text-xs font-bold text-[#6b7280]">Ажилтан</p>
                  <p className="text-base font-black">{staffName}</p>
                </div>
              </div>

              {dayModalMode === "close" && (
                <div className="mb-3 grid gap-3">
                  <div className="overflow-hidden rounded-md border border-[#cbd5e1]">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-[#f8fafc]">
                        <tr>
                          <th className="w-12 border-b border-r border-[#cbd5e1] px-2 py-2 text-left text-xs font-black text-[#6b7280]">
                            #
                          </th>
                          <th className="border-b border-r border-[#cbd5e1] px-2 py-2 text-left text-xs font-black text-[#6b7280]">
                            Үзүүлэлт
                          </th>
                          <th className="border-b border-[#cbd5e1] px-2 py-2 text-right text-xs font-black text-[#6b7280]">
                            Дүн
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          ["1", "Нийт борлуулалт", dayTotals.salesTotal],
                          ["2", "Бэлэн төлбөр", dayTotals.cashPaymentTotal],
                          ["3", "Карт / Данс", dayNonCashPaymentTotal],
                          ["4", "Байшин/зочинд бичсэн", dayTotals.roomChargeTotal],
                          ["5", "Эхлэх бэлэн мөнгө", daySession?.startingCash ?? 0],
                          ["6", "Бэлнээр байх ёстой", dayTotals.expectedCash],
                          ["7", "Тоолсон бэлэн мөнгө", dayCashAmount],
                        ].map(([number, label, amount]) => (
                          <tr key={number}>
                            <td className="border-b border-r border-[#e5e7eb] px-2 py-2 font-bold text-[#6b7280]">
                              {number}
                            </td>
                            <td className="border-b border-r border-[#e5e7eb] px-2 py-2 font-bold">
                              {label}
                            </td>
                            <td className="border-b border-[#e5e7eb] px-2 py-2 text-right font-black">
                              {formatMNT(Number(amount))}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-[#f8fafc]">
                          <td className="border-r border-[#cbd5e1] px-2 py-2 font-black text-[#6b7280]">
                            8
                          </td>
                          <td className="border-r border-[#cbd5e1] px-2 py-2 font-black">
                            Зөрүү
                          </td>
                          <td
                            className={`px-2 py-2 text-right font-black ${
                              dayCashDifference === 0
                                ? "text-[#047857]"
                                : dayCashDifference < 0
                                  ? "text-[#b91c1c]"
                                  : "text-[#c2410c]"
                            }`}
                          >
                            {formatMNT(dayCashDifference)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="overflow-hidden rounded-md border border-[#cbd5e1]">
                    <div className="border-b border-[#cbd5e1] bg-[#f8fafc] px-2 py-2 text-xs font-black text-[#6b7280]">
                      Бараагаар зарагдсан тоо
                    </div>
                    <div className="max-h-44 overflow-y-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-white">
                          <tr>
                            <th className="w-12 border-b border-r border-[#e5e7eb] px-2 py-2 text-left text-xs font-black text-[#6b7280]">
                              #
                            </th>
                            <th className="border-b border-r border-[#e5e7eb] px-2 py-2 text-left text-xs font-black text-[#6b7280]">
                              Бараа
                            </th>
                            <th className="w-20 border-b border-[#e5e7eb] px-2 py-2 text-right text-xs font-black text-[#6b7280]">
                              Тоо
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dayItemTotals.length > 0 ? (
                            dayItemTotals.map((item, index) => (
                              <tr key={item.name}>
                                <td className="border-b border-r border-[#e5e7eb] px-2 py-2 font-bold text-[#6b7280]">
                                  {index + 1}
                                </td>
                                <td className="border-b border-r border-[#e5e7eb] px-2 py-2 font-bold">
                                  {item.name}
                                </td>
                                <td className="border-b border-[#e5e7eb] px-2 py-2 text-right font-black">
                                  {formatNumber(item.quantity)}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={3}
                                className="px-2 py-3 text-center text-xs font-bold text-[#6b7280]"
                              >
                                Одоогоор зарагдсан бараа алга.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                  {dayModalMode === "open"
                    ? "Эхлэх бэлэн мөнгө"
                    : "Тоолсон бэлэн мөнгө"}
                </span>
                <input
                  value={dayCashAmount ? formatNumber(dayCashAmount) : ""}
                  onChange={(event) => setDayCashInput(event.target.value)}
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  className="h-12 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-right text-xl font-black outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                />
              </label>

              <div className="mb-3 grid grid-cols-3 gap-2">
                {CASH_DENOMINATIONS.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setDayCashAmount((current) => current + amount)}
                    className="h-10 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#eef2ff]"
                  >
                    +{formatNumber(amount)}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDayCashAmount(0)}
                  className="h-10 rounded-md border border-[#fecaca] bg-white text-sm font-extrabold text-[#b91c1c] hover:bg-[#fef2f2]"
                >
                  Арилгах
                </button>
              </div>

              <label className="mb-3 block">
                <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                  Тайлбар {dayCloseHasVariance ? "(заавал)" : ""}
                </span>
                <input
                  value={dayNotes}
                  onChange={(event) => setDayNotes(event.target.value)}
                  type="text"
                  placeholder={
                    dayModalMode === "open"
                      ? "ж: Өглөөний касс"
                      : "ж: Мөнгө дутсан / илүү гарсан шалтгаан"
                  }
                  className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-sm font-bold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                />
              </label>

              {dayMessage && (
                <div
                  className={`mb-3 rounded-md px-3 py-2 text-sm font-bold ${
                    dayStatus === "error"
                      ? "bg-[#fef2f2] text-[#b91c1c]"
                      : "bg-[#ecfdf5] text-[#047857]"
                  }`}
                >
                  {dayMessage}
                </div>
              )}

              <button
                type="button"
                onClick={submitDaySession}
                disabled={!canSubmitDaySession}
                className={`h-12 w-full rounded-md text-base font-black text-white disabled:bg-[#9ca3af] ${
                  dayModalMode === "open"
                    ? "bg-[#047857] hover:bg-[#065f46]"
                    : "bg-[#b91c1c] hover:bg-[#991b1b]"
                }`}
              >
                {dayStatus === "saving"
                  ? "Хадгалж байна"
                  : dayModalMode === "open"
                    ? "Өдөр нээх"
                    : "Хаалт хадгалах"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

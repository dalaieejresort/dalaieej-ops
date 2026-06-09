"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FALLBACK_CATALOG, STAFF } from "@/lib/pos/data";
import type { CartLine, CatalogItem, ItemCategory } from "@/lib/pos/types";
import { formatMNT, formatNumber } from "@/lib/pos/utils";

type CatalogResponseItem = {
  sku: string;
  name: string;
  price: number;
  stock?: number;
};

type CatalogStatus = "loading" | "ready" | "sample";
type SaleStatus = "idle" | "saving" | "success" | "error";
type RegisterCartLine = CartLine & { category: ItemCategory };
type QPayStatus = "idle" | "creating" | "pending" | "checking" | "paid" | "error";

type QPayInvoice = {
  invoiceId: string;
  qrCode: string;
  qrText: string;
  shortUrl: string;
};

type PrintableSale = {
  id: string;
  createdAt: Date;
  items: RegisterCartLine[];
  total: number;
  paymentLabel: string;
  staffName: string;
  roomNumber: string;
  cashReceived: number;
  changeDue: number;
  qpayInvoiceId: string;
};

const CATEGORY_LABELS: Record<ItemCategory | "all", string> = {
  all: "Бүгд",
  food: "Хоол",
  beer: "Бар",
  soft: "Ундаа",
  cocktail: "Коктейль",
  dessert: "Амттан",
  gift: "Карт",
  menu: "Меню",
};

const CATEGORY_ACCENTS: Record<ItemCategory | "all", string> = {
  all: "#111827",
  food: "#2f6f73",
  beer: "#8a5a12",
  soft: "#2563eb",
  cocktail: "#7c3aed",
  dessert: "#be4b75",
  gift: "#047857",
  menu: "#374151",
};

const PAYMENT_METHODS = [
  { id: "cash", label: "Бэлэн" },
  { id: "card", label: "Карт" },
  { id: "qpay", label: "QPay" },
  { id: "room", label: "Өрөө/Зочин" },
] as const;

type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

const CASH_DENOMINATIONS = [500, 1000, 5000, 10000, 20000, 50000];
const KITCHEN_CATEGORIES = new Set<ItemCategory>(["food", "dessert"]);
const ROOM_NUMBERS = Array.from({ length: 18 }, (_, index) =>
  String(index + 1),
);

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

  if (normalized.includes("амттан") || normalized.includes("dessert")) {
    return "dessert";
  }

  return "food";
}

function normalizeCatalogRow(row: CatalogResponseItem): CatalogItem {
  return {
    id: row.sku,
    sku: row.sku,
    name: row.name,
    price: row.price,
    stock: row.stock,
    category: inferCategory(row.name),
  };
}

function getDisplayProducts(catalog: CatalogItem[]) {
  const source = catalog.length > 0 ? catalog : FALLBACK_CATALOG;
  return source.filter((item) => !item.isCategory && item.price > 0);
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
      @page { size: 80mm auto; margin: 4mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: Arial, sans-serif; font-size: 12px; }
      h1 { margin: 0 0 6px; text-align: center; font-size: 18px; letter-spacing: 0; }
      h2 { margin: 0 0 8px; text-align: center; font-size: 13px; font-weight: 700; }
      .meta { display: grid; gap: 2px; margin: 8px 0; border-top: 1px dashed #111; border-bottom: 1px dashed #111; padding: 6px 0; }
      .row { display: flex; justify-content: space-between; gap: 8px; }
      .items { margin-top: 8px; }
      .item { border-bottom: 1px solid #ddd; padding: 6px 0; }
      .item-main { display: grid; grid-template-columns: 36px 1fr auto; gap: 6px; align-items: baseline; }
      .qty { font-size: 18px; font-weight: 900; }
      .name { font-size: 14px; font-weight: 800; overflow-wrap: anywhere; }
      .price { font-weight: 700; text-align: right; }
      .total { margin-top: 10px; border-top: 2px solid #111; padding-top: 8px; font-size: 16px; font-weight: 900; }
      .note { margin-top: 10px; text-align: center; font-size: 11px; }
      @media screen { body { max-width: 320px; padding: 12px; } }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function printHtml(title: string, body: string) {
  const printWindow = window.open("", "_blank", "width=420,height=720");
  if (!printWindow) return false;

  printWindow.document.write(printablePage(title, body));
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}

function getKitchenItems(sale: PrintableSale) {
  return sale.items.filter((item) => KITCHEN_CATEGORIES.has(item.category));
}

function getQrImageSource(qrCode: string) {
  if (!qrCode) return "";
  if (qrCode.startsWith("data:")) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

function printKitchenSheet(sale: PrintableSale) {
  const kitchenItems = getKitchenItems(sale);
  if (kitchenItems.length === 0) return false;

  return printHtml(
    "Гал тогоо",
    `<h1>ГАЛ ТОГОО</h1>
    <h2>Захиалгын хуудас</h2>
    <div class="meta">
      <div class="row"><strong>Дугаар</strong><span>${escapeHtml(sale.id)}</span></div>
      <div class="row"><strong>Цаг</strong><span>${escapeHtml(formatReceiptDate(sale.createdAt))}</span></div>
      <div class="row"><strong>Ажилтан</strong><span>${escapeHtml(sale.staffName)}</span></div>
      ${
        sale.roomNumber
          ? `<div class="row"><strong>Өрөө/Зочин</strong><span>${escapeHtml(sale.roomNumber)}</span></div>`
          : ""
      }
    </div>
    <div class="items">
      ${kitchenItems
        .map(
          (item) => `<div class="item">
            <div class="item-main">
              <span class="qty">${item.quantity}x</span>
              <span class="name">${escapeHtml(item.name)}</span>
              <span></span>
            </div>
          </div>`,
        )
        .join("")}
    </div>
    <div class="note">Гал тогоонд хэвлэв</div>`,
  );
}

function printReceipt(sale: PrintableSale) {
  return printHtml(
    "Баримт",
    `<h1>DALAI EEJ</h1>
    <h2>Төлбөрийн баримт</h2>
    <div class="meta">
      <div class="row"><strong>Дугаар</strong><span>${escapeHtml(sale.id)}</span></div>
      <div class="row"><strong>Цаг</strong><span>${escapeHtml(formatReceiptDate(sale.createdAt))}</span></div>
      <div class="row"><strong>Ажилтан</strong><span>${escapeHtml(sale.staffName)}</span></div>
      <div class="row"><strong>Төлбөр</strong><span>${escapeHtml(sale.paymentLabel)}</span></div>
      ${
        sale.roomNumber
          ? `<div class="row"><strong>Өрөө/Зочин</strong><span>${escapeHtml(sale.roomNumber)}</span></div>`
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
    <div class="note">Баярлалаа</div>`,
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
  const [roomNumber, setRoomNumber] = useState("");
  const [saleStatus, setSaleStatus] = useState<SaleStatus>("idle");
  const [saleMessage, setSaleMessage] = useState("");
  const [lastSale, setLastSale] = useState<PrintableSale | null>(null);
  const [saleSequence, setSaleSequence] = useState(0);
  const [qpayInvoice, setQPayInvoice] = useState<QPayInvoice | null>(null);
  const [qpayStatus, setQPayStatus] = useState<QPayStatus>("idle");
  const [qpayMessage, setQPayMessage] = useState("");
  const [qpayWindowOpen, setQPayWindowOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const loadCatalog = useCallback(async () => {
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCatalog();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadCatalog]);

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
    return ["all", ...unique] as Array<ItemCategory | "all">;
  }, [products]);

  const cartTotal = cart.reduce(
    (sum, line) => sum + line.price * line.quantity,
    0,
  );
  const selectedPayment =
    PAYMENT_METHODS.find((method) => method.id === paymentMethod) ??
    PAYMENT_METHODS[0];
  const cashRequired = paymentMethod === "cash";
  const cashShort = Math.max(cartTotal - cashReceived, 0);
  const changeDue = Math.max(cashReceived - cartTotal, 0);
  const roomRequired = paymentMethod === "room";
  const qpayRequired = paymentMethod === "qpay";
  const qpayPaid = qpayStatus === "paid";
  const canCompleteSale =
    cart.length > 0 &&
    saleStatus !== "saving" &&
    (!cashRequired || cashShort === 0) &&
    (!roomRequired || roomNumber.trim().length > 0) &&
    (!qpayRequired || qpayPaid);
  const completeSaleLabel = saleStatus === "saving"
    ? "Хадгалж байна"
    : roomRequired
      ? "Өрөө/зочинд бичих"
      : qpayRequired
        ? qpayPaid
          ? "QPay борлуулалт хадгалах"
          : "QPay төлбөр хүлээгдэж байна"
        : "Төлбөр авах";

  function addToCart(item: CatalogItem) {
    setSaleStatus("idle");
    setSaleMessage("");
    setLastSale(null);
    resetQPayPayment();
    setCart((current) => {
      const existing = current.find((line) => line.sku === item.sku);
      if (existing) {
        return current.map((line) =>
          line.sku === item.sku
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }

      return [
        ...current,
        {
          id: item.sku ?? item.id,
          sku: item.sku,
          name: item.name,
          price: item.price,
          category: item.category,
          quantity: 1,
          staff: staffName,
        },
      ];
    });
  }

  function updateQuantity(id: string, quantity: number) {
    resetQPayPayment();
    setCart((current) =>
      current
        .map((line) => (line.id === id ? { ...line, quantity } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function selectPaymentMethod(method: PaymentMethodId) {
    setPaymentMethod(method);
    if (method === "qpay") {
      setQPayWindowOpen(true);
    } else {
      resetQPayPayment();
    }
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
    }
  }

  function resetQPayPayment() {
    setQPayInvoice(null);
    setQPayStatus("idle");
    setQPayMessage("");
    setQPayWindowOpen(false);
  }

  function setCashInput(value: string) {
    const amount = Number(value.replace(/[^\d]/g, ""));
    setCashReceived(Number.isFinite(amount) ? amount : 0);
    if (saleStatus === "error") {
      setSaleStatus("idle");
      setSaleMessage("");
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

  async function createQPayInvoice() {
    if (cartTotal <= 0 || qpayStatus === "creating") return;

    setQPayStatus("creating");
    setQPayMessage("");
    setSaleStatus("idle");
    setSaleMessage("");

    try {
      const response = await fetch("/api/qpay/create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: cartTotal,
          description: `Dalai Eej POS ${formatMNT(cartTotal)}`,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | {
            invoiceId?: string;
            qrCode?: string;
            qrText?: string;
            shortUrl?: string;
            error?: string;
          }
        | null;

      if (!response.ok || !data?.invoiceId) {
        throw new Error(data?.error ?? "QPay QR үүсгэж чадсангүй");
      }

      setQPayInvoice({
        invoiceId: data.invoiceId,
        qrCode: data.qrCode ?? "",
        qrText: data.qrText ?? "",
        shortUrl: data.shortUrl ?? "",
      });
      setQPayStatus("pending");
      setQPayMessage("QR уншуулсны дараа төлбөр шалгана уу");
    } catch (error) {
      setQPayStatus("error");
      setQPayMessage(
        error instanceof Error ? error.message : "QPay QR үүсгэж чадсангүй",
      );
    }
  }

  async function checkQPayPayment() {
    if (!qpayInvoice || qpayStatus === "checking") return;

    setQPayStatus("checking");
    setQPayMessage("");

    try {
      const response = await fetch("/api/qpay/check-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: qpayInvoice.invoiceId,
          expectedAmount: cartTotal,
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { paid?: boolean; paidAmount?: number; error?: string }
        | null;

      if (!response.ok) {
        throw new Error(data?.error ?? "QPay төлбөр шалгаж чадсангүй");
      }

      if (!data?.paid) {
        setQPayStatus("pending");
        setQPayMessage("Төлбөр хараахан орж ирээгүй байна");
        return;
      }

      setQPayStatus("paid");
      setQPayMessage(
        `QPay төлөгдсөн: ${formatMNT(Number(data.paidAmount ?? cartTotal))}`,
      );
    } catch (error) {
      setQPayStatus("error");
      setQPayMessage(
        error instanceof Error ? error.message : "QPay төлбөр шалгаж чадсангүй",
      );
    }
  }

  function getPaymentLogLabel() {
    if (qpayRequired && qpayInvoice) {
      return `${selectedPayment.label} ${qpayInvoice.invoiceId}`;
    }

    if (!cashRequired) return selectedPayment.label;

    return `${selectedPayment.label} төлсөн ${formatNumber(cashReceived)}, хариулт ${formatNumber(changeDue)}`;
  }

  async function completeSale() {
    if (cart.length === 0 || saleStatus === "saving") return;
    if (cashRequired && cashShort > 0) {
      setSaleStatus("error");
      setSaleMessage(`${formatMNT(cashShort)} дутуу байна`);
      return;
    }
    if (roomRequired && roomNumber.trim().length === 0) {
      setSaleStatus("error");
      setSaleMessage("Өрөө, нэр эсвэл утас оруулна уу");
      return;
    }
    if (qpayRequired && !qpayPaid) {
      setSaleStatus("error");
      setSaleMessage("QPay төлбөрөө шалгаж баталгаажуулна уу");
      setQPayWindowOpen(true);
      return;
    }

    setSaleStatus("saving");
    setSaleMessage("");
    const nextSaleSequence = saleSequence + 1;
    const completedSale: PrintableSale = {
      id: `SALE-${nextSaleSequence.toString().padStart(4, "0")}`,
      createdAt: new Date(),
      items: cart,
      total: cartTotal,
      paymentLabel: getPaymentLogLabel(),
      staffName,
      roomNumber: roomRequired ? roomNumber.trim() : "",
      cashReceived: cashRequired ? cashReceived : 0,
      changeDue: cashRequired ? changeDue : 0,
      qpayInvoiceId: qpayRequired ? qpayInvoice?.invoiceId ?? "" : "",
    };

    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            sku: line.sku ?? line.id,
            name: line.name,
            qty: line.quantity,
            unitPrice: line.price,
          })),
          method: completedSale.paymentLabel,
          room: roomRequired ? roomNumber.trim() : "",
          staffName,
          paidStatus: roomRequired ? "unpaid" : "paid",
          total: completedSale.total,
          cashReceived: completedSale.cashReceived,
          changeDue: completedSale.changeDue,
          qpayInvoiceId: completedSale.qpayInvoiceId,
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
      setRoomNumber("");
      resetQPayPayment();
      setLastSale(completedSale);
      setSaleSequence(nextSaleSequence);
      setSaleStatus("success");
      const kitchenItems = getKitchenItems(completedSale);
      const kitchenPrinted = printKitchenSheet(completedSale);
      setSaleMessage(
        `${formatMNT(cartTotal)} хадгаллаа${
          kitchenItems.length > 0
            ? kitchenPrinted
              ? " · Гал тогооны хуудас хэвлэгдлээ"
              : " · Гал тогооны хуудсыг хэвлэх товчоор гаргана уу"
            : ""
        }`,
      );
    } catch (error) {
      setSaleStatus("error");
      setSaleMessage(
        error instanceof Error
          ? error.message
          : "Sale could not be logged",
      );
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#f3f4f6] text-[#111827]">
      <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-3 border-b border-[#d1d5db] bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-bold leading-tight">Dalai Eej Register</h1>
          <p className="text-xs font-medium text-[#6b7280]">{businessDate}</p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
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
            onClick={loadCatalog}
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
        <section className="flex min-h-0 flex-col border-r border-[#d1d5db]">
          <div className="shrink-0 border-b border-[#d1d5db] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="min-w-[220px] flex-1">
                <span className="sr-only">Бараа хайх</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="search"
                  placeholder="Бараа эсвэл код хайх"
                  className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-base outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
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
                        ? { backgroundColor: CATEGORY_ACCENTS[category] }
                        : undefined
                    }
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                ))}
              </div>
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
                  <button
                    key={item.id}
                    data-testid="product-tile"
                    type="button"
                    onClick={() => addToCart(item)}
                    className="flex h-32 flex-col justify-between rounded-md border border-[#d1d5db] bg-white p-3 text-left shadow-sm transition hover:border-[#2563eb] hover:shadow active:scale-[0.99]"
                  >
                    <span className="break-words text-sm font-bold leading-snug text-[#111827]">
                      {item.name}
                    </span>
                    <span className="flex items-end justify-between gap-2">
                      <span className="text-xs font-medium text-[#6b7280]">
                        {item.sku}
                      </span>
                      <span className="rounded bg-[#ecfdf5] px-2 py-1 text-sm font-extrabold text-[#047857]">
                        {formatNumber(item.price)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        <aside className="flex min-h-[420px] flex-col bg-white">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#d1d5db] px-4">
            <h2 className="text-base font-bold">Одоогийн борлуулалт</h2>
            <button
              type="button"
              onClick={() => {
                setCart([]);
                setCashReceived(0);
                setRoomNumber("");
                setSaleStatus("idle");
                setSaleMessage("");
                setLastSale(null);
                resetQPayPayment();
              }}
              disabled={cart.length === 0}
              className="rounded-md border border-[#cbd5e1] px-3 py-1.5 text-sm font-semibold text-[#374151] hover:bg-[#f8fafc] disabled:opacity-40"
            >
              Цэвэрлэх
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

          <div className="shrink-0 border-t border-[#d1d5db] p-4">
            <div className="mb-3 flex items-end justify-between gap-3">
              <span className="text-sm font-semibold text-[#6b7280]">Нийт</span>
              <span className="text-3xl font-black tracking-normal">
                {formatMNT(cartTotal)}
              </span>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => selectPaymentMethod(method.id)}
                  className={`h-11 rounded-md border text-sm font-extrabold ${
                    paymentMethod === method.id
                      ? "border-[#111827] bg-[#111827] text-white"
                      : "border-[#cbd5e1] bg-white text-[#374151] hover:bg-[#f8fafc]"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>

            {cashRequired && (
              <div className="mb-3 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-3">
                <div className="mb-2 grid grid-cols-2 gap-3">
                  <label>
                    <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                      Авсан мөнгө
                    </span>
                    <input
                      value={cashReceived ? formatNumber(cashReceived) : ""}
                      onChange={(event) => setCashInput(event.target.value)}
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-right text-base font-black outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                    />
                  </label>
                  <div>
                    <span className="mb-1 block text-xs font-bold text-[#6b7280]">
                      Хариулт
                    </span>
                    <div
                      className={`flex h-11 items-center justify-end rounded-md border px-3 text-base font-black ${
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

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setCashReceived(cartTotal)}
                    className="h-10 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#eef2ff]"
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
                      className="h-10 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#eef2ff]"
                    >
                      +{formatNumber(amount)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCashReceived(0)}
                    className="h-10 rounded-md border border-[#fecaca] bg-white text-sm font-extrabold text-[#b91c1c] hover:bg-[#fef2f2]"
                  >
                    Арилгах
                  </button>
                </div>
              </div>
            )}

            {roomRequired && (
              <div className="mb-3 rounded-md border border-[#cbd5e1] bg-[#f8fafc] p-3">
                <span className="mb-2 block text-xs font-bold text-[#6b7280]">
                  Өрөөний дугаар
                </span>
                <div className="mb-3 grid grid-cols-6 gap-2">
                  {ROOM_NUMBERS.map((number) => (
                    <button
                      key={number}
                      type="button"
                      onClick={() => setChargeReference(number)}
                      className={`h-9 rounded-md border text-sm font-extrabold ${
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
                  <span className="mb-1 block text-xs font-bold text-[#6b7280]">
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
                    className="h-11 w-full rounded-md border border-[#cbd5e1] bg-white px-3 text-base font-bold outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#bfdbfe]"
                  />
                </label>
              </div>
            )}

            {qpayRequired && !qpayWindowOpen && (
              <button
                type="button"
                onClick={() => setQPayWindowOpen(true)}
                className="mb-3 h-11 w-full rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#f8fafc]"
              >
                QPay QR цонх нээх
              </button>
            )}

            {saleMessage && (
              <div
                className={`mb-3 rounded-md px-3 py-2 text-sm font-bold ${
                  saleStatus === "error"
                    ? "bg-[#fef2f2] text-[#b91c1c]"
                    : "bg-[#ecfdf5] text-[#047857]"
                }`}
              >
                {saleMessage}
              </div>
            )}

            {lastSale && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                {getKitchenItems(lastSale).length > 0 && (
                  <button
                    type="button"
                    onClick={() => printKitchenSheet(lastSale)}
                    className="h-11 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#f8fafc]"
                  >
                    Гал тогоо хэвлэх
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => printReceipt(lastSale)}
                  className="h-11 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#f8fafc]"
                >
                  Баримт хэвлэх
                </button>
              </div>
            )}

            <button
              type="button"
              data-testid="complete-sale"
              onClick={completeSale}
              disabled={!canCompleteSale}
              className="h-14 w-full rounded-md bg-[#047857] text-base font-black text-white hover:bg-[#065f46] disabled:bg-[#9ca3af]"
            >
              {completeSaleLabel}
            </button>
          </div>
        </aside>
      </main>

      {qpayRequired && qpayWindowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-[360px] rounded-md border border-[#cbd5e1] bg-white shadow-xl">
            <div className="flex h-12 items-center justify-between border-b border-[#e5e7eb] px-4">
              <h3 className="text-sm font-black">QPay төлбөр</h3>
              <button
                type="button"
                onClick={() => setQPayWindowOpen(false)}
                className="h-8 w-8 rounded-md border border-[#cbd5e1] text-lg font-bold hover:bg-[#f8fafc]"
                aria-label="QPay цонх хаах"
              >
                x
              </button>
            </div>

            <div className="p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-xs font-bold text-[#6b7280]">Нийт</span>
                <span className="text-2xl font-black">{formatMNT(cartTotal)}</span>
              </div>

              {qpayInvoice ? (
                <div className="mb-3 flex flex-col items-center gap-3">
                  {qpayInvoice.qrCode ? (
                    <Image
                      src={getQrImageSource(qpayInvoice.qrCode)}
                      alt="QPay QR"
                      width={176}
                      height={176}
                      unoptimized
                      className="h-44 w-44 rounded-md border border-[#e5e7eb] object-contain p-2"
                    />
                  ) : (
                    <div className="flex h-44 w-44 items-center justify-center rounded-md border border-[#e5e7eb] bg-[#f8fafc] p-3 text-center text-xs font-bold text-[#6b7280]">
                      QR зураг ирсэнгүй. Богино холбоос эсвэл QR текст ашиглана уу.
                    </div>
                  )}
                  <div className="w-full rounded-md bg-[#f8fafc] px-3 py-2 text-xs font-semibold text-[#374151]">
                    <p className="break-all">Invoice: {qpayInvoice.invoiceId}</p>
                    {qpayInvoice.shortUrl && (
                      <a
                        href={qpayInvoice.shortUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-[#2563eb] underline"
                      >
                        {qpayInvoice.shortUrl}
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mb-3 rounded-md border border-[#e5e7eb] bg-[#f8fafc] px-3 py-8 text-center text-sm font-bold text-[#6b7280]">
                  QR үүсгээд хэрэглэгчээр уншуулна.
                </div>
              )}

              {qpayMessage && (
                <div
                  className={`mb-3 rounded-md px-3 py-2 text-sm font-bold ${
                    qpayStatus === "paid"
                      ? "bg-[#ecfdf5] text-[#047857]"
                      : qpayStatus === "error"
                        ? "bg-[#fef2f2] text-[#b91c1c]"
                        : "bg-[#eff6ff] text-[#1d4ed8]"
                  }`}
                >
                  {qpayMessage}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={createQPayInvoice}
                  disabled={cartTotal <= 0 || qpayStatus === "creating"}
                  className="h-11 rounded-md border border-[#cbd5e1] bg-white text-sm font-extrabold hover:bg-[#f8fafc] disabled:opacity-40"
                >
                  {qpayStatus === "creating" ? "Үүсгэж байна" : "QR үүсгэх"}
                </button>
                <button
                  type="button"
                  onClick={checkQPayPayment}
                  disabled={!qpayInvoice || qpayStatus === "checking"}
                  className="h-11 rounded-md bg-[#111827] text-sm font-extrabold text-white hover:bg-[#374151] disabled:bg-[#9ca3af]"
                >
                  {qpayStatus === "checking" ? "Шалгаж байна" : "Төлбөр шалгах"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

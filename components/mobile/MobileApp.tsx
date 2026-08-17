"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  readOfflineCache,
  writeOfflineCache,
} from "@/lib/client/offline-cache";
import {
  canRefreshInBackground,
  fetchWithTimeout,
} from "@/lib/client/network";
import { formatMNT, formatNumber } from "@/lib/pos/utils";

type DayTotals = {
  salesTotal: number;
  paymentTotal: number;
  cashPaymentTotal: number;
  cardPaymentTotal: number;
  qpayPaymentTotal: number;
  otherPaymentTotal: number;
  roomChargeTotal: number;
  currentSalePaymentTotal: number;
  priorDebtCollectedTotal: number;
  refundTotal: number;
  newRoomDebtTotal: number;
  expectedCash: number;
};

type DaySession = {
  openedAt?: string;
  openedBy?: string;
  startingCash?: number;
  status?: string;
  closedAt?: string;
  closedBy?: string;
};

type DayItemTotal = {
  name: string;
  quantity: number;
};

type Charge = {
  transactionId: string;
  timestamp: string;
  staff: string;
  roomOrGuest: string;
  total: number;
  paidAmount?: number;
  balance?: number;
  itemCount?: number;
  itemSummary: string;
};

type HistorySale = {
  transactionId: string;
  timestamp: string;
  staff: string;
  paymentMethod: string;
  paidStatus: string;
  roomOrGuest: string;
  total: number;
  paidAmount: number;
  balance?: number;
  itemSummary: string;
  historyKind?: "sale" | "payment";
};

type CatalogItem = {
  sku: string;
  name: string;
  category?: string;
  price: number;
  stock?: number;
};

type MobileData = {
  session: DaySession | null;
  totals: DayTotals;
  itemTotals: DayItemTotal[];
  charges: Charge[];
  history: HistorySale[];
  catalog: CatalogItem[];
};

type TabId = "today" | "sales" | "charges" | "stock";
type LoadState = "loading" | "ready" | "partial" | "error";

type MobileAppProps = {
  businessDate: string;
};

const EMPTY_TOTALS: DayTotals = {
  salesTotal: 0,
  paymentTotal: 0,
  cashPaymentTotal: 0,
  cardPaymentTotal: 0,
  qpayPaymentTotal: 0,
  otherPaymentTotal: 0,
  roomChargeTotal: 0,
  currentSalePaymentTotal: 0,
  priorDebtCollectedTotal: 0,
  refundTotal: 0,
  newRoomDebtTotal: 0,
  expectedCash: 0,
};

const EMPTY_DATA: MobileData = {
  session: null,
  totals: EMPTY_TOTALS,
  itemTotals: [],
  charges: [],
  history: [],
  catalog: [],
};

const TABS: Array<{ id: TabId; label: string; symbol: string }> = [
  { id: "today", label: "Өнөөдөр", symbol: "●" },
  { id: "sales", label: "Төлбөр", symbol: "₮" },
  { id: "charges", label: "Өр", symbol: "!" },
  { id: "stock", label: "Бараа", symbol: "#" },
];

function readError(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return fallback;
}

async function readJson(response: Response) {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(readError(payload, response.statusText));
  }

  return payload;
}

function dataUrl(path: string, businessDate: string, fresh: boolean) {
  const params = new URLSearchParams();

  if (path !== "/api/inventory") {
    params.set("businessDate", businessDate);
  }

  if (fresh) params.set("fresh", "1");

  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

function statusLabel(session: DaySession | null) {
  const status = session?.status?.toLowerCase();

  if (status === "open") return "Нээлттэй";
  if (status === "closed") return "Хаалттай";
  return "Нээгээгүй";
}

function statusClass(session: DaySession | null) {
  const status = session?.status?.toLowerCase();

  if (status === "open") {
    return "border-[#86efac] bg-[#ecfdf5] text-[#047857]";
  }

  if (status === "closed") {
    return "border-[#cbd5e1] bg-white text-[#475569]";
  }

  return "border-[#fdba74] bg-[#fff7ed] text-[#c2410c]";
}

function timeLabel(date: Date | null) {
  if (!date) return "—";

  return date.toLocaleTimeString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function chargeBalance(charges: Charge[]) {
  return charges.reduce(
    (sum, charge) => sum + (charge.balance ?? charge.total ?? 0),
    0,
  );
}

function StatTile({
  label,
  value,
  tone = "white",
}: {
  label: string;
  value: string;
  tone?: "white" | "green" | "amber" | "red";
}) {
  const toneClass = {
    white: "border-[#e2e8f0] bg-white text-[#111827]",
    green: "border-[#bbf7d0] bg-[#f0fdf4] text-[#064e3b]",
    amber: "border-[#fed7aa] bg-[#fff7ed] text-[#7c2d12]",
    red: "border-[#fecaca] bg-[#fef2f2] text-[#7f1d1d]",
  }[tone];

  return (
    <div className={`min-h-24 rounded-2xl border p-4 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-normal opacity-70">
        {label}
      </p>
      <p className="mt-3 truncate text-xl font-black">{value}</p>
    </div>
  );
}

function ActionLink({
  href,
  label,
  variant = "primary",
}: {
  href: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-12 items-center justify-center rounded-2xl px-4 text-sm font-black ${
        variant === "primary"
          ? "bg-[#111827] text-white"
          : "border border-[#cbd5e1] bg-white text-[#111827]"
      }`}
    >
      {label}
    </Link>
  );
}

function ListEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-5 text-center text-sm font-bold text-[#64748b]">
      {children}
    </div>
  );
}

export function MobileApp({ businessDate }: MobileAppProps) {
  const [activeTab, setActiveTab] = useState<TabId>("today");
  const [data, setData] = useState<MobileData>(EMPTY_DATA);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const loadData = useCallback(
    async (fresh = false) => {
      const cacheKey = `mobile:${businessDate}`;
      const cached = readOfflineCache<MobileData>(cacheKey);

      if (cached) {
        setData(cached.value);
        setLastUpdatedAt(new Date(cached.savedAt));
      }
      setLoadState((current) =>
        current === "ready" || cached ? "ready" : "loading",
      );

      const [dayResult, salesResult, inventoryResult] =
        await Promise.allSettled([
          fetchWithTimeout(dataUrl("/api/day", businessDate, fresh), {
            cache: "no-store",
          }).then(readJson),
          fetchWithTimeout(dataUrl("/api/sales", businessDate, fresh), {
            cache: "no-store",
          }).then(readJson),
          fetchWithTimeout(dataUrl("/api/inventory", businessDate, fresh), {
            cache: "no-store",
          }).then(readJson),
        ]);

      const nextErrors: string[] = [];
      const dayPayload =
        dayResult.status === "fulfilled"
          ? (dayResult.value as {
              session?: DaySession | null;
              totals?: DayTotals;
              itemTotals?: DayItemTotal[];
            })
          : cached?.value ?? null;
      const salesPayload =
        salesResult.status === "fulfilled"
          ? (salesResult.value as {
              charges?: Charge[];
              history?: HistorySale[];
            })
          : cached?.value ?? null;
      const inventoryPayload =
        inventoryResult.status === "fulfilled" &&
        Array.isArray(inventoryResult.value)
          ? (inventoryResult.value as CatalogItem[])
          : cached?.value.catalog ?? [];

      if (dayResult.status === "rejected") {
        nextErrors.push(`Өдөр: ${dayResult.reason.message}`);
      }

      if (salesResult.status === "rejected") {
        nextErrors.push(`Төлбөр: ${salesResult.reason.message}`);
      }

      if (inventoryResult.status === "rejected") {
        nextErrors.push(`Бараа: ${inventoryResult.reason.message}`);
      }

      const nextData: MobileData = {
        session: dayPayload?.session ?? null,
        totals: dayPayload?.totals ?? EMPTY_TOTALS,
        itemTotals: Array.isArray(dayPayload?.itemTotals)
          ? dayPayload.itemTotals
          : [],
        charges: Array.isArray(salesPayload?.charges)
          ? salesPayload.charges
          : [],
        history: Array.isArray(salesPayload?.history)
          ? salesPayload.history
          : [],
        catalog: inventoryPayload,
      };

      setData(nextData);
      if (
        dayResult.status === "fulfilled" ||
        salesResult.status === "fulfilled" ||
        inventoryResult.status === "fulfilled"
      ) {
        writeOfflineCache(cacheKey, nextData);
        setLastUpdatedAt(new Date());
      }
      setErrors(nextErrors);
      setLoadState(
        nextErrors.length === 0
          ? "ready"
          : nextErrors.length === 3
            ? "error"
            : "partial",
      );
    },
    [businessDate],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    const refresh = () => {
      if (canRefreshInBackground()) void loadData();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(refresh, 3 * 60 * 1000);

    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadData]);

  const unpaidBalance = useMemo(
    () => chargeBalance(data.charges),
    [data.charges],
  );
  const lowStockItems = useMemo(
    () =>
      data.catalog
        .filter((item) => typeof item.stock === "number" && item.stock <= 3)
        .sort((first, second) => (first.stock ?? 0) - (second.stock ?? 0))
        .slice(0, 12),
    [data.catalog],
  );
  const topItems = data.itemTotals.slice(0, 8);
  const recentSales = data.history.slice(0, 12);
  const openCharges = data.charges.slice(0, 12);
  const nonCashTotal =
    data.totals.cardPaymentTotal +
    data.totals.qpayPaymentTotal +
    data.totals.otherPaymentTotal;

  return (
    <div className="min-h-dvh bg-[#f5f7fb] text-[#111827]">
      <header className="sticky top-0 z-20 border-b border-[#dbe3ee] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[520px] items-center gap-3 px-4 py-3">
          <Image
            src="/app-icon.svg"
            alt=""
            width={42}
            height={42}
            priority
            className="h-[42px] w-[42px] rounded-2xl border border-[#e2e8f0] bg-[#f8fafc] p-2"
          />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-black">Dalai Eej Mobile</h1>
            <p className="truncate text-xs font-bold text-[#64748b]">
              {businessDate} · {timeLabel(lastUpdatedAt)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData(true)}
            className="h-10 rounded-2xl border border-[#cbd5e1] bg-white px-3 text-xs font-black text-[#111827]"
          >
            Шинэчлэх
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-[520px] px-4 pb-28 pt-4">
        <section className="rounded-[28px] bg-[#111827] p-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-normal text-[#a7f3d0]">
                Өдрийн борлуулалт
              </p>
              <p className="mt-3 truncate text-4xl font-black tracking-normal">
                {formatMNT(data.totals.salesTotal)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-2xl border px-3 py-2 text-xs font-black ${statusClass(data.session)}`}
            >
              {statusLabel(data.session)}
            </span>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs font-bold text-[#cbd5e1]">Төлсөн</p>
              <p className="mt-1 truncate text-base font-black">
                {formatMNT(data.totals.paymentTotal)}
              </p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3">
              <p className="text-xs font-bold text-[#cbd5e1]">Өр</p>
              <p className="mt-1 truncate text-base font-black">
                {formatMNT(unpaidBalance)}
              </p>
            </div>
          </div>
        </section>

        {errors.length > 0 && (
          <section className="mt-4 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3">
            <p className="text-sm font-black text-[#9a3412]">
              {loadState === "error" ? "Мэдээлэл татсангүй" : "Зарим мэдээлэл дутуу"}
            </p>
            {errors.map((error) => (
              <p
                key={error}
                className="mt-1 break-words text-xs font-bold text-[#9a3412]"
              >
                {error}
              </p>
            ))}
          </section>
        )}

        <section className="mt-4 grid grid-cols-2 gap-3">
          <StatTile
            label="Бэлнээр байх"
            value={formatMNT(data.totals.expectedCash)}
            tone="green"
          />
          <StatTile
            label="Карт / Данс"
            value={formatMNT(nonCashTotal)}
          />
          <StatTile
            label="Өрийн мөр"
            value={formatNumber(data.charges.length)}
            tone={data.charges.length > 0 ? "amber" : "white"}
          />
          <StatTile
            label="Бага үлдэгдэл"
            value={formatNumber(lowStockItems.length)}
            tone={lowStockItems.length > 0 ? "red" : "white"}
          />
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          <ActionLink href="/register" label="Касс" />
          <ActionLink href="/ops" label="Ops" variant="secondary" />
        </section>

        <section className="mt-5">
          {activeTab === "today" && (
            <div className="grid gap-4">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-black">Топ бараа</h2>
                  <span className="text-xs font-bold text-[#64748b]">
                    {formatNumber(topItems.length)}
                  </span>
                </div>
                {topItems.length === 0 ? (
                  <ListEmpty>Өдрийн барааны дүн алга.</ListEmpty>
                ) : (
                  <div className="grid gap-2">
                    {topItems.map((item, index) => (
                      <div
                        key={item.name}
                        className="grid min-h-16 grid-cols-[36px_minmax(0,1fr)_56px] items-center gap-3 rounded-2xl border border-[#e2e8f0] bg-white px-4"
                      >
                        <span className="text-sm font-black text-[#94a3b8]">
                          {index + 1}
                        </span>
                        <span className="truncate text-sm font-black">
                          {item.name}
                        </span>
                        <span className="text-right text-sm font-black">
                          {formatNumber(item.quantity)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-base font-black">Касс</h2>
                  <span className="text-xs font-bold text-[#64748b]">
                    {statusLabel(data.session)}
                  </span>
                </div>
                <div className="grid gap-2">
                  <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_128px] items-center rounded-2xl border border-[#e2e8f0] bg-white px-4">
                    <span className="truncate text-sm font-bold text-[#64748b]">
                      Нээсэн
                    </span>
                    <span className="truncate text-right text-sm font-black">
                      {data.session?.openedBy || "—"}
                    </span>
                  </div>
                  <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_128px] items-center rounded-2xl border border-[#e2e8f0] bg-white px-4">
                    <span className="truncate text-sm font-bold text-[#64748b]">
                      Эхлэх мөнгө
                    </span>
                    <span className="truncate text-right text-sm font-black">
                      {formatMNT(data.session?.startingCash ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "sales" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black">Сүүлийн төлбөр</h2>
                <span className="text-xs font-bold text-[#64748b]">
                  {formatNumber(recentSales.length)}
                </span>
              </div>
              {recentSales.length === 0 ? (
                <ListEmpty>Өнөөдрийн төлбөр алга.</ListEmpty>
              ) : (
                <div className="grid gap-2">
                  {recentSales.map((sale) => (
                    <div
                      key={`${sale.transactionId}-${sale.timestamp}`}
                      className="rounded-2xl border border-[#e2e8f0] bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black">
                            {sale.transactionId}
                          </p>
                          <p className="mt-1 truncate text-xs font-bold text-[#64748b]">
                            {sale.staff || "Staff"} · {sale.paymentMethod || "Төлбөр"}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-black text-[#047857]">
                          {formatMNT(sale.paidAmount ?? sale.total)}
                        </p>
                      </div>
                      <p className="mt-3 break-words text-sm font-bold leading-5 text-[#334155]">
                        {sale.itemSummary || sale.roomOrGuest || sale.timestamp}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "charges" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black">Хаагдаагүй өр</h2>
                <span className="text-xs font-bold text-[#64748b]">
                  {formatMNT(unpaidBalance)}
                </span>
              </div>
              {openCharges.length === 0 ? (
                <ListEmpty>Хаагдаагүй өр алга.</ListEmpty>
              ) : (
                <div className="grid gap-2">
                  {openCharges.map((charge) => (
                    <div
                      key={charge.transactionId}
                      className="rounded-2xl border border-[#fed7aa] bg-[#fffaf0] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black">
                            {charge.roomOrGuest || charge.transactionId}
                          </p>
                          <p className="mt-1 truncate text-xs font-bold text-[#92400e]">
                            {charge.staff || "Staff"} · {charge.timestamp}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-black text-[#b45309]">
                          {formatMNT(charge.balance ?? charge.total)}
                        </p>
                      </div>
                      <p className="mt-3 break-words text-sm font-bold leading-5 text-[#334155]">
                        {charge.itemSummary || `${charge.itemCount ?? 1} бараа`}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "stock" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-black">Бага үлдэгдэл</h2>
                <span className="text-xs font-bold text-[#64748b]">
                  {formatNumber(data.catalog.length)} бараа
                </span>
              </div>
              {lowStockItems.length === 0 ? (
                <ListEmpty>Бага үлдэгдэлтэй бараа алга.</ListEmpty>
              ) : (
                <div className="grid gap-2">
                  {lowStockItems.map((item) => (
                    <div
                      key={item.sku}
                      className="grid min-h-16 grid-cols-[minmax(0,1fr)_60px] items-center gap-3 rounded-2xl border border-[#fecaca] bg-white px-4"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">
                          {item.name}
                        </p>
                        <p className="mt-1 truncate text-xs font-bold text-[#64748b]">
                          {item.sku} · {item.category || "Ангилалгүй"}
                        </p>
                      </div>
                      <span className="text-right text-base font-black text-[#b91c1c]">
                        {formatNumber(item.stock ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#dbe3ee] bg-white/95 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-[520px] grid-cols-4 gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`grid h-14 place-items-center rounded-2xl text-xs font-black ${
                activeTab === tab.id
                  ? "bg-[#111827] text-white"
                  : "text-[#64748b]"
              }`}
              aria-pressed={activeTab === tab.id}
            >
              <span className="text-base leading-none">{tab.symbol}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

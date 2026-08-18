"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  readOfflineCache,
  writeOfflineCache,
} from "@/lib/client/offline-cache";
import {
  canRefreshInBackground,
  fetchWithTimeout,
} from "@/lib/client/network";
import type { ManagementBoardResponse } from "@/lib/management-board-types";
import type { DataQualityReport } from "@/lib/data-quality-types";
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
  countedCash?: number;
  expectedCash?: number;
  cashDifference?: number;
  salesTotal?: number;
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
  originalTotal?: number;
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

type PendingOperation = {
  type: "sale" | "settlement" | "void" | "day";
  requestId: string;
  resourceId: string;
  businessDate: string;
  actor: string;
  timestamp: string;
  updatedAt: string;
  error: string;
  recoverable: boolean;
};

type DashboardData = {
  session: DaySession | null;
  totals: DayTotals;
  itemTotals: DayItemTotal[];
  charges: Charge[];
  history: HistorySale[];
  catalog: CatalogItem[];
  pendingOperations: PendingOperation[];
  quality: DataQualityReport | null;
};

type LoadState = "loading" | "ready" | "partial" | "error";

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

const EMPTY_DATA: DashboardData = {
  session: null,
  totals: EMPTY_TOTALS,
  itemTotals: [],
  charges: [],
  history: [],
  catalog: [],
  pendingOperations: [],
  quality: null,
};

const MANAGEMENT_BOARD_REFRESH_MS = 30 * 1000;
const SHEETS_RECONCILE_MS = 10 * 60 * 1000;

function normalizeDashboardData(value: Partial<DashboardData>): DashboardData {
  return {
    ...EMPTY_DATA,
    ...value,
    totals: { ...EMPTY_TOTALS, ...(value.totals ?? {}) },
    itemTotals: Array.isArray(value.itemTotals) ? value.itemTotals : [],
    charges: Array.isArray(value.charges) ? value.charges : [],
    history: Array.isArray(value.history) ? value.history : [],
    catalog: Array.isArray(value.catalog) ? value.catalog : [],
    pendingOperations: Array.isArray(value.pendingOperations)
      ? value.pendingOperations
      : [],
    quality:
      value.quality && typeof value.quality === "object"
        ? value.quality
        : null,
  };
}

function dashboardFromManagementBoard(
  payload: ManagementBoardResponse,
): DashboardData {
  const day =
    payload.sections.day && typeof payload.sections.day === "object"
      ? (payload.sections.day as Partial<DashboardData>)
      : {};
  const sales =
    payload.sections.sales && typeof payload.sections.sales === "object"
      ? (payload.sections.sales as Partial<DashboardData>)
      : {};
  const inventory = Array.isArray(payload.sections.inventory)
    ? (payload.sections.inventory as CatalogItem[])
    : [];
  const operations =
    payload.sections.operations &&
    typeof payload.sections.operations === "object"
      ? (payload.sections.operations as { pending?: PendingOperation[] })
      : {};
  const quality =
    payload.sections.quality && typeof payload.sections.quality === "object"
      ? (payload.sections.quality as DataQualityReport)
      : null;

  return normalizeDashboardData({
    session: day.session ?? null,
    totals: day.totals,
    itemTotals: day.itemTotals,
    charges: sales.charges,
    history: sales.history,
    catalog: inventory,
    pendingOperations: operations.pending,
    quality,
  });
}

type OpsDashboardProps = {
  businessDate: string;
};

function statusText(session: DaySession | null) {
  const status = session?.status?.toLowerCase();

  if (status === "open") return "Нээлттэй";
  if (status === "closed") return "Хаалттай";
  return "Нээгээгүй";
}

function statusClass(session: DaySession | null) {
  const status = session?.status?.toLowerCase();

  if (status === "open") {
    return "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]";
  }

  if (status === "closed") {
    return "border-[#d1d5db] bg-white text-[#374151]";
  }

  return "border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]";
}

function totalChargeBalance(charges: Charge[]) {
  return charges.reduce(
    (sum, charge) => sum + (charge.balance ?? charge.total ?? 0),
    0,
  );
}

function paymentBreakdownTotal(totals: DayTotals) {
  return (
    totals.cashPaymentTotal +
    totals.cardPaymentTotal +
    totals.qpayPaymentTotal +
    totals.otherPaymentTotal
  );
}

function extractError(payload: unknown, fallback: string) {
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
    throw new Error(extractError(payload, response.statusText));
  }

  return payload;
}

function buildDashboardUrl(path: string, businessDate: string, fresh: boolean) {
  const params = new URLSearchParams();
  params.set("businessDate", businessDate);

  if (fresh) params.set("fresh", "1");

  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

function formatUpdatedAt(date: Date | null) {
  if (!date) return "Шинэчлээгүй";

  return date.toLocaleTimeString("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "green" | "amber" | "red";
}) {
  const toneClass = {
    neutral: "border-[#d7dde7] bg-white",
    green: "border-[#bbf7d0] bg-[#f3fff8]",
    amber: "border-[#fed7aa] bg-[#fffaf0]",
    red: "border-[#fecaca] bg-[#fff7f7]",
  }[tone];

  return (
    <div className={`min-h-28 rounded-lg border p-4 ${toneClass}`}>
      <p className="text-xs font-black uppercase tracking-normal text-[#64748b]">
        {label}
      </p>
      <p className="mt-3 truncate text-2xl font-black text-[#111827]">
        {value}
      </p>
      <p className="mt-2 break-words text-xs font-bold leading-5 text-[#64748b]">
        {detail}
      </p>
    </div>
  );
}

function SectionShell({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-[#d7dde7] bg-white">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[#e5eaf1] px-4 py-3">
        <h2 className="text-sm font-black text-[#111827]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-36 items-center justify-center px-4 py-8 text-center text-sm font-bold text-[#64748b]">
      {children}
    </div>
  );
}

export function OpsDashboard({ businessDate }: OpsDashboardProps) {
  const [data, setData] = useState<DashboardData>(EMPTY_DATA);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errors, setErrors] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [adjustmentSku, setAdjustmentSku] = useState("");
  const [adjustmentDelta, setAdjustmentDelta] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentMessage, setAdjustmentMessage] = useState("");
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [qualityRepairing, setQualityRepairing] = useState(false);
  const [qualityMessage, setQualityMessage] = useState("");
  const pendingAdjustmentRef = useRef<{
    fingerprint: string;
    requestId: string;
  } | null>(null);
  const hasLoadedDashboardRef = useRef(false);

  const loadDashboard = useCallback(
    async (fresh = false) => {
      const cacheKey = `ops:${businessDate}`;
      const cached = readOfflineCache<DashboardData>(cacheKey);

      if (cached && !hasLoadedDashboardRef.current) {
        setData(normalizeDashboardData(cached.value));
        setLastUpdatedAt(new Date(cached.savedAt));
      }
      setLoadState((current) =>
        current === "ready" || cached ? "ready" : "loading",
      );

      if (!fresh) {
        try {
          const params = new URLSearchParams({ businessDate });
          const response = await fetchWithTimeout(
            `/api/management-board?${params.toString()}`,
            { cache: "no-store" },
          );
          const payload = (await response.json().catch(() => null)) as
            | ManagementBoardResponse
            | null;
          if (response.ok && payload?.initialized) {
            const nextData = dashboardFromManagementBoard(payload);
            hasLoadedDashboardRef.current = true;
            setData(nextData);
            writeOfflineCache(cacheKey, nextData);
            setLastUpdatedAt(
              payload.updatedAt ? new Date(payload.updatedAt) : new Date(),
            );
            setErrors([]);
            setLoadState("ready");
            if (!nextData.quality) {
              try {
                const qualityResponse = await fetchWithTimeout(
                  buildDashboardUrl(
                    "/api/data-quality",
                    businessDate,
                    false,
                  ),
                  { cache: "no-store" },
                );
                const quality = (await readJson(
                  qualityResponse,
                )) as DataQualityReport;
                const completeData = { ...nextData, quality };
                setData(completeData);
                writeOfflineCache(cacheKey, completeData);
              } catch {
                // The next scheduled refresh can retry this optional section.
              }
            }
            return;
          }
        } catch {
          // The authoritative multi-source load below remains the fallback.
        }
      }
      const nextErrors: string[] = [];

      const [
        dayResult,
        salesResult,
        inventoryResult,
        operationsResult,
        qualityResult,
      ] =
        await Promise.allSettled([
          fetchWithTimeout(
            buildDashboardUrl("/api/day", businessDate, fresh),
            { cache: "no-store" },
          ).then(readJson),
          fetchWithTimeout(
            buildDashboardUrl("/api/sales", businessDate, fresh),
            { cache: "no-store" },
          ).then(readJson),
          fetchWithTimeout(
            buildDashboardUrl("/api/inventory", businessDate, fresh),
            { cache: "no-store" },
          ).then(readJson),
          fetchWithTimeout(
            buildDashboardUrl("/api/operations", businessDate, fresh),
            { cache: "no-store" },
          ).then(readJson),
          fetchWithTimeout(
            buildDashboardUrl("/api/data-quality", businessDate, fresh),
            { cache: "no-store" },
          ).then(readJson),
        ]);

      const dayPayload =
        dayResult.status === "fulfilled"
          ? (dayResult.value as Partial<DashboardData> & {
              totals?: DayTotals;
              session?: DaySession | null;
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
      const operationsPayload =
        operationsResult.status === "fulfilled"
          ? (operationsResult.value as { pending?: PendingOperation[] })
          : { pending: cached?.value.pendingOperations ?? [] };
      const qualityPayload =
        qualityResult.status === "fulfilled"
          ? (qualityResult.value as DataQualityReport)
          : cached?.value.quality ?? null;

      if (dayResult.status === "rejected") {
        nextErrors.push(`Өдрийн төлөв: ${dayResult.reason.message}`);
      }

      if (salesResult.status === "rejected") {
        nextErrors.push(`Борлуулалт: ${salesResult.reason.message}`);
      }

      if (inventoryResult.status === "rejected") {
        nextErrors.push(`Бараа: ${inventoryResult.reason.message}`);
      }
      if (operationsResult.status === "rejected") {
        nextErrors.push(`Ажиллагаа: ${operationsResult.reason.message}`);
      }
      if (qualityResult.status === "rejected") {
        nextErrors.push(`Өгөгдлийн чанар: ${qualityResult.reason.message}`);
      }

      const nextData: DashboardData = {
        session: dayPayload?.session ?? null,
        totals: { ...EMPTY_TOTALS, ...(dayPayload?.totals ?? {}) },
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
        pendingOperations: Array.isArray(operationsPayload.pending)
          ? operationsPayload.pending
          : [],
        quality: qualityPayload,
      };

      hasLoadedDashboardRef.current = true;
      setData(nextData);
      if (
        dayResult.status === "fulfilled" ||
        salesResult.status === "fulfilled" ||
        inventoryResult.status === "fulfilled"
        || operationsResult.status === "fulfilled"
      ) {
        writeOfflineCache(cacheKey, nextData);
        setLastUpdatedAt(new Date());
      }
      setErrors(nextErrors);
      setLoadState(
        nextErrors.length === 0
          ? "ready"
          : nextErrors.length === 5
            ? "error"
            : "partial",
      );
    },
    [businessDate],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  useEffect(() => {
    if (!autoRefresh) return;

    const refresh = () => {
      if (canRefreshInBackground()) void loadDashboard();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const boardTimer = window.setInterval(
      refresh,
      MANAGEMENT_BOARD_REFRESH_MS,
    );
    const reconcileTimer = window.setInterval(() => {
      if (canRefreshInBackground()) void loadDashboard(true);
    }, SHEETS_RECONCILE_MS);

    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      window.clearInterval(boardTimer);
      window.clearInterval(reconcileTimer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [autoRefresh, loadDashboard]);

  async function submitInventoryAdjustment() {
    const quantityDelta = Number(adjustmentDelta);
    const selectedItem = data.catalog.find(item => item.sku === adjustmentSku);
    if (!selectedItem || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
      setAdjustmentMessage("Бараа болон 0-ээс өөр зөрүү сонгоно уу.");
      return;
    }
    if (!adjustmentReason.trim()) {
      setAdjustmentMessage("Тооллогын тайлбар заавал бичнэ үү.");
      return;
    }
    const fingerprint = JSON.stringify({
      sku: selectedItem.sku,
      quantityDelta,
      reason: adjustmentReason.trim(),
    });
    const pending =
      pendingAdjustmentRef.current?.fingerprint === fingerprint
        ? pendingAdjustmentRef.current
        : { fingerprint, requestId: window.crypto.randomUUID() };
    pendingAdjustmentRef.current = pending;
    setAdjustmentSaving(true);
    setAdjustmentMessage("");
    try {
      const response = await fetchWithTimeout("/api/inventory-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: pending.requestId,
          reason: adjustmentReason.trim(),
          adjustments: [
            {
              sku: selectedItem.sku,
              name: selectedItem.name,
              quantityDelta,
            },
          ],
        }),
      });
      await readJson(response);
      pendingAdjustmentRef.current = null;
      setAdjustmentDelta("");
      setAdjustmentReason("");
      setAdjustmentMessage("Тооллогын тохируулга аудитын мөрөөр хадгалагдлаа.");
      await loadDashboard(true);
    } catch (error) {
      setAdjustmentMessage(
        error instanceof Error ? error.message : "Тохируулга хадгалж чадсангүй.",
      );
    } finally {
      setAdjustmentSaving(false);
    }
  }

  async function repairOrderItems() {
    setQualityRepairing(true);
    setQualityMessage("");
    try {
      const response = await fetchWithTimeout("/api/data-quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessDate }),
      }, 30_000);
      const result = (await readJson(response)) as {
        ordersBackfilled?: number;
        linesBackfilled?: number;
      };
      setQualityMessage(
        `${formatNumber(result.ordersBackfilled ?? 0)} захиалгын ${formatNumber(result.linesBackfilled ?? 0)} барааны мөр нөхөгдлөө.`,
      );
      await loadDashboard(true);
    } catch (error) {
      setQualityMessage(
        error instanceof Error ? error.message : "Нөхөлт хийж чадсангүй.",
      );
    } finally {
      setQualityRepairing(false);
    }
  }

  const unpaidBalance = useMemo(
    () => totalChargeBalance(data.charges),
    [data.charges],
  );
  const lowStockItems = useMemo(
    () =>
      data.catalog
        .filter((item) => typeof item.stock === "number" && item.stock <= 3)
        .sort((first, second) => (first.stock ?? 0) - (second.stock ?? 0))
        .slice(0, 8),
    [data.catalog],
  );
  const topItems = data.itemTotals.slice(0, 6);
  const recentHistory = data.history.slice(0, 8);
  const visibleCharges = data.charges.slice(0, 8);
  const paymentTotal = paymentBreakdownTotal(data.totals);
  const isInitialLoading = loadState === "loading" && !lastUpdatedAt;

  return (
    <div className="min-h-dvh bg-[#f4f6f8] text-[#111827]">
      <header className="border-b border-[#d7dde7] bg-white">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-4 py-4 sm:px-6">
          <Image
            src="/app-icon.svg"
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-lg border border-[#e5eaf1] bg-[#f8fafc] p-2"
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black">Dalai Eej Ops</h1>
            <p className="text-sm font-bold text-[#64748b]">{businessDate}</p>
          </div>

          <nav className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
            <a
              href="/register"
              className="flex h-10 items-center rounded-lg bg-[#111827] px-4 text-sm font-black text-white hover:bg-[#374151]"
            >
              Касс нээх
            </a>
            <button
              type="button"
              onClick={() => void loadDashboard(true)}
              className="h-10 rounded-lg border border-[#cbd5e1] bg-white px-4 text-sm font-black text-[#111827] hover:bg-[#f8fafc]"
            >
              Шинэчлэх
            </button>
            <button
              type="button"
              onClick={() => setAutoRefresh((current) => !current)}
              aria-pressed={autoRefresh}
              className={`h-10 rounded-lg border px-4 text-sm font-black ${
                autoRefresh
                  ? "border-[#bbf7d0] bg-[#ecfdf5] text-[#047857]"
                  : "border-[#cbd5e1] bg-white text-[#475569]"
              }`}
            >
              Авто {autoRefresh ? "асаалттай" : "унтраалттай"}
            </button>
          </nav>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          {isInitialLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Мэдээлэл ачаалж байна" aria-busy="true">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-xl border border-[#e2e8f0] bg-white p-4">
                  <div className="h-3 w-28 rounded bg-[#e2e8f0]" />
                  <div className="mt-5 h-8 w-40 rounded bg-[#e2e8f0]" />
                  <div className="mt-4 h-3 w-32 rounded bg-[#f1f5f9]" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Өдрийн борлуулалт"
                value={formatMNT(data.totals.salesTotal)}
                detail={`Тухайн өдрийн төлөлт ${formatMNT(data.totals.currentSalePaymentTotal)}`}
                tone="green"
              />
              <MetricCard
                label="Төлбөр авсан"
                value={formatMNT(data.totals.paymentTotal)}
                detail={`Хуучин өр ${formatMNT(data.totals.priorDebtCollectedTotal)} · Буцаалт ${formatMNT(data.totals.refundTotal)}`}
              />
              <MetricCard
                label="Хүлээгдэж буй өр"
                value={formatMNT(unpaidBalance)}
                detail={`Өнөөдөр шинээр ${formatMNT(data.totals.newRoomDebtTotal)} · ${formatNumber(data.charges.length)} мөр`}
                tone={unpaidBalance > 0 ? "amber" : "neutral"}
              />
              <MetricCard
                label="Бэлнээр байх"
                value={formatMNT(data.totals.expectedCash)}
                detail={`Эхлэх ${formatMNT(data.session?.startingCash ?? 0)} · Касс ${statusText(data.session)}`}
                tone={data.session?.status?.toLowerCase() === "open" ? "green" : "neutral"}
              />
            </div>
          )}

          {errors.length > 0 && (
            <div className="rounded-lg border border-[#fed7aa] bg-[#fff7ed] px-4 py-3">
              <p className="text-sm font-black text-[#9a3412]">
                {loadState === "error"
                  ? "Мэдээлэл татаж чадсангүй"
                  : "Зарим мэдээлэл шинэчлэгдсэнгүй"}
              </p>
              <div className="mt-2 grid gap-1">
                {errors.map((error) => (
                  <p
                    key={error}
                    className="break-words text-xs font-bold text-[#9a3412]"
                  >
                    {error}
                  </p>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <SectionShell
              title="Өдрийн төлөв"
              action={
                <span className="text-xs font-bold text-[#64748b]">
                  {formatUpdatedAt(lastUpdatedAt)}
                </span>
              }
            >
              <div className="p-4">
                <div
                  className={`inline-flex min-h-9 items-center rounded-lg border px-3 text-sm font-black ${statusClass(data.session)}`}
                >
                  {statusText(data.session)}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-black uppercase tracking-normal text-[#64748b]">
                      Нээсэн
                    </p>
                    <p className="mt-1 truncate text-sm font-black">
                      {data.session?.openedBy || "—"}
                    </p>
                    <p className="mt-1 break-words text-xs font-bold text-[#64748b]">
                      {data.session?.openedAt || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-black uppercase tracking-normal text-[#64748b]">
                      Хаасан
                    </p>
                    <p className="mt-1 truncate text-sm font-black">
                      {data.session?.closedBy || "—"}
                    </p>
                    <p className="mt-1 break-words text-xs font-bold text-[#64748b]">
                      {data.session?.closedAt || "—"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-lg border border-[#e5eaf1]">
                  {[
                    ["Эхлэх бэлэн мөнгө", data.session?.startingCash ?? 0],
                    ["Бэлэн орлого", data.totals.cashPaymentTotal],
                    ["Бэлнээр байх ёстой", data.totals.expectedCash],
                    ["Төлбөрийн нийт дүн", paymentTotal],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="grid min-h-11 grid-cols-[minmax(0,1fr)_132px] items-center border-b border-[#eef2f7] px-3 last:border-b-0"
                    >
                      <span className="truncate text-sm font-bold text-[#475569]">
                        {label}
                      </span>
                      <span className="text-right text-sm font-black tabular-nums">
                        {formatMNT(Number(value))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </SectionShell>

            <SectionShell
              title="Төлөгдөөгүй өр"
              action={
                <a
                  href="/register"
                  className="rounded-lg border border-[#cbd5e1] px-3 py-2 text-xs font-black text-[#111827] hover:bg-[#f8fafc]"
                >
                  Касс
                </a>
              }
            >
              {visibleCharges.length === 0 ? (
                <EmptyState>Хаагдаагүй өр алга.</EmptyState>
              ) : (
                <div className="divide-y divide-[#e5eaf1]">
                  {visibleCharges.map((charge) => (
                    <div
                      key={charge.transactionId}
                      className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_132px]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">
                          {charge.roomOrGuest || charge.transactionId}
                        </p>
                        <p className="mt-1 break-words text-xs font-bold leading-5 text-[#64748b]">
                          {charge.itemSummary || `${charge.itemCount ?? 1} бараа`}
                        </p>
                        <p className="mt-1 truncate text-xs font-bold text-[#94a3b8]">
                          {charge.timestamp} · {charge.staff || "Staff"}
                        </p>
                      </div>
                      <div className="text-left sm:text-right">
                        <p className="text-sm font-black text-[#b45309]">
                          {formatMNT(charge.balance ?? charge.total)}
                        </p>
                        {Number(charge.paidAmount ?? 0) > 0 && (
                          <p className="mt-1 text-xs font-bold text-[#047857]">
                            Төлсөн {formatMNT(charge.paidAmount ?? 0)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionShell>
          </div>

          <SectionShell title="Сүүлийн төлбөрүүд">
            {recentHistory.length === 0 ? (
              <EmptyState>Өнөөдрийн хаагдсан төлбөр алга.</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead className="bg-[#f8fafc] text-left text-xs font-black uppercase tracking-normal text-[#64748b]">
                    <tr>
                      <th className="px-4 py-3">Гүйлгээ</th>
                      <th className="px-4 py-3">Төлбөр</th>
                      <th className="px-4 py-3">Ажилтан</th>
                      <th className="px-4 py-3 text-right">Дүн</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e5eaf1]">
                    {recentHistory.map((sale) => (
                      <tr key={`${sale.transactionId}-${sale.timestamp}`}>
                        <td className="px-4 py-3">
                          <p className="font-black">{sale.transactionId}</p>
                          <p className="mt-1 max-w-[320px] truncate text-xs font-bold text-[#64748b]">
                            {sale.itemSummary || sale.roomOrGuest || sale.timestamp}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="max-w-[220px] truncate font-bold">
                            {sale.paymentMethod || "Төлбөр"}
                          </p>
                          <p className="mt-1 text-xs font-bold text-[#64748b]">
                            {sale.paidStatus === "partial"
                              ? "Хэсэгчилсэн"
                              : sale.historyKind === "payment"
                                ? "Өр төлөлт"
                                : "Борлуулалт"}
                          </p>
                        </td>
                        <td className="px-4 py-3 font-bold">
                          {sale.staff || "Staff"}
                        </td>
                        <td className="px-4 py-3 text-right font-black">
                          {formatMNT(sale.paidAmount ?? sale.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionShell>
        </div>

        <aside className="grid min-w-0 content-start gap-4">
          <SectionShell
            title="Өгөгдлийн чанар"
            action={
              <span
                className={`text-xs font-black ${
                  data.quality?.status === "healthy"
                    ? "text-[#047857]"
                    : "text-[#b45309]"
                }`}
              >
                {data.quality
                  ? `${formatNumber(data.quality.summary.coveragePercent)}%`
                  : "—"}
              </span>
            }
          >
            {!data.quality ? (
              <EmptyState>Өгөгдлийн шалгалт хараахан ажиллаагүй.</EmptyState>
            ) : (
              <div className="p-4">
                <div
                  className={`rounded-lg border px-3 py-3 ${
                    data.quality.status === "healthy"
                      ? "border-[#bbf7d0] bg-[#f3fff8]"
                      : "border-[#fed7aa] bg-[#fffaf0]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-black">
                      {data.quality.status === "healthy"
                        ? "Шалгалт цэвэр"
                        : `${formatNumber(data.quality.summary.issueCount)} асуудал`}
                    </p>
                    <p className="text-xs font-black text-[#64748b]">
                      {formatNumber(data.quality.summary.normalizedOrders)}/
                      {formatNumber(data.quality.summary.salesOrders)} захиалга
                    </p>
                  </div>
                </div>

                <div className="mt-3 divide-y divide-[#e5eaf1] rounded-lg border border-[#e5eaf1]">
                  {data.quality.checks.map(check => (
                    <div
                      key={check.id}
                      className="grid grid-cols-[minmax(0,1fr)_48px] gap-3 px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-[#334155]">
                          {check.label}
                        </p>
                        <p className="mt-1 break-words text-[11px] font-bold leading-4 text-[#94a3b8]">
                          {check.detail}
                        </p>
                      </div>
                      <span
                        className={`text-right text-sm font-black ${
                          check.count === 0
                            ? "text-[#047857]"
                            : check.severity === "error"
                              ? "text-[#b91c1c]"
                              : "text-[#b45309]"
                        }`}
                      >
                        {formatNumber(check.count)}
                      </span>
                    </div>
                  ))}
                </div>

                {data.quality.summary.repairableOrders > 0 && (
                  <button
                    type="button"
                    disabled={qualityRepairing}
                    onClick={() => void repairOrderItems()}
                    className="mt-3 h-11 w-full rounded-lg bg-[#111827] px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {qualityRepairing
                      ? "Нөхөж байна…"
                      : `${formatNumber(data.quality.summary.repairableOrders)} захиалгыг нөхөх`}
                  </button>
                )}
                {qualityMessage && (
                  <p className="mt-3 break-words text-xs font-bold leading-5 text-[#64748b]">
                    {qualityMessage}
                  </p>
                )}
                <p className="mt-3 text-[11px] font-bold leading-4 text-[#94a3b8]">
                  Бүх түүхэн Dalai Eej Ops өгөгдлийг шалгана. Нөхөлт нь зөвхөн Order_Items-д мөр нэмнэ; Master Ledger-д бичихгүй.
                </p>
              </div>
            )}
          </SectionShell>

          <SectionShell title="Бараа материал">
            <div className="p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-[#e5eaf1] px-3 py-3">
                  <p className="text-xs font-black uppercase tracking-normal text-[#64748b]">
                    Каталог
                  </p>
                  <p className="mt-2 text-2xl font-black">
                    {formatNumber(data.catalog.length)}
                  </p>
                </div>
                <div className="rounded-lg border border-[#fecaca] bg-[#fff7f7] px-3 py-3">
                  <p className="text-xs font-black uppercase tracking-normal text-[#991b1b]">
                    Бага үлдэгдэл
                  </p>
                  <p className="mt-2 text-2xl font-black text-[#991b1b]">
                    {formatNumber(lowStockItems.length)}
                  </p>
                </div>
              </div>

              <div className="mt-4 divide-y divide-[#e5eaf1] rounded-lg border border-[#e5eaf1]">
                {lowStockItems.length === 0 ? (
                  <div className="px-3 py-5 text-center text-sm font-bold text-[#64748b]">
                    Бага үлдэгдэлтэй бараа алга.
                  </div>
                ) : (
                  lowStockItems.map((item) => (
                    <div
                      key={item.sku}
                      className="grid min-h-12 grid-cols-[minmax(0,1fr)_52px] items-center gap-3 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black">
                          {item.name}
                        </p>
                        <p className="truncate text-xs font-bold text-[#64748b]">
                          {item.sku} · {item.category || "Ангилалгүй"}
                        </p>
                      </div>
                      <span className="text-right text-sm font-black text-[#b91c1c]">
                        {formatNumber(item.stock ?? 0)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </SectionShell>

          <SectionShell
            title="Дуусаагүй ажиллагаа"
            action={
              <span className={`text-xs font-black ${data.pendingOperations.length > 0 ? "text-[#b45309]" : "text-[#047857]"}`}>
                {formatNumber(data.pendingOperations.length)}
              </span>
            }
          >
            {data.pendingOperations.length === 0 ? (
              <EmptyState>Гацсан эсвэл хүлээгдэж буй ажиллагаа алга.</EmptyState>
            ) : (
              <div className="divide-y divide-[#e5eaf1]">
                {data.pendingOperations.slice(0, 10).map(operation => (
                  <div key={`${operation.type}-${operation.requestId}-${operation.resourceId}`} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-black">
                        {operation.resourceId || operation.requestId || operation.type}
                      </p>
                      <span className="rounded bg-[#fff7ed] px-2 py-1 text-[11px] font-black text-[#b45309]">
                        {operation.type}
                      </span>
                    </div>
                    <p className="mt-1 break-words text-xs font-bold text-[#64748b]">
                      {operation.businessDate || "Огноогүй"} · {operation.actor || "Тодорхойгүй"}
                    </p>
                    <p className="mt-1 text-xs font-bold text-[#94a3b8]">
                      {operation.recoverable
                        ? "Ижил Save хүсэлтээр автоматаар үргэлжлүүлнэ"
                        : "Менежер гараар шалгана"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </SectionShell>

          <SectionShell title="Барааны тооллогын тохируулга">
            <div className="grid gap-3 p-4">
              <label className="grid gap-1 text-xs font-black text-[#475569]">
                Бараа
                <select
                  value={adjustmentSku}
                  onChange={event => setAdjustmentSku(event.target.value)}
                  className="h-11 rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-bold text-[#111827]"
                >
                  <option value="">Сонгох</option>
                  {data.catalog.map(item => (
                    <option key={item.sku} value={item.sku}>
                      {item.name} ({item.sku}) · {formatNumber(item.stock ?? 0)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs font-black text-[#475569]">
                Зөрүү (+ нэмнэ, − хасна)
                <input
                  type="number"
                  step="1"
                  value={adjustmentDelta}
                  onChange={event => setAdjustmentDelta(event.target.value)}
                  className="h-11 rounded-lg border border-[#cbd5e1] px-3 text-sm font-bold text-[#111827]"
                />
              </label>
              <label className="grid gap-1 text-xs font-black text-[#475569]">
                Тооллогын тайлбар
                <input
                  value={adjustmentReason}
                  onChange={event => setAdjustmentReason(event.target.value)}
                  placeholder="Жишээ: 2026.08.17 биечлэн тоолсон"
                  className="h-11 rounded-lg border border-[#cbd5e1] px-3 text-sm font-bold text-[#111827]"
                />
              </label>
              <button
                type="button"
                disabled={adjustmentSaving}
                onClick={() => void submitInventoryAdjustment()}
                className="h-11 rounded-lg bg-[#111827] px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {adjustmentSaving ? "Хадгалж байна…" : "Аудитын мөр хадгалах"}
              </button>
              {adjustmentMessage && (
                <p className="break-words text-xs font-bold text-[#64748b]">
                  {adjustmentMessage}
                </p>
              )}
              <p className="text-xs font-bold leading-5 text-[#94a3b8]">
                Каталогийн тоог шууд дарж өөрчлөхгүй; засвар бүр Inventory_Log-д нэр, шалтгаан, хүсэлтийн ID-тай хадгалагдана.
              </p>
            </div>
          </SectionShell>

          <SectionShell title="Топ зарагдсан">
            {topItems.length === 0 ? (
              <EmptyState>Өдрийн барааны дүн алга.</EmptyState>
            ) : (
              <div className="divide-y divide-[#e5eaf1]">
                {topItems.map((item, index) => (
                  <div
                    key={item.name}
                    className="grid min-h-14 grid-cols-[32px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-2"
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
          </SectionShell>

          <SectionShell title="Ажиллагаа">
            <div className="grid gap-2 p-4">
              <a
                href="/register"
                className="flex min-h-12 items-center justify-between rounded-lg border border-[#111827] bg-[#111827] px-3 text-sm font-black text-white hover:bg-[#374151]"
              >
                <span>Касс ажиллуулах</span>
                <span aria-hidden="true">›</span>
              </a>
              <a
                href="/register"
                className="flex min-h-12 items-center justify-between rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-black text-[#111827] hover:bg-[#f8fafc]"
              >
                <span>Өр хаах</span>
                <span aria-hidden="true">›</span>
              </a>
              <a
                href="/register"
                className="flex min-h-12 items-center justify-between rounded-lg border border-[#cbd5e1] bg-white px-3 text-sm font-black text-[#111827] hover:bg-[#f8fafc]"
              >
                <span>Өдрийн хаалт</span>
                <span aria-hidden="true">›</span>
              </a>
            </div>
          </SectionShell>
        </aside>
      </main>
    </div>
  );
}

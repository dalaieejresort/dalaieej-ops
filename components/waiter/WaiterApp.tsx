"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../service/Service.module.css";
import { useRouter } from "next/navigation";
import { canRefreshInBackground, fetchWithTimeout } from "@/lib/client/network";
import type { LiveOrdersResponse } from "@/lib/live-order-types";
import type { PriceMode } from "@/lib/pos/types";
import { formatMNT, formatNumber } from "@/lib/pos/utils";

type CatalogItem = {
  sku: string;
  name: string;
  category?: string;
  price: number;
  guestPrice?: number;
  staffPrice?: number;
  stock?: number;
};

type OrderItem = {
  sku: string;
  name: string;
  category: string;
  qty: number;
  unitPrice: number;
  priceMode?: PriceMode;
};

type OpenOrder = {
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
  items?: OrderItem[];
};

type DaySession = {
  status?: string;
  openedAt?: string;
};

type WaiterTab = "new" | "open";
type SaveStatus = "idle" | "saving" | "success" | "error";

type WaiterAppProps = {
  businessDate: string;
  authenticatedStaffName: string;
};

const OVERVIEW_REFRESH_MS = 3 * 60 * 1000;
const LIVE_ORDER_REFRESH_MS = 15 * 1000;
const MUTATION_TIMEOUT_MS = 30000;
const QUICK_REFERENCES = Array.from({ length: 18 }, (_, index) => String(index + 1));

function errorMessage(payload: unknown, fallback: string) {
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
  if (!response.ok) throw new Error(errorMessage(payload, response.statusText));
  return payload;
}

function displayDate(value: string) {
  return value.replaceAll("-", ".");
}

function displayTime(value: string) {
  const time = value.match(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/i)?.[0];
  return time ?? value;
}

function normalizeLiveOrders(payload: LiveOrdersResponse) {
  return payload.orders.map((order) => ({
    ...order,
    items: order.items?.map((item) => ({
      sku: item.sku ?? "",
      name: item.name,
      category: item.category ?? "Үйлчилгээ",
      qty: item.qty,
      unitPrice: item.unitPrice,
      priceMode: item.priceMode,
    })),
  })) satisfies OpenOrder[];
}

function makeRequestKey(fingerprint: string, current: { id: string; fingerprint: string } | null) {
  return current?.fingerprint === fingerprint
    ? current
    : { id: crypto.randomUUID(), fingerprint };
}

export function WaiterApp({
  businessDate,
  authenticatedStaffName,
}: WaiterAppProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<WaiterTab>("new");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [session, setSession] = useState<DaySession | null>(null);
  const [cart, setCart] = useState<OrderItem[]>([]);
  const [reference, setReference] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("Бүгд");
  const [showCart, setShowCart] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [loadingOverview, setLoadingOverview] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadMessage, setLoadMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const pendingRequest = useRef<{ id: string; fingerprint: string } | null>(null);

  const dayOpen = session?.status?.toLowerCase() === "open";
  const categories = useMemo(
    () => [
      "Бүгд",
      ...Array.from(
        new Set(catalog.map((item) => item.category?.trim()).filter(Boolean) as string[]),
      ),
    ],
    [catalog],
  );
  const filteredCatalog = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("mn-MN");
    return catalog.filter((item) => {
      const categoryMatches = category === "Бүгд" || item.category === category;
      const searchMatches =
        !needle ||
        item.name.toLocaleLowerCase("mn-MN").includes(needle) ||
        item.sku.toLocaleLowerCase("mn-MN").includes(needle);
      return categoryMatches && searchMatches;
    });
  }, [catalog, category, search]);
  const cartQuantity = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty, 0),
    [cart],
  );
  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.qty * item.unitPrice, 0),
    [cart],
  );
  const cartQuantities = useMemo(
    () => new Map(cart.map((item) => [item.sku, item.qty])),
    [cart],
  );
  const myOrderCount = useMemo(
    () => orders.filter((order) => order.staff === authenticatedStaffName).length,
    [authenticatedStaffName, orders],
  );

  const loadCatalog = useCallback(async () => {
    try {
      const payload = await fetchWithTimeout("/api/inventory", {
        cache: "no-store",
      }).then(readJson);
      if (!Array.isArray(payload)) throw new Error("Барааны жагсаалт буруу байна.");
      setCatalog(payload as CatalogItem[]);
      setLoadMessage("");
    } catch (error) {
      setLoadMessage(error instanceof Error ? error.message : "Бараа татаж чадсангүй.");
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const loadOpenOrders = useCallback(
    async (fresh = false) => {
      if (!fresh) {
        try {
          const liveResponse = await fetchWithTimeout("/api/live-orders", {
            cache: "no-store",
          });
          const livePayload = (await liveResponse.json().catch(() => null)) as
            | LiveOrdersResponse
            | { error?: string }
            | null;
          if (
            liveResponse.ok &&
            livePayload &&
            "initialized" in livePayload &&
            livePayload.initialized
          ) {
            return Array.isArray(livePayload.orders)
              ? normalizeLiveOrders(livePayload)
              : [];
          }
        } catch {
          // The authoritative Sheets response below remains the fallback.
        }
      }

      const salesParams = new URLSearchParams({ businessDate });
      if (fresh) salesParams.set("fresh", "1");
      const payload = await fetchWithTimeout(
        `/api/sales?${salesParams.toString()}`,
        { cache: "no-store" },
      ).then(readJson);
      const salesPayload = payload as { charges?: OpenOrder[] };
      return Array.isArray(salesPayload.charges) ? salesPayload.charges : [];
    },
    [businessDate],
  );

  const syncLiveOrders = useCallback(async () => {
    try {
      const response = await fetchWithTimeout("/api/live-orders", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        | LiveOrdersResponse
        | null;
      if (response.ok && payload?.initialized && Array.isArray(payload.orders)) {
        setOrders(normalizeLiveOrders(payload));
      }
    } catch {
      // The slower scheduled overview refresh keeps Sheets as the fallback.
    }
  }, []);

  const loadOverview = useCallback(
    async (fresh = false) => {
      const params = new URLSearchParams({ businessDate, sessionOnly: "1" });
      if (fresh) params.set("fresh", "1");
      const [dayResult, salesResult] = await Promise.allSettled([
        fetchWithTimeout(`/api/day?${params.toString()}`, {
          cache: "no-store",
        }).then(readJson),
        loadOpenOrders(fresh),
      ]);

      const messages: string[] = [];
      if (dayResult.status === "fulfilled") {
        const payload = dayResult.value as { session?: DaySession | null };
        setSession(payload.session ?? null);
      } else {
        messages.push(dayResult.reason instanceof Error ? dayResult.reason.message : "Өдрийн төлөв татсангүй.");
      }

      if (salesResult.status === "fulfilled") {
        setOrders(salesResult.value);
      } else {
        messages.push(salesResult.reason instanceof Error ? salesResult.reason.message : "Захиалга татсангүй.");
      }

      if (messages.length > 0) setLoadMessage(messages.join(" "));
      else setLoadMessage("");
      setLoadingOverview(false);
    },
    [businessDate, loadOpenOrders],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void Promise.all([loadCatalog(), loadOverview()]);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [loadCatalog, loadOverview]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (canRefreshInBackground()) void loadOverview();
    }, OVERVIEW_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [loadOverview]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (canRefreshInBackground()) void syncLiveOrders();
    }, LIVE_ORDER_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [syncLiveOrders]);

  function resetSaveMessage() {
    if (saveStatus !== "saving") {
      setSaveStatus("idle");
      setSaveMessage("");
    }
  }

  function addItem(item: CatalogItem) {
    const unitPrice = item.guestPrice ?? item.price;
    setCart((current) => {
      const existing = current.find((line) => line.sku === item.sku);
      if (existing) {
        return current.map((line) =>
          line.sku === item.sku ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [
        ...current,
        {
          sku: item.sku,
          name: item.name,
          category: item.category?.trim() || "Үйлчилгээ",
          qty: 1,
          unitPrice,
          priceMode: "guest",
        },
      ];
    });
    pendingRequest.current = null;
    resetSaveMessage();
  }

  function changeQuantity(sku: string, difference: number) {
    setCart((current) =>
      current
        .map((item) =>
          item.sku === sku ? { ...item, qty: item.qty + difference } : item,
        )
        .filter((item) => item.qty > 0),
    );
    pendingRequest.current = null;
    resetSaveMessage();
  }

  function clearDraft() {
    setCart([]);
    setReference("");
    setEditingTransactionId(null);
    setShowCart(false);
    pendingRequest.current = null;
  }

  function startNewOrder() {
    clearDraft();
    setSaveStatus("idle");
    setSaveMessage("");
    setActiveTab("new");
  }

  function editOrder(order: OpenOrder) {
    if (order.staff !== authenticatedStaffName) {
      setSaveStatus("error");
      setSaveMessage("Та зөвхөн өөрийн оруулсан захиалгыг засна.");
      return;
    }
    if (Number(order.paidAmount ?? 0) > 0) {
      setSaveStatus("error");
      setSaveMessage("Хэсэгчлэн төлсөн захиалгыг касс дээр засна.");
      return;
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      setSaveStatus("error");
      setSaveMessage("Энэ захиалгын барааны мэдээлэл дутуу байна. Кассчинд хэлнэ үү.");
      return;
    }
    setCart(order.items);
    setReference(order.roomOrGuest);
    setEditingTransactionId(order.transactionId);
    setActiveTab("new");
    setShowCart(false);
    setSaveStatus("idle");
    setSaveMessage("");
    pendingRequest.current = null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitOrder() {
    const trimmedReference = reference.trim();
    if (!dayOpen) {
      setSaveStatus("error");
      setSaveMessage("Кассчин өдрийг нээсний дараа захиалга илгээнэ.");
      return;
    }
    if (!trimmedReference) {
      setSaveStatus("error");
      setSaveMessage("Ширээ, байшин эсвэл зочны нэрийг оруулна уу.");
      return;
    }
    if (cart.length === 0 || cartTotal <= 0) {
      setSaveStatus("error");
      setSaveMessage("Захиалгад бараа нэмнэ үү.");
      return;
    }

    const body = editingTransactionId
      ? {
          action: "edit_unpaid",
          transactionId: editingTransactionId,
          room: trimmedReference,
          items: cart,
          total: cartTotal,
        }
      : {
          items: cart,
          method: "Байшин/Зочин",
          room: trimmedReference,
          staffName: authenticatedStaffName,
          paidStatus: "unpaid",
          total: cartTotal,
          payments: [],
          cashReceived: 0,
          changeDue: 0,
        };
    const fingerprint = JSON.stringify(body);
    const requestKey = makeRequestKey(fingerprint, pendingRequest.current);
    pendingRequest.current = requestKey;

    setSaveStatus("saving");
    setSaveMessage(editingTransactionId ? "Захиалгыг шинэчилж байна…" : "Захиалгыг илгээж байна…");
    try {
      const response = await fetchWithTimeout(
        editingTransactionId ? "/api/sales" : "/api/inventory",
        {
          method: editingTransactionId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, clientRequestId: requestKey.id }),
        },
        MUTATION_TIMEOUT_MS,
      );
      const payload = (await response.json().catch(() => null)) as
        | { transactionId?: string; orderId?: string; error?: string }
        | null;
      if (!response.ok) throw new Error(errorMessage(payload, "Захиалга хадгалж чадсангүй."));

      const orderId = payload?.orderId ?? payload?.transactionId ?? editingTransactionId ?? "";
      clearDraft();
      setSaveStatus("success");
      setSaveMessage(`${orderId || "Захиалга"} амжилттай илгээгдлээ.`);
      setActiveTab("open");
      await loadOverview(true);
    } catch (error) {
      setSaveStatus("error");
      setSaveMessage(
        error instanceof Error && error.name === "AbortError"
          ? "30 секундэд хариу ирсэнгүй. Дахин дарахад ижил хүсэлтийг аюулгүй шалгана."
          : error instanceof Error
            ? error.message
            : "Захиалга хадгалж чадсангүй.",
      );
    }
  }

  async function refreshOverview() {
    setRefreshing(true);
    await loadOverview(true);
    setRefreshing(false);
  }

  async function logOut() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className={`${styles.screen} ${styles.waiter}`}>
      <div className={styles.topbar}><span>Dalai Eej</span><span>Зөөгч · {displayDate(businessDate)}</span></div>
      <header className={styles.waiterHeader}>
        <div className="flex max-w-3xl flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-normal  text-black">
              Dalai Eej · Зөөгч
            </p>
            <h1 className="truncate text-xl font-normal">{authenticatedStaffName}</h1>
            <p className="mt-0.5 text-xs font-normal text-[#666666]">
              {displayDate(businessDate)} · зөвхөн захиалга
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-none border px-2.5 py-1.5 text-xs font-normal ${
                dayOpen
                  ? "border-[#8c8c8c] bg-white text-black"
                  : "border-[#8c8c8c] bg-white text-black"
              }`}
            >
              {loadingOverview ? "Шалгаж байна…" : dayOpen ? "Өдөр нээлттэй" : "Өдөр хаалттай"}
            </span>
            <button
              type="button"
              onClick={() => void logOut()}
              disabled={loggingOut}
              className="min-h-10 rounded-none border border-[#8c8c8c] bg-white px-3 text-xs font-normal text-black disabled:opacity-50"
            >
              Гарах
            </button>
          </div>
        </div>
      </header>

      <div className={styles.waiterContent}>
        {loadMessage && (
          <div className="mb-3 rounded-none border border-[#8c8c8c] bg-white px-4 py-3 text-sm font-normal text-black">
            {loadMessage}
          </div>
        )}
        {saveMessage && (
          <div
            className={`mb-3 rounded-none border px-4 py-3 text-sm font-normal ${
              saveStatus === "error"
                ? "border-[#8c8c8c] bg-white text-black"
                : "border-[#8c8c8c] bg-white text-black"
            }`}
          >
            {saveMessage}
          </div>
        )}

        {activeTab === "new" ? (
          <div className="space-y-4">
            {editingTransactionId && (
              <div className="flex items-center justify-between gap-3 rounded-none border border-[#8c8c8c] bg-white px-4 py-3 text-sm font-normal text-black">
                <span className="min-w-0 truncate">Засаж байна: {editingTransactionId}</span>
                <button type="button" onClick={startNewOrder} className="shrink-0 underline">
                  Цуцлах
                </button>
              </div>
            )}

            <section className="rounded-none border border-[#8c8c8c] bg-white p-4 shadow-none">
              <label htmlFor="waiter-reference" className="text-sm font-normal">
                Ширээ / байшин / зочин
              </label>
              <input
                id="waiter-reference"
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
                  pendingRequest.current = null;
                  resetSaveMessage();
                }}
                placeholder="Жишээ: Ширээ 4"
                autoComplete="off"
                className="mt-2 min-h-14 w-full rounded-none border-2 border-[#8c8c8c] bg-white px-4 text-lg font-normal outline-none focus:border-black"
              />
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {QUICK_REFERENCES.map((value) => {
                  const label = `Ширээ ${value}`;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setReference(label);
                        pendingRequest.current = null;
                        resetSaveMessage();
                      }}
                      className={`min-h-11 min-w-12 shrink-0 rounded-none border px-3 text-sm font-normal ${
                        reference === label
                          ? "border-[#8c8c8c] bg-[#f0f0f0] text-black"
                          : "border-[#8c8c8c] bg-white text-black"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className={styles.catalogTools}>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  aria-label="Бараа хайх"
                  placeholder="Бараа хайх…"
                  type="search"
                  className="min-h-12 w-full rounded-none border border-[#8c8c8c] bg-white px-4 text-base font-normal outline-none focus:border-black"
                />
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {categories.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={`min-h-10 shrink-0 rounded-none px-4 text-sm font-normal ${
                        category === value
                          ? "bg-[#f0f0f0] text-black"
                          : "border border-[#8c8c8c] bg-white text-black"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              {loadingCatalog ? (
                <div className="grid grid-cols-2 gap-0 pt-2">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="h-32 animate-pulse rounded-none bg-white" />
                  ))}
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="mt-3 rounded-none border border-dashed border-[#8c8c8c] bg-white px-4 py-10 text-center text-sm font-normal text-[#666666]">
                  Тохирох бараа олдсонгүй.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-0 pt-2 sm:grid-cols-3">
                  {filteredCatalog.map((item) => {
                    const quantity = cartQuantities.get(item.sku) ?? 0;
                    return (
                      <button
                        key={item.sku}
                        type="button"
                        onClick={() => addItem(item)}
                        data-testid="waiter-product" className="relative flex min-h-32 flex-col justify-between rounded-none border border-[#8c8c8c] bg-white p-3 text-left shadow-none active:bg-white"
                      >
                        {quantity > 0 && (
                          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-none bg-white px-2 text-xs font-normal text-black">
                            {formatNumber(quantity)}
                          </span>
                        )}
                        <span className="pr-8 text-sm font-normal leading-tight">{item.name}</span>
                        <span>
                          <span className="block text-[11px] font-normal text-[#666666]">
                            {item.category || "Үйлчилгээ"}
                          </span>
                          <span className="mt-1 block text-base font-normal text-black">
                            {formatMNT(item.guestPrice ?? item.price)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-xl font-normal">Нээлттэй захиалга</h2>
                <p className="text-xs font-normal text-[#666666]">
                  Миний {formatNumber(myOrderCount)} · Нийт {formatNumber(orders.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshOverview()}
                disabled={refreshing}
                className="min-h-11 rounded-none border border-[#8c8c8c] bg-white px-4 text-sm font-normal text-black disabled:opacity-50"
              >
                {refreshing ? "Шинэчилж…" : "Шинэчлэх"}
              </button>
            </div>

            {loadingOverview ? (
              <div className="h-36 animate-pulse rounded-none bg-white" />
            ) : orders.length === 0 ? (
              <div className="rounded-none border border-dashed border-[#8c8c8c] bg-white px-5 py-14 text-center">
                <p className="text-lg font-normal">Нээлттэй захиалга алга</p>
                <p className="mt-1 text-sm font-normal text-[#666666]">Шинэ захиалга шууд энд харагдана.</p>
              </div>
            ) : (
              orders.map((order) => {
                const mine = order.staff === authenticatedStaffName;
                const editable = mine && Number(order.paidAmount ?? 0) <= 0;
                return (
                  <article
                    key={order.transactionId}
                    className={`rounded-none border bg-white p-4 shadow-none ${
                      mine ? "border-[#8c8c8c]" : "border-[#8c8c8c]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-normal">{order.roomOrGuest || "Нэргүй"}</h3>
                          {mine && (
                            <span className="rounded-none bg-white px-2 py-1 text-[11px] font-normal text-black">
                              Миний
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-normal text-[#666666]">
                          {order.staff} · {displayTime(order.timestamp)}
                        </p>
                      </div>
                      <p className="shrink-0 text-lg font-normal text-black">
                        {formatMNT(order.balance ?? order.total)}
                      </p>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm font-normal leading-relaxed text-[#666666]">
                      {order.itemSummary || `${formatNumber(order.itemCount ?? 0)} бараа`}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#8c8c8c] pt-3">
                      <span className="truncate text-[11px] font-normal text-[#666666]">
                        {order.transactionId}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => editOrder(order)}
                          className="min-h-11 shrink-0 rounded-none bg-white px-4 text-sm font-normal text-black"
                        >
                          Нэмэх / засах
                        </button>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </section>
        )}
      </div>

      {activeTab === "new" && cartQuantity > 0 && (
        <button
          type="button"
          onClick={() => setShowCart(true)}
          className={styles.cartSummary}
        >
          <span>
            <span className="block text-xs font-normal opacity-80">{formatNumber(cartQuantity)} бараа</span>
            <span className="block text-lg font-normal">Сагс харах</span>
          </span>
          <span className="text-lg font-normal">{formatMNT(cartTotal)}</span>
        </button>
      )}

      <nav aria-label="Зөөгчийн цэс" className={styles.waiterNav}>
        <div className="grid grid-cols-2">
          <button
            type="button"
            aria-pressed={activeTab === "new"}
            onClick={() => setActiveTab("new")}
            className={`min-h-14 rounded-none text-sm font-normal ${
              activeTab === "new" ? "bg-[#f0f0f0] text-black" : "text-black"
            }`}
          >
            01 · Шинэ захиалга {cartQuantity > 0 ? `· ${formatNumber(cartQuantity)}` : ""}
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "open"}
            onClick={() => setActiveTab("open")}
            className={`min-h-14 rounded-none text-sm font-normal ${
              activeTab === "open" ? "bg-[#f0f0f0] text-black" : "text-black"
            }`}
          >
            02 · Нээлттэй · {formatNumber(orders.length)}
          </button>
        </div>
      </nav>

      {showCart && (
        <div className={styles.cartPanel}>
          <header className="flex items-center justify-between border-b border-[#8c8c8c] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-black">
            <div>
              <p className="text-xs font-normal text-black">{reference.trim() || "Ширээ сонгоогүй"}</p>
              <h2 className="text-xl font-normal">{editingTransactionId ? "Захиалга засах" : "Захиалгын сагс"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowCart(false)}
              className="min-h-11 rounded-none border border-[#8c8c8c] bg-white px-4 text-sm font-normal text-black"
            >
              Буцах
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {cart.map((item) => (
              <div key={item.sku} className="rounded-none border border-[#8c8c8c] bg-white p-4 shadow-none">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-normal">{item.name}</p>
                    <p className="mt-1 text-xs font-normal text-[#666666]">{formatMNT(item.unitPrice)} / нэгж</p>
                  </div>
                  <p className="shrink-0 font-normal">{formatMNT(item.qty * item.unitPrice)}</p>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`${item.name} нэгээр хасах`}
                    onClick={() => changeQuantity(item.sku, -1)}
                    className="h-12 w-12 rounded-none border border-[#8c8c8c] bg-white text-2xl font-normal"
                  >
                    −
                  </button>
                  <span className="flex h-12 min-w-14 items-center justify-center rounded-none bg-white px-3 text-lg font-normal">
                    {formatNumber(item.qty)}
                  </span>
                  <button
                    type="button"
                    aria-label={`${item.name} нэгээр нэмэх`}
                    onClick={() => changeQuantity(item.sku, 1)}
                    className="h-12 w-12 rounded-none bg-white text-2xl font-normal text-black"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <footer className="border-t border-[#8c8c8c] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {saveMessage && (
              <p className={`mb-3 text-sm font-normal ${saveStatus === "error" ? "text-black" : "text-black"}`}>
                {saveMessage}
              </p>
            )}
            <div className="mb-3 flex items-end justify-between gap-3">
              <span className="text-sm font-normal text-[#666666]">Нийт · {formatNumber(cartQuantity)} бараа</span>
              <span className="text-2xl font-normal">{formatMNT(cartTotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => void submitOrder()}
              disabled={saveStatus === "saving" || cart.length === 0 || !dayOpen}
              className={styles.primary}
            >
              {saveStatus === "saving"
                ? "Илгээж байна…"
                : editingTransactionId
                  ? "Захиалгыг шинэчлэх"
                  : "Захиалга илгээх"}
            </button>
            <p className="mt-2 text-center text-xs font-normal text-[#666666]">
              Төлбөр авахгүй · кассын нээлттэй захиалгад орно
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}

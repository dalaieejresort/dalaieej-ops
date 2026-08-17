"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canRefreshInBackground, fetchWithTimeout } from "@/lib/client/network";
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

  const loadOverview = useCallback(
    async () => {
      const params = new URLSearchParams({ businessDate, sessionOnly: "1" });
      const salesParams = new URLSearchParams({ businessDate });
      const [dayResult, salesResult] = await Promise.allSettled([
        fetchWithTimeout(`/api/day?${params.toString()}`, {
          cache: "no-store",
        }).then(readJson),
        fetchWithTimeout(`/api/sales?${salesParams.toString()}`, {
          cache: "no-store",
        }).then(readJson),
      ]);

      const messages: string[] = [];
      if (dayResult.status === "fulfilled") {
        const payload = dayResult.value as { session?: DaySession | null };
        setSession(payload.session ?? null);
      } else {
        messages.push(dayResult.reason instanceof Error ? dayResult.reason.message : "Өдрийн төлөв татсангүй.");
      }

      if (salesResult.status === "fulfilled") {
        const payload = salesResult.value as { charges?: OpenOrder[] };
        setOrders(Array.isArray(payload.charges) ? payload.charges : []);
      } else {
        messages.push(salesResult.reason instanceof Error ? salesResult.reason.message : "Захиалга татсангүй.");
      }

      if (messages.length > 0) setLoadMessage(messages.join(" "));
      else setLoadMessage("");
      setLoadingOverview(false);
    },
    [businessDate],
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
      await loadOverview();
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
    await loadOverview();
    setRefreshing(false);
  }

  async function logOut() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="min-h-dvh bg-[#f3f6f4] pb-32 text-[#17211c]">
      <header className="sticky top-0 z-40 border-b border-[#dbe5df] bg-white/95 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#15803d]">
              Dalai Eej · Зөөгч
            </p>
            <h1 className="truncate text-xl font-black">{authenticatedStaffName}</h1>
            <p className="mt-0.5 text-xs font-bold text-[#64748b]">
              {displayDate(businessDate)} · зөвхөн захиалга
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2.5 py-1.5 text-xs font-black ${
                dayOpen
                  ? "border-[#86efac] bg-[#ecfdf5] text-[#047857]"
                  : "border-[#fdba74] bg-[#fff7ed] text-[#c2410c]"
              }`}
            >
              {loadingOverview ? "Шалгаж байна…" : dayOpen ? "Өдөр нээлттэй" : "Өдөр хаалттай"}
            </span>
            <button
              type="button"
              onClick={() => void logOut()}
              disabled={loggingOut}
              className="min-h-10 rounded-xl border border-[#cbd5e1] bg-white px-3 text-xs font-black text-[#475569] disabled:opacity-50"
            >
              Гарах
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-3 py-4">
        {loadMessage && (
          <div className="mb-3 rounded-2xl border border-[#fed7aa] bg-[#fff7ed] px-4 py-3 text-sm font-bold text-[#9a3412]">
            {loadMessage}
          </div>
        )}
        {saveMessage && (
          <div
            className={`mb-3 rounded-2xl border px-4 py-3 text-sm font-bold ${
              saveStatus === "error"
                ? "border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]"
                : "border-[#bbf7d0] bg-[#f0fdf4] text-[#047857]"
            }`}
          >
            {saveMessage}
          </div>
        )}

        {activeTab === "new" ? (
          <div className="space-y-4">
            {editingTransactionId && (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] px-4 py-3 text-sm font-bold text-[#1d4ed8]">
                <span className="min-w-0 truncate">Засаж байна: {editingTransactionId}</span>
                <button type="button" onClick={startNewOrder} className="shrink-0 underline">
                  Цуцлах
                </button>
              </div>
            )}

            <section className="rounded-3xl border border-[#dbe5df] bg-white p-4 shadow-sm">
              <label htmlFor="waiter-reference" className="text-sm font-black">
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
                className="mt-2 min-h-14 w-full rounded-2xl border-2 border-[#cbd5e1] bg-[#f8fafc] px-4 text-lg font-black outline-none focus:border-[#16a34a] focus:bg-white"
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
                      className={`min-h-11 min-w-12 shrink-0 rounded-xl border px-3 text-sm font-black ${
                        reference === label
                          ? "border-[#16a34a] bg-[#dcfce7] text-[#166534]"
                          : "border-[#dbe5df] bg-white text-[#475569]"
                      }`}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="sticky top-[5.7rem] z-30 -mx-3 space-y-2 bg-[#f3f6f4]/95 px-3 py-2 backdrop-blur">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Бараа хайх…"
                  type="search"
                  className="min-h-12 w-full rounded-2xl border border-[#cbd5e1] bg-white px-4 text-base font-bold outline-none focus:border-[#16a34a]"
                />
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {categories.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setCategory(value)}
                      className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-black ${
                        category === value
                          ? "bg-[#17211c] text-white"
                          : "border border-[#dbe5df] bg-white text-[#475569]"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>

              {loadingCatalog ? (
                <div className="grid grid-cols-2 gap-3 pt-2">
                  {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="h-32 animate-pulse rounded-2xl bg-white" />
                  ))}
                </div>
              ) : filteredCatalog.length === 0 ? (
                <div className="mt-3 rounded-2xl border border-dashed border-[#cbd5e1] bg-white px-4 py-10 text-center text-sm font-bold text-[#64748b]">
                  Тохирох бараа олдсонгүй.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                  {filteredCatalog.map((item) => {
                    const quantity = cartQuantities.get(item.sku) ?? 0;
                    return (
                      <button
                        key={item.sku}
                        type="button"
                        onClick={() => addItem(item)}
                        className="relative flex min-h-32 flex-col justify-between rounded-2xl border border-[#dbe5df] bg-white p-3 text-left shadow-sm active:scale-[0.98] active:bg-[#f0fdf4]"
                      >
                        {quantity > 0 && (
                          <span className="absolute right-2 top-2 flex h-7 min-w-7 items-center justify-center rounded-full bg-[#16a34a] px-2 text-xs font-black text-white">
                            {formatNumber(quantity)}
                          </span>
                        )}
                        <span className="pr-8 text-sm font-black leading-tight">{item.name}</span>
                        <span>
                          <span className="block text-[11px] font-bold text-[#94a3b8]">
                            {item.category || "Үйлчилгээ"}
                          </span>
                          <span className="mt-1 block text-base font-black text-[#166534]">
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
                <h2 className="text-xl font-black">Нээлттэй захиалга</h2>
                <p className="text-xs font-bold text-[#64748b]">
                  Миний {formatNumber(myOrderCount)} · Нийт {formatNumber(orders.length)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void refreshOverview()}
                disabled={refreshing}
                className="min-h-11 rounded-xl border border-[#cbd5e1] bg-white px-4 text-sm font-black disabled:opacity-50"
              >
                {refreshing ? "Шинэчилж…" : "Шинэчлэх"}
              </button>
            </div>

            {loadingOverview ? (
              <div className="h-36 animate-pulse rounded-3xl bg-white" />
            ) : orders.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[#cbd5e1] bg-white px-5 py-14 text-center">
                <p className="text-lg font-black">Нээлттэй захиалга алга</p>
                <p className="mt-1 text-sm font-bold text-[#64748b]">Шинэ захиалга шууд энд харагдана.</p>
              </div>
            ) : (
              orders.map((order) => {
                const mine = order.staff === authenticatedStaffName;
                const editable = mine && Number(order.paidAmount ?? 0) <= 0;
                return (
                  <article
                    key={order.transactionId}
                    className={`rounded-3xl border bg-white p-4 shadow-sm ${
                      mine ? "border-[#86efac]" : "border-[#dbe5df]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-black">{order.roomOrGuest || "Нэргүй"}</h3>
                          {mine && (
                            <span className="rounded-full bg-[#dcfce7] px-2 py-1 text-[11px] font-black text-[#166534]">
                              Миний
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs font-bold text-[#64748b]">
                          {order.staff} · {displayTime(order.timestamp)}
                        </p>
                      </div>
                      <p className="shrink-0 text-lg font-black text-[#166534]">
                        {formatMNT(order.balance ?? order.total)}
                      </p>
                    </div>
                    <p className="mt-3 line-clamp-3 text-sm font-bold leading-relaxed text-[#475569]">
                      {order.itemSummary || `${formatNumber(order.itemCount ?? 0)} бараа`}
                    </p>
                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#edf2ef] pt-3">
                      <span className="truncate text-[11px] font-bold text-[#94a3b8]">
                        {order.transactionId}
                      </span>
                      {editable && (
                        <button
                          type="button"
                          onClick={() => editOrder(order)}
                          className="min-h-11 shrink-0 rounded-xl bg-[#17211c] px-4 text-sm font-black text-white"
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
          className="fixed bottom-[4.75rem] left-3 right-3 z-50 mx-auto flex min-h-16 max-w-3xl items-center justify-between rounded-2xl bg-[#16a34a] px-5 text-left text-white shadow-[0_12px_35px_rgba(22,101,52,0.35)]"
        >
          <span>
            <span className="block text-xs font-black opacity-80">{formatNumber(cartQuantity)} бараа</span>
            <span className="block text-lg font-black">Сагс харах</span>
          </span>
          <span className="text-lg font-black">{formatMNT(cartTotal)}</span>
        </button>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dbe5df] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-2 gap-2 p-2">
          <button
            type="button"
            onClick={() => setActiveTab("new")}
            className={`min-h-14 rounded-2xl text-sm font-black ${
              activeTab === "new" ? "bg-[#17211c] text-white" : "text-[#64748b]"
            }`}
          >
            ＋ Шинэ захиалга {cartQuantity > 0 ? `· ${formatNumber(cartQuantity)}` : ""}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("open")}
            className={`min-h-14 rounded-2xl text-sm font-black ${
              activeTab === "open" ? "bg-[#17211c] text-white" : "text-[#64748b]"
            }`}
          >
            Нээлттэй · {formatNumber(orders.length)}
          </button>
        </div>
      </nav>

      {showCart && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-[#f3f6f4]">
          <header className="flex items-center justify-between border-b border-[#dbe5df] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div>
              <p className="text-xs font-black text-[#15803d]">{reference.trim() || "Ширээ сонгоогүй"}</p>
              <h2 className="text-xl font-black">{editingTransactionId ? "Захиалга засах" : "Захиалгын сагс"}</h2>
            </div>
            <button
              type="button"
              onClick={() => setShowCart(false)}
              className="min-h-11 rounded-xl border border-[#cbd5e1] px-4 text-sm font-black"
            >
              Буцах
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto p-3">
            {cart.map((item) => (
              <div key={item.sku} className="rounded-2xl border border-[#dbe5df] bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-black">{item.name}</p>
                    <p className="mt-1 text-xs font-bold text-[#64748b]">{formatMNT(item.unitPrice)} / нэгж</p>
                  </div>
                  <p className="shrink-0 font-black">{formatMNT(item.qty * item.unitPrice)}</p>
                </div>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    aria-label={`${item.name} нэгээр хасах`}
                    onClick={() => changeQuantity(item.sku, -1)}
                    className="h-12 w-12 rounded-xl border border-[#cbd5e1] bg-white text-2xl font-black"
                  >
                    −
                  </button>
                  <span className="flex h-12 min-w-14 items-center justify-center rounded-xl bg-[#f1f5f9] px-3 text-lg font-black">
                    {formatNumber(item.qty)}
                  </span>
                  <button
                    type="button"
                    aria-label={`${item.name} нэгээр нэмэх`}
                    onClick={() => changeQuantity(item.sku, 1)}
                    className="h-12 w-12 rounded-xl bg-[#17211c] text-2xl font-black text-white"
                  >
                    +
                  </button>
                </div>
              </div>
            ))}
          </div>
          <footer className="border-t border-[#dbe5df] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {saveMessage && (
              <p className={`mb-3 text-sm font-bold ${saveStatus === "error" ? "text-[#b91c1c]" : "text-[#047857]"}`}>
                {saveMessage}
              </p>
            )}
            <div className="mb-3 flex items-end justify-between gap-3">
              <span className="text-sm font-bold text-[#64748b]">Нийт · {formatNumber(cartQuantity)} бараа</span>
              <span className="text-2xl font-black">{formatMNT(cartTotal)}</span>
            </div>
            <button
              type="button"
              onClick={() => void submitOrder()}
              disabled={saveStatus === "saving" || cart.length === 0 || !dayOpen}
              className="min-h-16 w-full rounded-2xl bg-[#16a34a] px-5 text-lg font-black text-white disabled:bg-[#94a3b8]"
            >
              {saveStatus === "saving"
                ? "Илгээж байна…"
                : editingTransactionId
                  ? "Захиалгыг шинэчлэх"
                  : "Захиалга илгээх"}
            </button>
            <p className="mt-2 text-center text-xs font-bold text-[#64748b]">
              Төлбөр авахгүй · кассын нээлттэй захиалгад орно
            </p>
          </footer>
        </div>
      )}
    </main>
  );
}

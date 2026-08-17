"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { canRefreshInBackground, fetchWithTimeout } from "@/lib/client/network";
import type {
  KitchenOrder,
  KitchenOrderStatus,
} from "@/lib/server/kitchen-queue";

type KitchenDisplayProps = {
  businessDate: string;
  authenticatedStaffName: string;
};

type KitchenAction = "start" | "ready" | "reopen" | "archive";

const POLL_INTERVAL_MS = 5000;
const COLUMNS: Array<{
  status: KitchenOrderStatus;
  label: string;
  empty: string;
  headerClass: string;
}> = [
  {
    status: "new",
    label: "Шинэ",
    empty: "Шинэ захиалга алга",
    headerClass: "bg-[#f5a623] text-[#111111]",
  },
  {
    status: "preparing",
    label: "Бэлтгэж байна",
    empty: "Бэлтгэж буй захиалга алга",
    headerClass: "bg-[#3b9dd4] text-white",
  },
  {
    status: "ready",
    label: "Бэлэн",
    empty: "Бэлэн захиалга алга",
    headerClass: "bg-[#86efac] text-[#14532d]",
  },
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

function minutesSince(timestamp: string, now: Date) {
  const createdAt = new Date(timestamp).getTime();
  if (!Number.isFinite(createdAt)) return 0;
  return Math.max(Math.floor((now.getTime() - createdAt) / 60000), 0);
}

function elapsedLabel(minutes: number) {
  if (minutes < 1) return "Шинэ";
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  return `${hours}ц ${minutes % 60}м`;
}

function ageClass(status: KitchenOrderStatus, minutes: number) {
  if (status === "ready") return "border-[#22c55e]";
  if (minutes >= 20) return "border-[#dc2626] bg-[#fff1f2]";
  if (minutes >= 10) return "border-[#f5a623] bg-[#fff7ed]";
  return "border-[#a7a7a7] bg-[#f7f7f7]";
}

function actionStatus(action: KitchenAction): KitchenOrderStatus | "archived" {
  if (action === "start") return "preparing";
  if (action === "ready") return "ready";
  if (action === "reopen") return "new";
  return "archived";
}

export function KitchenDisplay({
  businessDate,
  authenticatedStaffName,
}: KitchenDisplayProps) {
  const router = useRouter();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [pendingOrderId, setPendingOrderId] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const previousRevisions = useRef<Map<string, number>>(new Map());
  const hasLoaded = useRef(false);
  const audioContext = useRef<AudioContext | null>(null);

  const groupedOrders = useMemo(() => {
    const groups: Record<KitchenOrderStatus, KitchenOrder[]> = {
      new: [],
      preparing: [],
      ready: [],
    };
    orders.forEach((order) => groups[order.status].push(order));
    return groups;
  }, [orders]);

  const playOrderSound = useCallback(() => {
    const context = audioContext.current;
    if (!context || context.state !== "running") return;
    const first = context.createOscillator();
    const second = context.createOscillator();
    const gain = context.createGain();
    first.frequency.value = 784;
    second.frequency.value = 1046;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.22, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.55);
    first.connect(gain);
    second.connect(gain);
    gain.connect(context.destination);
    first.start();
    second.start(context.currentTime + 0.16);
    first.stop(context.currentTime + 0.3);
    second.stop(context.currentTime + 0.55);
  }, []);

  const loadOrders = useCallback(
    async (manual = false) => {
      if (manual) setRefreshing(true);
      try {
        const params = new URLSearchParams({ businessDate });
        const response = await fetchWithTimeout(`/api/kitchen?${params.toString()}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | { orders?: KitchenOrder[]; error?: string }
          | null;
        if (!response.ok) throw new Error(readError(payload, "Захиалга татаж чадсангүй."));
        const nextOrders = Array.isArray(payload?.orders) ? payload.orders : [];
        if (hasLoaded.current && soundEnabled) {
          const hasNewOrder = nextOrders.some((order) => {
            const previousRevision = previousRevisions.current.get(order.orderId);
            return (
              order.status === "new" &&
              (previousRevision === undefined || order.revision > previousRevision)
            );
          });
          if (hasNewOrder) playOrderSound();
        }
        previousRevisions.current = new Map(
          nextOrders.map((order) => [order.orderId, order.revision]),
        );
        hasLoaded.current = true;
        setOrders(nextOrders);
        setError("");
      } catch (loadError) {
        setError(
          loadError instanceof Error ? loadError.message : "Захиалга татаж чадсангүй.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [businessDate, playOrderSound, soundEnabled],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadOrders(), 0);
    const pollId = window.setInterval(() => {
      if (canRefreshInBackground()) void loadOrders();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(timeoutId);
      window.clearInterval(pollId);
    };
  }, [loadOrders]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function enableSound() {
    const AudioContextClass = window.AudioContext;
    const context = audioContext.current ?? new AudioContextClass();
    audioContext.current = context;
    await context.resume();
    setSoundEnabled(true);
    window.setTimeout(playOrderSound, 0);
  }

  async function updateOrder(orderId: string, action: KitchenAction) {
    if (pendingOrderId) return;
    const nextStatus = actionStatus(action);
    const previousOrders = orders;
    setPendingOrderId(orderId);
    setOrders((current) =>
      nextStatus === "archived"
        ? current.filter((order) => order.orderId !== orderId)
        : current.map((order) =>
            order.orderId === orderId
              ? { ...order, status: nextStatus, updatedAt: new Date().toISOString() }
              : order,
          ),
    );
    try {
      const response = await fetchWithTimeout(
        "/api/kitchen",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, action }),
        },
        10000,
      );
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(readError(payload, "Төлөв хадгалж чадсангүй."));
      setError("");
      await loadOrders();
    } catch (updateError) {
      setOrders(previousOrders);
      setError(
        updateError instanceof Error ? updateError.message : "Төлөв хадгалж чадсангүй.",
      );
    } finally {
      setPendingOrderId("");
    }
  }

  async function logOut() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-[#e8e8e8] text-[#151515]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#555555] bg-[#2b2b2b] px-4 py-3 text-white">
        <div className="min-w-48">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-[#f5a623]">
            Dalai Eej · Гал тогоо
          </p>
          <h1 className="text-2xl font-black">Захиалгын дэлгэц</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="rounded-md border border-[#555555] bg-[#3a3a3a] px-3 py-2 text-right">
            <p className="text-xs font-bold text-[#c9c9c9]">{businessDate.replaceAll("-", ".")}</p>
            <p className="text-lg font-black tabular-nums">
              {now.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void enableSound()}
            className={`min-h-12 rounded-md px-4 text-sm font-black ${
              soundEnabled
                ? "bg-[#86efac] text-[#14532d]"
                : "bg-[#f5a623] text-[#111111]"
            }`}
          >
            {soundEnabled ? "Дуу асаалттай" : "Дуу асаах"}
          </button>
          <button
            type="button"
            onClick={() => void loadOrders(true)}
            disabled={refreshing}
            className="min-h-12 rounded-md bg-[#3b9dd4] px-4 text-sm font-black text-white disabled:opacity-50"
          >
            {refreshing ? "Шинэчилж…" : "Шинэчлэх"}
          </button>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            className="min-h-12 rounded-md border border-[#555555] bg-[#3a3a3a] px-4 text-sm font-black"
          >
            Бүтэн дэлгэц
          </button>
          <button
            type="button"
            onClick={() => void logOut()}
            disabled={loggingOut}
            className="min-h-12 rounded-md border border-[#555555] bg-[#3a3a3a] px-4 text-sm font-black disabled:opacity-50"
          >
            {authenticatedStaffName} · Гарах
          </button>
        </div>
      </header>

      {error && (
        <div role="status" className="border-b border-[#dc2626] bg-[#fef2f2] px-4 py-2 text-center text-sm font-black text-[#b91c1c]">
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnOrders = groupedOrders[column.status];
          return (
            <section key={column.status} className="flex min-h-[18rem] flex-col overflow-hidden rounded-md border border-[#a7a7a7] bg-[#f1f1f1]">
              <div className={`flex min-h-14 items-center justify-between px-4 ${column.headerClass}`}>
                <h2 className="text-xl font-black">{column.label}</h2>
                <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-black/15 px-2 text-lg font-black">
                  {columnOrders.length}
                </span>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {loading ? (
                  Array.from({ length: 2 }, (_, index) => (
                    <div key={index} className="h-48 animate-pulse rounded-md bg-white" />
                  ))
                ) : columnOrders.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-[#a7a7a7] bg-white px-4 text-center text-sm font-black text-[#6b7280]">
                    {column.empty}
                  </div>
                ) : (
                  columnOrders.map((order) => {
                    const minutes = minutesSince(order.createdAt, now);
                    const isPending = pendingOrderId === order.orderId;
                    return (
                      <article key={order.orderId} className={`rounded-md border-2 p-4 ${ageClass(order.status, minutes)}`}>
                        <div className="flex items-start justify-between gap-3 border-b border-black/10 pb-3">
                          <div className="min-w-0">
                            <h3 className="break-words text-2xl font-black">{order.roomOrGuest}</h3>
                            <p className="mt-1 text-xs font-bold text-[#6b7280]">
                              {order.staff} · {order.orderId}
                            </p>
                          </div>
                          <span className={`shrink-0 rounded-md px-3 py-2 text-lg font-black tabular-nums ${
                            minutes >= 20 && order.status !== "ready"
                              ? "bg-[#dc2626] text-white"
                              : minutes >= 10 && order.status !== "ready"
                                ? "bg-[#f5a623] text-[#111111]"
                                : "bg-[#2b2b2b] text-white"
                          }`}>
                            {elapsedLabel(minutes)}
                          </span>
                        </div>
                        <ul className="my-4 space-y-3">
                          {order.items.map((item, index) => (
                            <li key={`${item.sku}-${item.name}-${index}`} className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-2 text-xl font-black leading-tight">
                              <span className="rounded bg-[#b9e3ff] px-2 py-1 text-center text-[#102033]">
                                {item.quantity}×
                              </span>
                              <span className="py-1">{item.name}</span>
                            </li>
                          ))}
                        </ul>
                        <div className="grid grid-cols-2 gap-2 border-t border-black/10 pt-3">
                          {order.status === "new" ? (
                            <button
                              type="button"
                              onClick={() => void updateOrder(order.orderId, "start")}
                              disabled={Boolean(pendingOrderId)}
                              className="col-span-2 min-h-14 rounded-md bg-[#3b9dd4] text-lg font-black text-white disabled:opacity-50"
                            >
                              {isPending ? "Хадгалж…" : "Эхлэх"}
                            </button>
                          ) : order.status === "preparing" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "reopen")}
                                disabled={Boolean(pendingOrderId)}
                                className="min-h-14 rounded-md border border-[#a7a7a7] bg-white text-base font-black disabled:opacity-50"
                              >
                                Буцаах
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "ready")}
                                disabled={Boolean(pendingOrderId)}
                                className="min-h-14 rounded-md bg-[#f5a623] text-lg font-black text-[#111111] disabled:opacity-50"
                              >
                                {isPending ? "Хадгалж…" : "Бэлэн"}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "reopen")}
                                disabled={Boolean(pendingOrderId)}
                                className="min-h-14 rounded-md border border-[#a7a7a7] bg-white text-base font-black disabled:opacity-50"
                              >
                                Буцаах
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "archive")}
                                disabled={Boolean(pendingOrderId)}
                                className="min-h-14 rounded-md bg-[#86efac] text-base font-black text-[#14532d] disabled:opacity-50"
                              >
                                {isPending ? "Хадгалж…" : "Дэлгэцээс авах"}
                              </button>
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}

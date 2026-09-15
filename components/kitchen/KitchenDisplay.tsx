"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "../service/Service.module.css";
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
}> = [
  {
    status: "new",
    label: "Шинэ",
    empty: "Шинэ захиалга алга",
  },
  {
    status: "preparing",
    label: "Бэлтгэж байна",
    empty: "Бэлтгэж буй захиалга алга",
  },
  {
    status: "ready",
    label: "Бэлэн",
    empty: "Бэлэн захиалга алга",
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
    <main className={`${styles.screen} ${styles.kitchen}`}>
      <div className={styles.topbar}><span>Dalai Eej</span><span>Гал тогоо · {businessDate}</span></div>
      <header className={styles.kitchenHeader}>
        <div className="min-w-48">
          <p className="text-xs font-normal  text-black">
            Dalai Eej · Гал тогоо
          </p>
          <h1 className="text-2xl font-normal">Захиалгын дэлгэц</h1>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <div className="rounded-none border border-[#8c8c8c] bg-white px-3 py-2 text-right">
            <p className="text-xs font-normal text-[#666666]">{businessDate.replaceAll("-", ".")}</p>
            <p className="text-lg font-normal tabular-nums">
              {now.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void enableSound()}
            aria-pressed={soundEnabled}
            className="min-h-12 px-4 text-sm font-normal"
          >
            {soundEnabled ? "Дуу асаалттай" : "Дуу асаах"}
          </button>
          <button
            type="button"
            onClick={() => void loadOrders(true)}
            disabled={refreshing}
            className="min-h-12 rounded-none bg-white px-4 text-sm font-normal text-black disabled:opacity-50"
          >
            {refreshing ? "Шинэчилж…" : "Шинэчлэх"}
          </button>
          <button
            type="button"
            onClick={() => void document.documentElement.requestFullscreen?.()}
            className="min-h-12 rounded-none border border-[#8c8c8c] bg-white px-4 text-sm font-normal"
          >
            Бүтэн дэлгэц
          </button>
          <button
            type="button"
            onClick={() => void logOut()}
            disabled={loggingOut}
            className="min-h-12 rounded-none border border-[#8c8c8c] bg-white px-4 text-sm font-normal disabled:opacity-50"
          >
            {authenticatedStaffName} · Гарах
          </button>
        </div>
      </header>

      {error && (
        <div role="status" className="border-b border-[#8c8c8c] bg-white px-4 py-2 text-center text-sm font-normal text-black">
          {error}
        </div>
      )}

      <div className={styles.kitchenBoard}>
        {COLUMNS.map((column) => {
          const columnOrders = groupedOrders[column.status];
          return (
            <section key={column.status} data-status={column.status} className={styles.kitchenColumn}>
              <div className="flex min-h-14 items-center justify-between px-4">
                <h2 className="text-xl font-normal">{column.label}</h2>
                <span className="flex h-9 min-w-9 items-center justify-center rounded-none bg-[#f0f0f0] px-2 text-lg font-normal">
                  {columnOrders.length}
                </span>
              </div>
              <div className={styles.orderList}>
                {loading ? (
                  Array.from({ length: 2 }, (_, index) => (
                    <div key={index} className="h-48 animate-pulse rounded-none bg-white" />
                  ))
                ) : columnOrders.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center rounded-none border border-dashed border-[#8c8c8c] bg-white px-4 text-center text-sm font-normal text-[#666666]">
                    {column.empty}
                  </div>
                ) : (
                  columnOrders.map((order) => {
                    const minutes = minutesSince(order.createdAt, now);
                    const isPending = pendingOrderId === order.orderId;
                    return (
                      <article key={order.orderId} data-age={order.status === "ready" ? "ready" : minutes >= 20 ? "late" : minutes >= 10 ? "waiting" : "new"} className={styles.order}>
                        <div className="flex items-start justify-between gap-3 border-b border-black/10 pb-3">
                          <div className="min-w-0">
                            <h3 className="break-words text-2xl font-normal">{order.serviceTable ? `Ширээ ${order.serviceTable}` : order.roomOrGuest}</h3>
                            {order.serviceTable && <p>Байшин / зочин: {order.roomOrGuest}</p>}
                            <p className="mt-1 text-xs font-normal text-[#666666]">
                              {order.staff} · {order.orderId}
                            </p>
                          </div>
                          <span className="shrink-0 px-3 py-2 tabular-nums">
                            {elapsedLabel(minutes)}
                          </span>
                        </div>
                        {order.preparationNotes && <p className="my-3 whitespace-pre-wrap border-b pb-3">{order.preparationNotes}</p>}
                        <ul className="my-4 space-y-3">
                          {order.items.map((item, index) => (
                            <li key={`${item.sku}-${item.name}-${index}`} className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-2 text-xl font-normal leading-tight">
                              <span className="rounded-none bg-white px-2 py-1 text-center text-black">
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
                              className={`${styles.primary} col-span-2`}
                            >
                              {isPending ? "Хадгалж…" : "Эхлэх"}
                            </button>
                          ) : order.status === "preparing" ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "reopen")}
                                disabled={Boolean(pendingOrderId)}
                                className="min-h-14 rounded-none border border-[#8c8c8c] bg-white text-base font-normal disabled:opacity-50"
                              >
                                Буцаах
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "ready")}
                                disabled={Boolean(pendingOrderId)}
                                className={styles.primary}
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
                                className="min-h-14 rounded-none border border-[#8c8c8c] bg-white text-base font-normal disabled:opacity-50"
                              >
                                Буцаах
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateOrder(order.orderId, "archive")}
                                disabled={Boolean(pendingOrderId)}
                                className={styles.primary}
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

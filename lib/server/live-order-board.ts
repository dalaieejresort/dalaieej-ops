import "server-only";

import { Redis } from "@upstash/redis";
import type { LiveOrder, LiveOrderItem } from "@/lib/live-order-types";

type LiveOrderInput = Omit<
  LiveOrder,
  "total" | "balance" | "updatedAt" | "items"
> & {
  items?: LiveOrderItem[];
};

type BoardMeta = {
  kind: "meta";
  initializedAt: string;
};

const LIVE_ORDER_BOARD_KEY = "dalaieej:live:orders:v1";
const LIVE_ORDER_META_FIELD = "__board_meta__";
const BOARD_TTL_SECONDS = 72 * 60 * 60;
const BOARD_WRITE_TIMEOUT_MS = 2_000;

let redisClient: Redis | undefined;

function getRedis() {
  if (!redisClient) redisClient = Redis.fromEnv();
  return redisClient;
}

async function withBoardWriteTimeout<T>(operation: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Live order board timed out")),
      BOARD_WRITE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeLiveOrder(input: LiveOrderInput): LiveOrder | null {
  const transactionId = input.transactionId.trim();
  const originalTotal = Math.max(Number(input.originalTotal) || 0, 0);
  const paidAmount = Math.max(Number(input.paidAmount) || 0, 0);
  const balance = Math.max(originalTotal - paidAmount, 0);
  if (!transactionId || balance <= 0) return null;

  return {
    ...input,
    transactionId,
    businessDate: input.businessDate.trim(),
    timestamp: input.timestamp.trim(),
    staff: input.staff.trim(),
    paymentMethod: input.paymentMethod.trim(),
    roomOrGuest: input.roomOrGuest.trim(),
    subtotal: Number(input.subtotal) || 0,
    discount: Number(input.discount) || 0,
    total: balance,
    originalTotal,
    paidAmount,
    balance,
    itemCount: Number(input.itemCount) || 0,
    itemSummary: input.itemSummary.trim(),
    qpayInvoiceId: input.qpayInvoiceId.trim(),
    notes: input.notes.trim(),
    items: input.items,
    updatedAt: new Date().toISOString(),
  };
}

async function saveBoardFields(fields: Record<string, LiveOrder | BoardMeta>) {
  await getRedis()
    .pipeline()
    .hset(LIVE_ORDER_BOARD_KEY, fields)
    .expire(LIVE_ORDER_BOARD_KEY, BOARD_TTL_SECONDS)
    .exec();
}

export async function syncLiveOrder(input: LiveOrderInput) {
  const order = normalizeLiveOrder(input);
  if (!order) {
    await removeLiveOrder(input.transactionId);
    return null;
  }
  await saveBoardFields({ [order.transactionId]: order });
  return order;
}

export async function syncLiveOrderSafely(input: LiveOrderInput) {
  try {
    return await withBoardWriteTimeout(syncLiveOrder(input));
  } catch (error) {
    console.error(
      `[live-order-board] sync failed for ${input.transactionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function removeLiveOrder(transactionId: string) {
  const normalizedId = transactionId.trim();
  if (!normalizedId) return;
  await getRedis().hdel(LIVE_ORDER_BOARD_KEY, normalizedId);
}

export async function removeLiveOrderSafely(transactionId: string) {
  try {
    await withBoardWriteTimeout(removeLiveOrder(transactionId));
  } catch (error) {
    console.error(
      `[live-order-board] remove failed for ${transactionId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function replaceLiveOrdersSnapshot(orders: LiveOrderInput[]) {
  const normalizedOrders = orders
    .map(normalizeLiveOrder)
    .filter((order): order is LiveOrder => Boolean(order));
  const existing =
    (await getRedis().hgetall<Record<string, LiveOrder | BoardMeta>>(
      LIVE_ORDER_BOARD_KEY,
    )) ?? {};
  const nextIds = new Set(normalizedOrders.map((order) => order.transactionId));
  const staleIds = Object.keys(existing).filter(
    (field) => field !== LIVE_ORDER_META_FIELD && !nextIds.has(field),
  );
  const fields: Record<string, LiveOrder | BoardMeta> = {
    [LIVE_ORDER_META_FIELD]: {
      kind: "meta",
      initializedAt: new Date().toISOString(),
    },
  };
  normalizedOrders.forEach((order) => {
    fields[order.transactionId] = order;
  });

  const pipeline = getRedis().pipeline();
  if (staleIds.length > 0) pipeline.hdel(LIVE_ORDER_BOARD_KEY, ...staleIds);
  pipeline.hset(LIVE_ORDER_BOARD_KEY, fields);
  pipeline.expire(LIVE_ORDER_BOARD_KEY, BOARD_TTL_SECONDS);
  await pipeline.exec();
}

export async function replaceLiveOrdersSnapshotSafely(orders: LiveOrderInput[]) {
  try {
    await withBoardWriteTimeout(replaceLiveOrdersSnapshot(orders));
  } catch (error) {
    console.error(
      `[live-order-board] snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function listLiveOrders() {
  const fields =
    (await getRedis().hgetall<Record<string, LiveOrder | BoardMeta>>(
      LIVE_ORDER_BOARD_KEY,
    )) ?? {};
  const initialized = Boolean(fields[LIVE_ORDER_META_FIELD]);
  const orders = Object.entries(fields)
    .filter(([field]) => field !== LIVE_ORDER_META_FIELD)
    .map(([, value]) => value as LiveOrder)
    .filter((order) => order.transactionId && order.balance > 0)
    .sort(
      (first, second) =>
        new Date(first.timestamp).getTime() - new Date(second.timestamp).getTime(),
    );
  return { initialized, orders };
}

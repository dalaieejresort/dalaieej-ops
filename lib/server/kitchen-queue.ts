import "server-only";

import { Redis } from "@upstash/redis";

export type KitchenOrderStatus = "new" | "preparing" | "ready";

export type KitchenOrderItem = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
};

export type KitchenOrder = {
  orderId: string;
  businessDate: string;
  roomOrGuest: string;
  staff: string;
  items: KitchenOrderItem[];
  status: KitchenOrderStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  readyAt?: string;
  updatedBy?: string;
  revision: number;
  fingerprint: string;
};

type KitchenOrderInputItem = {
  sku?: string;
  name?: string;
  category?: string;
  qty?: number;
};

type KitchenOrderInput = {
  orderId: string;
  businessDate: string;
  roomOrGuest?: string;
  staff: string;
  items: KitchenOrderInputItem[];
  createdAt?: string;
};

const KITCHEN_QUEUE_KEY = "dalaieej:kitchen:orders:v1";
const QUEUE_TTL_SECONDS = 72 * 60 * 60;
const ORDER_SAVE_TIMEOUT_MS = 2_000;

let redisClient: Redis | undefined;

function getRedis() {
  if (!redisClient) redisClient = Redis.fromEnv();
  return redisClient;
}

async function withOrderSaveTimeout<T>(operation: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Kitchen queue timed out")),
      ORDER_SAVE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function isKitchenCategory(category: string) {
  const normalized = category.trim().toLocaleLowerCase("mn-MN");
  return (
    normalized.includes("хоол") ||
    normalized.includes("гал тогоо") ||
    normalized.includes("kitchen") ||
    normalized.includes("food")
  );
}

function toKitchenItems(items: KitchenOrderInputItem[]) {
  return items
    .map((item) => ({
      sku: String(item.sku ?? "").trim(),
      name: String(item.name ?? item.sku ?? "").trim(),
      category: String(item.category ?? "").trim(),
      quantity: Number(item.qty ?? 1),
    }))
    .filter(
      (item) =>
        item.name &&
        Number.isFinite(item.quantity) &&
        item.quantity > 0 &&
        isKitchenCategory(item.category),
    );
}

async function saveKitchenOrder(order: KitchenOrder) {
  await getRedis()
    .pipeline()
    .hset(KITCHEN_QUEUE_KEY, { [order.orderId]: order })
    .expire(KITCHEN_QUEUE_KEY, QUEUE_TTL_SECONDS)
    .exec();
}

export async function syncKitchenOrder(input: KitchenOrderInput) {
  const orderId = input.orderId.trim();
  if (!orderId) return null;
  const kitchenItems = toKitchenItems(input.items);
  if (kitchenItems.length === 0) {
    await removeKitchenOrder(orderId);
    return null;
  }

  const redis = getRedis();
  const existing = await redis.hget<KitchenOrder>(KITCHEN_QUEUE_KEY, orderId);
  const fingerprint = JSON.stringify({
    roomOrGuest: input.roomOrGuest?.trim() ?? "",
    staff: input.staff.trim(),
    items: kitchenItems,
  });
  const changed = Boolean(existing && existing.fingerprint !== fingerprint);
  const now = new Date().toISOString();
  const order: KitchenOrder = {
    orderId,
    businessDate: input.businessDate,
    roomOrGuest: input.roomOrGuest?.trim() || "Касс",
    staff: input.staff.trim(),
    items: kitchenItems,
    status: changed ? "new" : existing?.status ?? "new",
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: changed ? now : existing?.updatedAt ?? now,
    ...(changed
      ? {}
      : {
          ...(existing?.startedAt ? { startedAt: existing.startedAt } : {}),
          ...(existing?.readyAt ? { readyAt: existing.readyAt } : {}),
          ...(existing?.updatedBy ? { updatedBy: existing.updatedBy } : {}),
        }),
    revision: existing ? existing.revision + (changed ? 1 : 0) : 1,
    fingerprint,
  };

  await saveKitchenOrder(order);
  return order;
}

export async function syncKitchenOrderSafely(input: KitchenOrderInput) {
  try {
    return await withOrderSaveTimeout(syncKitchenOrder(input));
  } catch (error) {
    console.error(
      `[kitchen-queue] sync failed for ${input.orderId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function listKitchenOrders(businessDate: string) {
  const orders =
    (await getRedis().hgetall<Record<string, KitchenOrder>>(KITCHEN_QUEUE_KEY)) ?? {};
  return Object.values(orders)
    .filter((order) => order.businessDate === businessDate)
    .sort(
      (first, second) =>
        new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime(),
    );
}

export async function updateKitchenOrderStatus(
  orderId: string,
  action: "start" | "ready" | "reopen" | "archive",
  actorName: string,
) {
  const redis = getRedis();
  const existing = await redis.hget<KitchenOrder>(KITCHEN_QUEUE_KEY, orderId);
  if (!existing) return null;
  if (action === "archive") {
    await redis.hdel(KITCHEN_QUEUE_KEY, orderId);
    return { ...existing, archived: true };
  }

  const now = new Date().toISOString();
  const status: KitchenOrderStatus =
    action === "start" ? "preparing" : action === "ready" ? "ready" : "new";
  const order: KitchenOrder = {
    ...existing,
    status,
    updatedAt: now,
    updatedBy: actorName,
    revision: existing.revision + 1,
    ...(status === "new"
      ? { startedAt: undefined, readyAt: undefined }
      : status === "preparing"
        ? { startedAt: existing.startedAt ?? now, readyAt: undefined }
        : { startedAt: existing.startedAt ?? now, readyAt: now }),
  };
  await saveKitchenOrder(order);
  return order;
}

export async function removeKitchenOrder(orderId: string) {
  if (!orderId.trim()) return;
  await getRedis().hdel(KITCHEN_QUEUE_KEY, orderId.trim());
}

export async function removeKitchenOrderSafely(orderId: string) {
  try {
    await withOrderSaveTimeout(removeKitchenOrder(orderId));
  } catch (error) {
    console.error(
      `[kitchen-queue] remove failed for ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

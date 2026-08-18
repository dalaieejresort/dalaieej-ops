import "server-only";

import { Redis } from "@upstash/redis";
import type {
  ManagementBoardSectionName,
} from "@/lib/management-board-types";
import { isValidBusinessDate } from "@/lib/pos/business-date";

type StoredSection = {
  data: unknown;
  updatedAt: string;
};

const REQUIRED_SECTIONS: ManagementBoardSectionName[] = [
  "day",
  "sales",
  "inventory",
  "operations",
];
const ALL_SECTIONS: ManagementBoardSectionName[] = [
  ...REQUIRED_SECTIONS,
  "quality",
];
const BOARD_TTL_SECONDS = 72 * 60 * 60;
const BOARD_WRITE_TIMEOUT_MS = 2_000;

let redisClient: Redis | undefined;

function getRedis() {
  if (!redisClient) redisClient = Redis.fromEnv();
  return redisClient;
}

function boardKey(businessDate: string) {
  if (!isValidBusinessDate(businessDate)) {
    throw new Error("Invalid management board business date");
  }
  return `dalaieej:management:${businessDate}:v1`;
}

async function withBoardWriteTimeout<T>(operation: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Management board timed out")),
      BOARD_WRITE_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function mergeManagementBoardSection(
  businessDate: string,
  section: ManagementBoardSectionName,
  data: unknown,
) {
  const stored: StoredSection = {
    data,
    updatedAt: new Date().toISOString(),
  };
  await getRedis()
    .pipeline()
    .hset(boardKey(businessDate), { [section]: stored })
    .expire(boardKey(businessDate), BOARD_TTL_SECONDS)
    .exec();
}

export async function mergeManagementBoardSectionSafely(
  businessDate: string,
  section: ManagementBoardSectionName,
  data: unknown,
) {
  try {
    await withBoardWriteTimeout(
      mergeManagementBoardSection(businessDate, section, data),
    );
  } catch (error) {
    console.error(
      `[management-board] ${section} sync failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function getManagementBoardSnapshot(businessDate: string) {
  const stored =
    (await getRedis().hgetall<Record<string, StoredSection>>(
      boardKey(businessDate),
    )) ?? {};
  const sections: Partial<Record<ManagementBoardSectionName, unknown>> = {};
  const sectionUpdatedAt: Partial<
    Record<ManagementBoardSectionName, string>
  > = {};

  ALL_SECTIONS.forEach((section) => {
    const value = stored[section];
    if (!value || typeof value !== "object" || !("data" in value)) return;
    sections[section] = value.data;
    sectionUpdatedAt[section] = value.updatedAt;
  });
  const timestamps = Object.values(sectionUpdatedAt).filter(Boolean);

  return {
    initialized: REQUIRED_SECTIONS.every(
      (section) => sections[section] !== undefined,
    ),
    sections,
    sectionUpdatedAt,
    updatedAt:
      timestamps.length > 0
        ? timestamps.sort((first, second) => second.localeCompare(first))[0]
        : null,
  };
}

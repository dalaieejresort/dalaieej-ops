type OfflineCacheEntry<T> = {
  savedAt: number;
  value: T;
};

export type OfflineCacheValue<T> = OfflineCacheEntry<T>;

const CACHE_PREFIX = "dalaieej:offline:";

export function readOfflineCache<T>(key: string): OfflineCacheValue<T> | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = window.localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!rawValue) return null;

    const parsed = JSON.parse(rawValue) as Partial<OfflineCacheEntry<T>>;
    if (typeof parsed.savedAt !== "number" || !("value" in parsed)) {
      return null;
    }

    return parsed as OfflineCacheEntry<T>;
  } catch {
    return null;
  }
}

export function writeOfflineCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;

  try {
    const entry: OfflineCacheEntry<T> = {
      savedAt: Date.now(),
      value,
    };
    window.localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Storage can be unavailable in private browsing or on managed devices.
  }
}

export function removeOfflineCache(key: string) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // Treat local persistence as a best-effort safeguard.
  }
}

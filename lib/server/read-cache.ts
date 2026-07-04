type ReadCacheEntry<T> = {
  expiresAt: number;
  hasValue: boolean;
  pending?: Promise<T>;
  value?: T;
};

type ReadCacheGlobal = typeof globalThis & {
  __dalaieejReadCache?: Map<string, ReadCacheEntry<unknown>>;
};

const readCacheGlobal = globalThis as ReadCacheGlobal;

function getReadCache() {
  readCacheGlobal.__dalaieejReadCache ??= new Map();
  return readCacheGlobal.__dalaieejReadCache;
}

export async function getCachedRead<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
) {
  const cache = getReadCache();
  const now = Date.now();
  const existing = cache.get(key) as ReadCacheEntry<T> | undefined;

  if (existing?.hasValue && existing.expiresAt > now) {
    return existing.value as T;
  }

  if (existing?.pending) {
    return existing.pending;
  }

  const pending = loader()
    .then((value) => {
      cache.set(key, {
        expiresAt: Date.now() + ttlMs,
        hasValue: true,
        value,
      });
      return value;
    })
    .catch((error) => {
      const current = cache.get(key) as ReadCacheEntry<T> | undefined;
      if (current?.pending === pending) {
        cache.delete(key);
      }
      throw error;
    });

  cache.set(key, {
    expiresAt: now + ttlMs,
    hasValue: false,
    pending,
  });

  return pending;
}

export function clearCachedReads(prefix?: string) {
  const cache = getReadCache();

  if (!prefix) {
    cache.clear();
    return;
  }

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

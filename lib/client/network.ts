const DEFAULT_READ_TIMEOUT_MS = 8000;
const activeReadRequests = new Map<string, Promise<Response>>();
let readBackoffUntil = 0;

function readRequestKey(input: RequestInfo | URL) {
  const raw = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  const url = new URL(raw, window.location.origin);
  url.searchParams.delete("fresh");
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
) {
  if (init?.signal) return fetch(input, init);

  const method = (init?.method ?? "GET").toUpperCase();
  const readKey = method === "GET" ? readRequestKey(input) : "";
  if (readKey && Date.now() < readBackoffUntil) {
    throw new Error("Google Sheets түр хязгаарлагдсан. 60 секунд хүлээнэ үү.");
  }
  if (readKey) {
    const existing = activeReadRequests.get(readKey);
    if (existing) return (await existing).clone();
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const pending = fetch(input, { ...init, signal: controller.signal });
  if (readKey) activeReadRequests.set(readKey, pending);

  try {
    const response = await pending;
    if (readKey && response.status === 429) {
      const retryAfterSeconds = Number(response.headers.get("Retry-After") ?? 60);
      readBackoffUntil = Date.now() +
        (Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 60) * 1000;
    }
    return readKey ? response.clone() : response;
  } finally {
    window.clearTimeout(timeout);
    if (readKey && activeReadRequests.get(readKey) === pending) {
      activeReadRequests.delete(readKey);
    }
  }
}

export function canRefreshInBackground() {
  return window.navigator.onLine && document.visibilityState === "visible";
}

const DEFAULT_READ_TIMEOUT_MS = 8000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = DEFAULT_READ_TIMEOUT_MS,
) {
  if (init?.signal) return fetch(input, init);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export function canRefreshInBackground() {
  return window.navigator.onLine && document.visibilityState === "visible";
}

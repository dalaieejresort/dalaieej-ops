"use client";

import { useCallback, useEffect, useState } from "react";

type ConnectionState =
  | "checking"
  | "healthy"
  | "offline"
  | "api-error"
  | "sheets-auth"
  | "sheets-rate-limit"
  | "sheets-error";

function statusMessage(state: ConnectionState) {
  if (state === "offline") return "Интернэт холболтгүй · Хуучин мэдээлэл харагдаж болно · Хадгалах үйлдэл түр хаалттай";
  if (state === "api-error") return "Dalai Eej сервертэй холбогдож чадсангүй";
  if (state === "sheets-auth") return "Google Sheets нэвтрэх эрхийн тохиргоо алдаатай байна";
  if (state === "sheets-rate-limit") return "Google Sheets хүсэлтийн хязгаарт хүрсэн · Түр хүлээгээд дахин оролдоно уу";
  if (state === "sheets-error") return "Google Sheets одоогоор хариу өгөхгүй байна";
  return "";
}

export function ConnectivityStatus() {
  const [state, setState] = useState<ConnectionState>("checking");
  const [lastHealthyAt, setLastHealthyAt] = useState<Date | null>(null);

  const checkHealth = useCallback(async () => {
    if (!window.navigator.onLine) {
      setState("offline");
      return;
    }

    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { code?: string }
        | null;
      if (response.ok) {
        setState("healthy");
        setLastHealthyAt(new Date());
        return;
      }
      if (payload?.code === "SHEETS_AUTH_FAILED" || payload?.code === "SHEETS_CONFIG_MISSING") {
        setState("sheets-auth");
      } else if (payload?.code === "SHEETS_RATE_LIMITED") {
        setState("sheets-rate-limit");
      } else {
        setState("sheets-error");
      }
    } catch {
      setState("api-error");
    }
  }, []);

  useEffect(() => {
    const syncStatus = () => void checkHealth();

    const initialCheck = window.setTimeout(checkHealth, 0);
    if ("serviceWorker" in window.navigator) {
      void window.navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }
    window.addEventListener("online", syncStatus);
    window.addEventListener("offline", syncStatus);
    const timer = window.setInterval(checkHealth, 5 * 60 * 1000);

    return () => {
      window.clearTimeout(initialCheck);
      window.clearInterval(timer);
      window.removeEventListener("online", syncStatus);
      window.removeEventListener("offline", syncStatus);
    };
  }, [checkHealth]);

  if (state === "healthy") {
    return (
      <div className="fixed bottom-3 left-3 z-[110] hidden rounded-lg border border-[#bbf7d0] bg-white/95 px-3 py-2 text-xs font-black text-[#047857] shadow-md backdrop-blur print:hidden md:block">
        Sheets холбогдсон · {lastHealthyAt?.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit" })}
      </div>
    );
  }

  if (state === "checking") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[100] border-b border-[#f59e0b] bg-[#fffbeb] px-4 py-2 text-center text-sm font-black text-[#92400e]"
    >
      {statusMessage(state)}
    </div>
  );
}

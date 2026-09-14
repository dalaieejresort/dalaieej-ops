"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./ConnectivityStatus.module.css";
import type { OpsRole } from "@/lib/auth-types";

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

export function ConnectivityStatus({ role }: { role?: OpsRole }) {
  const pathname = usePathname();
  const reconciliationOnlyRoute =
    pathname.startsWith("/reconciliation") || pathname === "/login" ||
    pathname === "/receipt-payments" || pathname === "/receipt-payments/privacy";
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
    if (reconciliationOnlyRoute) return;
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
  }, [checkHealth, reconciliationOnlyRoute]);

  if (reconciliationOnlyRoute) return null;

  if (state === "healthy") {
    if (role === "kitchen") return null;
    return (
      <div role="status" className={styles.connected}>
        <span>Sheets холбогдсон</span>
        <time className={styles.timestamp} dateTime={lastHealthyAt?.toISOString()}>
          {lastHealthyAt?.toLocaleTimeString("mn-MN", { hour: "2-digit", minute: "2-digit", hour12: false })}
        </time>
      </div>
    );
  }

  if (state === "checking") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={styles.warning}
    >
      {statusMessage(state)}
    </div>
  );
}

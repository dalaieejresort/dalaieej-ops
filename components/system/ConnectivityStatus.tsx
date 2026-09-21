"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import styles from "./ConnectivityStatus.module.css";

type ConnectionState =
  | "checking"
  | "healthy"
  | "offline"
  | "api-error"
  | "database-error"
  | "maintenance"
  | "sheets-auth"
  | "sheets-rate-limit"
  | "sheets-error";

function statusMessage(state: ConnectionState) {
  if (state === "database-error") return "POS өгөгдлийн сантай холбогдож чадсангүй";
  if (state === "maintenance") return "POS хадгалалтын шилжилт явагдаж байна · Түр хүлээнэ үү";
  if (state === "offline") return "Интернэт холболтгүй · Хуучин мэдээлэл харагдаж болно · Хадгалах үйлдэл түр хаалттай";
  if (state === "api-error") return "Dalai Eej сервертэй холбогдож чадсангүй";
  if (state === "sheets-auth") return "Google Sheets нэвтрэх эрхийн тохиргоо алдаатай байна";
  if (state === "sheets-rate-limit") return "Google Sheets хүсэлтийн хязгаарт хүрсэн · Түр хүлээгээд дахин оролдоно уу";
  if (state === "sheets-error") return "Google Sheets одоогоор хариу өгөхгүй байна";
  return "";
}

export function ConnectivityStatus() {
  const pathname = usePathname();
  const loginRoute = pathname === "/login";
  const [state, setState] = useState<ConnectionState>("checking");

  const checkHealth = useCallback(async () => {
    if (!window.navigator.onLine) {
      setState("offline");
      return;
    }

    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { code?: string; writesPaused?: boolean }
        | null;
      if (response.ok) {
        setState(payload?.writesPaused ? "maintenance" : "healthy");
        return;
      }
      if (payload?.code === "POS_DATABASE_UNAVAILABLE") {
        setState("database-error");
      } else if (payload?.code === "SHEETS_AUTH_FAILED" || payload?.code === "SHEETS_CONFIG_MISSING") {
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
    if (loginRoute) return;
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
  }, [checkHealth, loginRoute]);

  if (loginRoute || state === "healthy" || state === "checking") return null;

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

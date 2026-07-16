"use client";

import { useEffect, useState } from "react";

export function ConnectivityStatus() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const syncStatus = () => setIsOffline(!window.navigator.onLine);

    syncStatus();
    if ("serviceWorker" in window.navigator) {
      void window.navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => undefined);
    }
    window.addEventListener("online", syncStatus);
    window.addEventListener("offline", syncStatus);

    return () => {
      window.removeEventListener("online", syncStatus);
      window.removeEventListener("offline", syncStatus);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[100] border-b border-[#f59e0b] bg-[#fffbeb] px-4 py-2 text-center text-sm font-black text-[#92400e]"
    >
      Интернэт холболтгүй · Хуучин мэдээлэл харагдаж болно · Хадгалах үйлдэл түр
      хаалттай
    </div>
  );
}

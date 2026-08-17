"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OpsRole } from "@/lib/auth-types";

const ROLE_LABELS: Record<OpsRole, string> = {
  waiter: "Зөөгч",
  cashier: "Кассчин",
  manager: "Менежер",
  owner: "Эзэмшигч",
};

export function SessionControls({
  displayName,
  role,
}: {
  displayName: string;
  role: OpsRole;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [submitting, setSubmitting] = useState(false);

  if (pathname === "/login" || pathname === "/waiter" || role === "waiter") {
    return null;
  }

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-2 z-45 flex items-center gap-1.5 rounded-xl border border-[#555555] bg-[#2b2b2b] px-2 py-1.5 text-xs shadow-lg print:hidden md:bottom-3 md:right-3 md:z-[120] md:gap-2 md:border-[#cbd5e1] md:bg-white/95 md:px-3 md:py-2 md:backdrop-blur">
      <span className="max-w-24 truncate font-black text-[#f7f7f7] sm:max-w-36 md:text-[#334155]">
        <span className="md:hidden">{displayName}</span>
        <span className="hidden md:inline">{displayName} · {ROLE_LABELS[role]}</span>
      </span>
      <button
        type="button"
        disabled={submitting}
        onClick={async () => {
          setSubmitting(true);
          await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
          router.replace("/login");
          router.refresh();
        }}
        className="min-h-8 rounded-lg border border-[#f5a623] bg-[#f5a623] px-2 py-1 font-black text-[#111111] disabled:opacity-50 md:border-[#cbd5e1] md:bg-transparent md:hover:bg-[#f1f5f9]"
      >
        Гарах
      </button>
    </div>
  );
}

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
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-2 z-45 flex items-center gap-1.5 rounded-xl border border-[#cbd5e1] bg-white/95 px-2 py-1.5 text-xs shadow-lg backdrop-blur print:hidden md:bottom-3 md:right-3 md:z-[120] md:gap-2 md:px-3 md:py-2">
      <span className="max-w-24 truncate font-black text-[#334155] sm:max-w-36">
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
        className="min-h-8 rounded-lg border border-[#cbd5e1] px-2 py-1 font-black hover:bg-[#f1f5f9] disabled:opacity-50"
      >
        Гарах
      </button>
    </div>
  );
}

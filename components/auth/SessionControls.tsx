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
    <div className="fixed bottom-3 right-3 z-[120] flex items-center gap-2 rounded-xl border border-[#cbd5e1] bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur print:hidden">
      <span className="max-w-36 truncate font-black text-[#334155]">
        {displayName} · {ROLE_LABELS[role]}
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
        className="rounded-lg border border-[#cbd5e1] px-2 py-1 font-black hover:bg-[#f1f5f9] disabled:opacity-50"
      >
        Гарах
      </button>
    </div>
  );
}

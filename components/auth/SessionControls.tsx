"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { OpsRole } from "@/lib/auth-types";
import styles from "./Auth.module.css";

const ROLE_LABELS: Record<OpsRole, string> = {
  kitchen: "Гал тогоо",
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

  if (
    pathname === "/login" ||
    pathname === "/waiter" ||
    pathname === "/kitchen" ||
    role === "waiter" ||
    role === "kitchen"
  ) {
    return null;
  }

  return (
    <div className={styles.session}>
      <span className={styles.identity} title={`${displayName} · ${ROLE_LABELS[role]}`}>
        <span className={styles.displayName}>{displayName}</span>
        <span className={styles.role}>{ROLE_LABELS[role]}</span>
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
        className={styles.logoutButton}
      >
        {submitting ? "Гарч байна…" : "Гарах"}
      </button>
    </div>
  );
}

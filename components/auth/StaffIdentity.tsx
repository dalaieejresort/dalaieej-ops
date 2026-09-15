"use client";

import { useState } from "react";
import styles from "./Auth.module.css";

export function StaffIdentity({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className={styles.staffIdentity}>
    <span>Зөөгч · {name}</span>
    <button type="button" data-staff-switch disabled={busy} onClick={async () => {
      if (busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error("Гарч чадсангүй. Дахин оролдоно уу.");
        // Discard in-memory order state at this authentication boundary.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/login?next=%2Fwaiter");
      } catch {
        setError("Гарч чадсангүй. Холболтоо шалгаад дахин оролдоно уу.");
        setBusy(false);
      }
    }}>{busy ? "Гарч байна…" : "Түгжих / солих"}</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}

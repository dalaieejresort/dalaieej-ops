"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./Navigation.module.css";

export function ActionMenu({ label = "Бусад", children, className = "" }: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <details ref={ref} className={`${styles.menu} ${className}`} onKeyDown={event => {
      if (event.key === "Escape" && ref.current) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    }}>
      <summary><span className={styles.menuLabel}>{label}</span><span aria-hidden="true">⌄</span></summary>
      <div className={styles.menuPanel} onClick={event => {
        if ((event.target as HTMLElement).closest("button:not(:disabled), a") && ref.current) ref.current.open = false;
      }}>{children}</div>
    </details>
  );
}

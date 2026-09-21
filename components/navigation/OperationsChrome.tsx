"use client";

import Link from "next/link";
import type { OpsRole } from "@/lib/auth-types";
import { operationsNavigation, type RegisterTab } from "@/lib/pos/navigation";
import { OperationalChecks } from "@/components/system/OperationalChecks";
import { ActionMenu } from "./ActionMenu";
import styles from "./Navigation.module.css";

export function OperationsChrome({ role, active, tab, onTabChange, counts = {}, compact = false, service = false }: {
  role: OpsRole;
  active: "register" | "products" | "archive" | "kitchen" | "hotel";
  tab?: RegisterTab;
  onTabChange?: (tab: RegisterTab) => void;
  counts?: Partial<Record<RegisterTab, number>>;
  compact?: boolean;
  service?: boolean;
}) {
  const sections = operationsNavigation(role);
  const localTabs = !service || role === "waiter";
  const activeSection = service && role !== "waiter" ? "waiter" : active;
  const content = () => sections.map(section => (
    <div key={section.label} className={styles.group}>
      <p>{section.label}</p>
      {section.items.map(item => {
        const selected = item.tab ? activeSection === "register" && tab === item.tab : activeSection === item.id;
        const label = <>{item.label}{item.tab && !!counts[item.tab] && <span className={styles.count}>{counts[item.tab]}</span>}</>;
        return item.tab && onTabChange && localTabs ? (
          <button key={item.id} type="button" aria-current={selected ? "page" : undefined} onClick={() => onTabChange(item.tab!)}>{label}</button>
        ) : <Link key={item.id} href={item.href} aria-current={selected ? "page" : undefined}>{label}</Link>;
      })}
    </div>
  ));
  return <>
    <div className={styles.topbar}>
      <Link href="/">Dalai Eej</Link><span className={styles.context}>Operations</span>
      <ActionMenu label="Хэсгүүд" className={`${styles.mobileMenu} ${compact ? styles.alwaysMenu : ""}`}>
        <nav aria-label="Үйл ажиллагааны хэсгүүд">{content()}</nav>
      </ActionMenu>
      {(role === "manager" || role === "owner") && <OperationalChecks />}
    </div>
    {!compact && <nav className={styles.rail} aria-label="Үйл ажиллагааны үндсэн цэс">{content()}</nav>}
  </>;
}

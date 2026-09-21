import type { OpsRole } from "@/lib/auth-types";

export type RegisterTab = "sale" | "charges" | "history" | "day-close";
export type NavigationItem = { id: string; label: string; href: string; tab?: RegisterTab };
export type NavigationSection = { label: string; items: NavigationItem[] };

export function operationsNavigation(role: OpsRole, service = false): NavigationSection[] {
  const manager = role === "manager" || role === "owner";
  if (role === "kitchen") return [{ label: "Үйлчилгээ", items: [{ id: "kitchen", label: "Гал тогоо", href: "/kitchen" }] }];
  const base = service || role === "waiter" ? "/waiter" : "/register";
  const tabs: NavigationItem[] = [
    { id: "sale", tab: "sale", label: "Борлуулалт", href: `${base}?tab=sale` },
    { id: "charges", tab: "charges", label: "Өр", href: `${base}?tab=charges` },
    { id: "history", tab: "history", label: "Түүх", href: `${base}?tab=history` },
  ];
  if (role !== "waiter") tabs.push({ id: "day-close", tab: "day-close", label: "Өдрийн хаалт", href: `${base}?tab=day-close` });
  const sections: NavigationSection[] = [{ label: "Өдөр тутам", items: tabs }];
  if (manager) sections.push({ label: "Удирдлага", items: [
    { id: "products", label: "Бараа / Үлдэгдэл", href: "/products" },
    { id: "ops", label: "Өдрийн тойм", href: "/ops" },
    ...(role === "owner" ? [{ id: "archive", label: "Улирлын архив", href: "/archive" }] : []),
  ] });
  if (role !== "waiter") sections.push({ label: "Үйлчилгээ", items: [
    { id: "waiter", label: "Зөөгч", href: "/waiter" },
    ...(manager ? [{ id: "kitchen", label: "Гал тогоо", href: "/kitchen" }] : []),
  ] });
  if (manager) sections.push({ label: "Холбоос", items: [{ id: "finance", label: "Санхүү ↗", href: "https://receipts.dalaieej.mn/dashboard" }] });
  return sections;
}

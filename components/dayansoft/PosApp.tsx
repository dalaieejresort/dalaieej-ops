"use client";

import { useCallback, useEffect, useState } from "react";
import { FALLBACK_CATALOG } from "@/lib/pos/data";
import type {
  AppView,
  CartLine,
  CatalogItem,
  ItemCategory,
  TableDef,
  TableOrder,
} from "@/lib/pos/types";
import { ActionModal } from "./ActionModal";
import { FilterBar } from "./FilterBar";
import { OrderGridView } from "./OrderGridView";
import { PaymentModal } from "./PaymentModal";
import { PosHeader } from "./PosHeader";
import { PosOrderView } from "./PosOrderView";
import { SeatPlanView } from "./SeatPlanView";

function inferCategory(name: string): ItemCategory {
  const n = name.toLowerCase();
  if (n.includes("коктейл") || n.includes("mojito") || n.includes("мохито"))
    return "cocktail";
  if (
    n.includes("цай") ||
    n.includes("tea") ||
    n.includes("кофе") ||
    n.includes("coffee") ||
    n.includes("americano") ||
    n.includes("espresso") ||
    n.includes("latte") ||
    n.includes("капучино") ||
    n.includes("cappuccino")
  )
    return "Халуун ундаа";
  if (
    n.includes("cola") ||
    n.includes("fanta") ||
    n.includes("ундаа") ||
    n.includes("ус")
  )
    return "soft";
  if (
    n.includes("айраг") ||
    n.includes("beer") ||
    n.includes("hennessy") ||
    n.includes("blanche")
  )
    return "beer";
  return "food";
}

function normalizeCategory(category: unknown, name: string): ItemCategory {
  const sheetCategory = String(category ?? "").trim();
  return sheetCategory || inferCategory(name);
}

export function PosApp() {
  const [view, setView] = useState<AppView>("orders");
  const [tableLabel, setTableLabel] = useState("3 ширээ");
  const [staff, setStaff] = useState("Анхбаяр");
  const [cart, setCart] = useState<CartLine[]>([
    {
      id: "line-1",
      name: "Төмс",
      price: 18000,
      quantity: 1,
      staff: "Анхбаяр",
    },
    {
      id: "line-2",
      name: "Gem tower",
      price: 34200,
      quantity: 1,
      staff: "Анхбаяр",
    },
  ]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>("line-2");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory");
      const data = await res.json();
      if (Array.isArray(data)) {
        setCatalog(
          data.map((row: {
            sku: string;
            name: string;
            category?: string;
            price: number;
          }) => ({
            id: row.sku,
            sku: row.sku,
            name: row.name,
            price: row.price,
            category: normalizeCategory(row.category, row.name),
          })),
        );
      }
    } catch {
      setCatalog([]);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchCatalog();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [fetchCatalog]);

  function openPos(label: string) {
    setTableLabel(label);
    setView("pos");
  }

  function handleSelectOrder(order: TableOrder) {
    openPos(order.label);
  }

  function handleSelectTable(table: TableDef) {
    openPos(table.label);
  }

  function addToCart(item: CatalogItem) {
    const lineId = `${item.id}-${Date.now()}`;
    setCart((prev) => {
      const existing = prev.find((l) => l.name === item.name);
      if (existing) {
        return prev.map((l) =>
          l.name === item.name
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        );
      }
      return [
        ...prev,
        {
          id: lineId,
          sku: item.sku,
          name: item.name,
          price: item.price,
          category: item.category,
          quantity: 1,
          staff,
        },
      ];
    });
    setSelectedLineId(lineId);
  }

  function updateQuantity(id: string, qty: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.id === id ? { ...l, quantity: qty } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  const cartTotal = cart.reduce(
    (sum, line) => sum + line.price * line.quantity - (line.discount ?? 0),
    0,
  );

  async function handlePaymentConfirm(method: string) {
    try {
      await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart.map((l) => ({
            sku: l.sku ?? l.id,
            name: l.name,
            category: l.category,
            qty: l.quantity,
          })),
          method,
          staffName: staff,
        }),
      });
    } catch {
      // mockup — still clear cart on confirm
    }
    setCart([]);
    setShowPayment(false);
    setView("orders");
    alert("Төлбөр амжилттай!");
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#e8e8e8] text-[#222]">
      <PosHeader
        view={view}
        tableLabel={tableLabel}
        onNavigate={setView}
        onOpenActions={() => setShowActions(true)}
      />

      {view === "orders" && (
        <>
          <FilterBar
            onSeatPlan={() => setView("seatplan")}
            onRefresh={fetchCatalog}
          />
          <OrderGridView onSelectOrder={handleSelectOrder} />
        </>
      )}

      {view === "seatplan" && (
        <>
          <FilterBar
            onSeatPlan={() => setView("seatplan")}
            onRefresh={fetchCatalog}
          />
          <SeatPlanView onSelectTable={handleSelectTable} />
        </>
      )}

      {view === "pos" && (
        <PosOrderView
          catalog={catalog.length > 0 ? catalog : FALLBACK_CATALOG}
          tableLabel={tableLabel}
          staff={staff}
          onStaffChange={setStaff}
          cart={cart}
          selectedLineId={selectedLineId}
          onSelectLine={setSelectedLineId}
          onAddItem={addToCart}
          onUpdateQuantity={updateQuantity}
          onPay={() => setShowPayment(true)}
        />
      )}

      {showPayment && (
        <PaymentModal
          total={cartTotal}
          onClose={() => setShowPayment(false)}
          onConfirm={handlePaymentConfirm}
        />
      )}

      {showActions && (
        <ActionModal
          onClose={() => setShowActions(false)}
          onAction={(id) => {
            setShowActions(false);
            if (id === "refresh") fetchCatalog();
            if (id === "table") setView("seatplan");
            if (id === "internal") setView("pos");
          }}
        />
      )}
    </div>
  );
}

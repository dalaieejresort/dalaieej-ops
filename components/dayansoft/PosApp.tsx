"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FALLBACK_CATALOG, STAFF, TABLE_ORDERS } from "@/lib/pos/data";
import type {
  AppView,
  CartLine,
  CatalogItem,
  ItemCategory,
  PaymentAllocation,
  PriceMode,
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

const DEFAULT_STAFF = STAFF[0] ?? "Staff";
const POS_VIEW_STORAGE_KEY = "dalaieej.dayansoft.view";

function getCartTotal(cart: CartLine[]) {
  return cart.reduce(
    (sum, line) => sum + line.price * line.quantity - (line.discount ?? 0),
    0,
  );
}

function createLegacyCartLine(order: TableOrder): CartLine | null {
  if (order.amount <= 0) return null;

  return {
    id: `legacy:${order.id}`,
    name: "Өмнөх захиалга",
    price: order.amount,
    priceMode: "guest",
    category: "Үйлчилгээ",
    quantity: 1,
    staff: order.staff,
  };
}

function createInitialOrderCarts() {
  return TABLE_ORDERS.reduce<Record<string, CartLine[]>>((acc, order) => {
    const legacyLine = createLegacyCartLine(order);
    acc[order.id] = legacyLine ? [legacyLine] : [];
    return acc;
  }, {});
}

function createOrderFromTable(table: TableDef, staff: string): TableOrder {
  const tableNumber = table.label.match(/\d+/)?.[0];

  return {
    id: `o-${table.id}`,
    tableId: table.id,
    label: tableNumber ? `Ш-${tableNumber}` : table.label,
    amount: 0,
    staff,
    elapsed: "00:00",
  };
}

function isAppView(value: string | null): value is AppView {
  return value === "orders" || value === "seatplan" || value === "pos";
}

export function PosApp() {
  const [view, setView] = useState<AppView>("orders");
  const [tableLabel, setTableLabel] = useState("3 ширээ");
  const [staff, setStaff] = useState(DEFAULT_STAFF);
  const [orders, setOrders] = useState<TableOrder[]>(() => TABLE_ORDERS);
  const [orderCarts, setOrderCarts] = useState<Record<string, CartLine[]>>(
    createInitialOrderCarts,
  );
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const viewPreferenceLoadedRef = useRef(false);

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
            guestPrice?: number;
            staffPrice?: number;
          }) => ({
            id: row.sku,
            sku: row.sku,
            name: row.name,
            price: row.price,
            guestPrice: row.guestPrice,
            staffPrice: row.staffPrice,
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

  useEffect(() => {
    const storedView = window.localStorage.getItem(POS_VIEW_STORAGE_KEY);
    const readyTimer = window.setTimeout(() => {
      if (isAppView(storedView)) {
        setView(storedView);
      }
      viewPreferenceLoadedRef.current = true;
    }, 0);

    return () => window.clearTimeout(readyTimer);
  }, []);

  useEffect(() => {
    if (!viewPreferenceLoadedRef.current) return;
    window.localStorage.setItem(POS_VIEW_STORAGE_KEY, view);
  }, [view]);

  function openOrder(order: TableOrder) {
    setActiveOrderId(order.id);
    setTableLabel(order.label);
    setStaff(order.staff || DEFAULT_STAFF);
    setCart(orderCarts[order.id] ?? []);
    setSelectedLineId(null);
    setView("pos");
  }

  function handleSelectOrder(order: TableOrder) {
    openOrder(orders.find((item) => item.id === order.id) ?? order);
  }

  function handleSelectTable(table: TableDef) {
    const existingOrder = orders.find(
      (order) => order.tableId === table.id && !order.isSubOrder,
    );

    if (existingOrder) {
      openOrder(existingOrder);
      return;
    }

    const newOrder = createOrderFromTable(table, staff);
    setOrders((current) => [...current, newOrder]);
    setOrderCarts((current) => ({ ...current, [newOrder.id]: [] }));
    setActiveOrderId(newOrder.id);
    setTableLabel(newOrder.label);
    setCart([]);
    setSelectedLineId(null);
    setView("pos");
  }

  function openInternalOrder() {
    setActiveOrderId(null);
    setTableLabel("Дотоод");
    setCart([]);
    setSelectedLineId(null);
    setView("pos");
  }

  function syncOrderCart(orderId: string, nextCart: CartLine[], orderStaff = staff) {
    setOrderCarts((current) => ({
      ...current,
      [orderId]: nextCart,
    }));
    setOrders((current) =>
      current.map((order) =>
        order.id === orderId
          ? {
              ...order,
              amount: getCartTotal(nextCart),
              staff: orderStaff,
            }
          : order,
      ),
    );
  }

  function saveCart(nextCart: CartLine[]) {
    setCart(nextCart);
    if (activeOrderId) {
      syncOrderCart(activeOrderId, nextCart);
    }
  }

  function handleStaffChange(name: string) {
    setStaff(name);
    if (activeOrderId) {
      setOrders((current) =>
        current.map((order) =>
          order.id === activeOrderId ? { ...order, staff: name } : order,
        ),
      );
    }
  }

  function addToCart(item: CatalogItem, priceMode: PriceMode = "guest") {
    const hasGuestPrice =
      typeof item.guestPrice === "number"
        ? item.guestPrice > 0
        : item.price > 0 && !(item.staffPrice && item.staffPrice > 0);
    const hasStaffPrice = Boolean(item.staffPrice && item.staffPrice > 0);
    const resolvedPriceMode =
      priceMode === "guest" && !hasGuestPrice && hasStaffPrice
        ? "staff"
        : priceMode;
    const lineId = `${item.sku ?? item.id}:${resolvedPriceMode}`;
    const linePrice =
      resolvedPriceMode === "staff" && item.staffPrice && item.staffPrice > 0
        ? item.staffPrice
        : item.guestPrice ?? item.price;
    const existing = cart.find((l) => l.id === lineId);
    const nextCart = existing
      ? cart.map((l) =>
          l.id === lineId
            ? { ...l, quantity: l.quantity + 1 }
            : l,
        )
      : [
          ...cart,
          {
            id: lineId,
            sku: item.sku,
            name: item.name,
            price: linePrice,
            priceMode: resolvedPriceMode,
            category: item.category,
            quantity: 1,
            staff,
          },
        ];

    saveCart(nextCart);
    setSelectedLineId(lineId);
  }

  function updateQuantity(id: string, qty: number) {
    saveCart(
      cart
        .map((line) => (line.id === id ? { ...line, quantity: qty } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function removeSelectedLine() {
    if (!selectedLineId) return;
    saveCart(cart.filter((line) => line.id !== selectedLineId));
    setSelectedLineId(null);
  }

  const cartTotal = getCartTotal(cart);

  async function handlePaymentConfirm(payments: PaymentAllocation[]) {
    const paymentMethod = payments.map((payment) => payment.label).join(" + ");
    const cashReceived = payments.reduce(
      (sum, payment) => sum + (payment.cashReceived ?? 0),
      0,
    );
    const changeDue = payments.reduce(
      (sum, payment) => sum + (payment.changeDue ?? 0),
      0,
    );
    const closingOrderId = activeOrderId;

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
            unitPrice: l.price,
          })),
          method: paymentMethod,
          staffName: staff,
          total: cartTotal,
          cashReceived,
          changeDue,
          payments: payments.map((payment) => ({
            paymentMethod: payment.label,
            amount: payment.amount,
            cashReceived: payment.cashReceived,
            changeDue: payment.changeDue,
            qpayInvoiceId: payment.qpayInvoiceId,
          })),
        }),
      });
    } catch {
      // mockup — still clear cart on confirm
    }
    setCart([]);
    if (closingOrderId) {
      setOrderCarts((current) => ({ ...current, [closingOrderId]: [] }));
      setOrders((current) =>
        current.map((order) =>
          order.id === closingOrderId
            ? { ...order, amount: 0, orderCount: undefined, elapsed: "00:00" }
            : order,
        ),
      );
      setActiveOrderId(null);
    }
    setSelectedLineId(null);
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
          <OrderGridView orders={orders} onSelectOrder={handleSelectOrder} />
        </>
      )}

      {view === "seatplan" && (
        <>
          <FilterBar
            onSeatPlan={() => setView("seatplan")}
            onRefresh={fetchCatalog}
          />
          <SeatPlanView orders={orders} onSelectTable={handleSelectTable} />
        </>
      )}

      {view === "pos" && (
        <PosOrderView
          catalog={catalog.length > 0 ? catalog : FALLBACK_CATALOG}
          tableLabel={tableLabel}
          staff={staff}
          onStaffChange={handleStaffChange}
          cart={cart}
          selectedLineId={selectedLineId}
          onSelectLine={setSelectedLineId}
          onAddItem={addToCart}
          onUpdateQuantity={updateQuantity}
          onRemoveSelectedLine={removeSelectedLine}
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
            if (id === "internal") openInternalOrder();
          }}
        />
      )}
    </div>
  );
}

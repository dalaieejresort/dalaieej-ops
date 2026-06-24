"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_COLORS,
  FALLBACK_CATALOG,
  STAFF,
} from "@/lib/pos/data";
import { formatNumber } from "@/lib/pos/utils";
import type { CartLine, CatalogItem, ItemCategory } from "@/lib/pos/types";

interface PosOrderViewProps {
  catalog: CatalogItem[];
  tableLabel: string;
  staff: string;
  onStaffChange: (name: string) => void;
  cart: CartLine[];
  selectedLineId: string | null;
  onSelectLine: (id: string | null) => void;
  onAddItem: (item: CatalogItem) => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onPay: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  all: "Бүгд",
  food: "Хоол",
  beer: "Шар айраг",
  soft: "Ундаа",
  cocktail: "Коктейль",
  menu: "Меню",
};

function getCategoryLabel(category: ItemCategory | "all") {
  return CATEGORY_LABELS[category] ?? category;
}

function getCategoryColor(category: ItemCategory | "all") {
  return CATEGORY_COLORS[category] ?? "#6b9e5a";
}

export function PosOrderView({
  catalog,
  tableLabel,
  staff,
  onStaffChange,
  cart,
  selectedLineId,
  onSelectLine,
  onAddItem,
  onUpdateQuantity,
  onPay,
}: PosOrderViewProps) {
  const [activeCategory, setActiveCategory] = useState<ItemCategory | "all">("all");
  const [search, setSearch] = useState("");
  const [numpadValue, setNumpadValue] = useState("");

  const items = catalog.length > 0 ? catalog : FALLBACK_CATALOG;

  const filteredItems = useMemo(() => {
    let list = items.filter((i) => !i.isCategory);
    if (activeCategory !== "all") {
      list = list.filter((i) => i.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((i) => i.name.toLowerCase().includes(q));
    }
    return list;
  }, [items, activeCategory, search]);

  const categories = useMemo(() => {
    const unique = Array.from(
      new Set(items.filter((item) => !item.isCategory).map((item) => item.category)),
    );
    return ["all", ...unique];
  }, [items]);

  const categoryTiles = items.filter((i) => i.isCategory);
  const sellableTiles = filteredItems;

  const total = cart.reduce(
    (sum, line) => sum + line.price * line.quantity - (line.discount ?? 0),
    0,
  );

  function handleNumpad(key: string) {
    if (key === "C") {
      setNumpadValue("");
      return;
    }
    if (key === "⌫") {
      setNumpadValue((v) => v.slice(0, -1));
      return;
    }
    const next = numpadValue + key;
    setNumpadValue(next);
    if (selectedLineId) {
      const qty = parseInt(next, 10);
      if (!Number.isNaN(qty) && qty > 0) {
        onUpdateQuantity(selectedLineId, qty);
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Left — cart & checkout (Dayansoft style) */}
      <section className="flex w-[42%] min-w-[320px] flex-col border-r border-[#bbb] bg-[#e8e8e8]">
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          <table className="w-full text-sm">
            <tbody>
              {cart.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-[#888]">
                    Захиалга хоосон байна
                  </td>
                </tr>
              ) : (
                cart.map((line, idx) => {
                  const selected = selectedLineId === line.id;
                  const lineTotal = line.price * line.quantity - (line.discount ?? 0);
                  return (
                    <tr
                      key={line.id}
                      onClick={() => onSelectLine(line.id)}
                      className={`cursor-pointer border-b border-[#ddd] ${
                        selected ? "bg-[#3b9dd4] text-white" : "hover:bg-[#f5f5f5]"
                      }`}
                    >
                      <td className="w-8 px-2 py-2 text-center text-[#888]">
                        {selected ? "▶" : idx + 1}
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-semibold">{line.name}</div>
                        <div
                          className={`text-xs ${selected ? "text-white/80" : "text-[#888]"}`}
                        >
                          {line.staff}
                        </div>
                      </td>
                      <td className="w-12 px-2 py-2 text-center text-lg font-bold">
                        {line.quantity}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="font-bold">{formatNumber(lineTotal)}</div>
                        {line.discount ? (
                          <div className="text-xs text-red-400">
                            -{formatNumber(line.discount)}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 border-t border-[#bbb] bg-[#e0e0e0]">
          <div className="flex flex-wrap gap-1 border-b border-[#ccc] p-1">
            {["Салгах", "Нэгтгэх", "Цуцлах", "Ширээ", "Tags", "Тооцоо"].map(
              (label) => (
                <button
                  key={label}
                  type="button"
                  className="rounded border border-[#aaa] bg-[#f0f0f0] px-2 py-1 text-xs hover:bg-white"
                >
                  {label}
                </button>
              ),
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] gap-1 p-2">
            <div className="flex flex-col gap-1">
              {["Хүргэлт", "Гишүүн", "Хөнгөлөлт", "Үнийн жагсаалт", "Харилцагч"].map(
                (label) => (
                  <button
                    key={label}
                    type="button"
                    className="rounded border border-[#aaa] bg-[#f5f5f5] px-2 py-2 text-left text-xs hover:bg-white"
                  >
                    {label}
                  </button>
                ),
              )}
            </div>

            <div className="w-[140px]">
              <button
                type="button"
                className="mb-1 w-full rounded border border-[#aaa] bg-white py-1 text-xs"
              >
                Захиалах · {tableLabel}
              </button>
              <div className="grid grid-cols-3 gap-0.5">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(
                  (key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleNumpad(key)}
                      className="flex h-10 items-center justify-center rounded border border-[#bbb] bg-white text-base font-semibold hover:bg-[#f0f0f0] active:bg-[#ddd]"
                    >
                      {key === "C" ? "Шинэ" : key}
                    </button>
                  ),
                )}
              </div>
            </div>

            <div className="flex flex-col">
              <div className="mb-2 flex-1 rounded border border-[#aaa] bg-white p-3">
                <div className="text-xs text-[#666]">Төлөх</div>
                <div className="text-3xl font-extrabold tracking-tight">
                  {formatNumber(total)}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  selectedLineId &&
                  onUpdateQuantity(
                    selectedLineId,
                    (cart.find((l) => l.id === selectedLineId)?.quantity ?? 1) + 1,
                  )
                }
                className="mb-1 rounded bg-[#3b9dd4] py-3 text-sm font-bold text-white hover:bg-[#2d8fc8]"
              >
                Тоо
              </button>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  className="rounded bg-[#3b9dd4] py-2 text-xs font-bold text-white"
                >
                  Хөнгөлөлт
                </button>
                <button
                  type="button"
                  className="rounded bg-[#3b9dd4] py-2 text-xs font-bold text-white"
                >
                  Үнэ
                </button>
              </div>
              <button
                type="button"
                onClick={onPay}
                disabled={cart.length === 0}
                className="mt-1 rounded bg-[#3b9dd4] py-4 text-base font-extrabold text-white hover:bg-[#2d8fc8] disabled:bg-[#aaa]"
              >
                Төлөх
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Right — menu grid */}
      <section className="flex min-w-0 flex-1 flex-col bg-[#e8e8e8]">
        <div className="shrink-0 border-b border-[#bbb] bg-white p-2">
          <div className="flex items-center rounded border border-[#bbb] bg-white px-3">
            <span className="text-[#888]">|||</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Хайх (F4)"
              className="flex-1 bg-transparent px-2 py-2 text-sm outline-none"
            />
            <span className="text-[#888]">🔍</span>
          </div>
        </div>

        <div className="shrink-0 flex gap-1 overflow-x-auto border-b border-[#ccc] bg-white p-2">
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={`shrink-0 rounded px-4 py-2 text-sm font-semibold text-white ${
                activeCategory === category ? "ring-2 ring-black/30" : "opacity-90"
              }`}
              style={{ backgroundColor: getCategoryColor(category) }}
            >
              {getCategoryLabel(category)}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {categoryTiles.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setActiveCategory(cat.category)}
                className="relative flex min-h-[90px] flex-col items-start justify-between rounded border border-[#999]/30 p-2 text-left font-bold text-[#333] shadow-sm active:scale-[0.98]"
                style={{ backgroundColor: cat.color ?? "#d4c4a8" }}
              >
                <span>{cat.name}</span>
                <span className="text-lg">›</span>
              </button>
            ))}
            {sellableTiles.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onAddItem(item)}
                className="relative flex min-h-[90px] flex-col justify-between rounded border border-[#999]/30 p-2 text-left font-semibold text-[#333] shadow-sm active:scale-[0.98]"
                style={{
                  backgroundColor:
                    getCategoryColor(item.category),
                }}
              >
                <span className="text-sm leading-tight">{item.name}</span>
                <span className="self-end rounded bg-[#555] px-1.5 py-0.5 text-xs font-bold text-white">
                  {formatNumber(item.price)} ₮
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 gap-1 border-t border-[#bbb] p-2">
          {STAFF.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onStaffChange(name)}
              className={`flex-1 rounded py-3 text-sm font-bold ${
                staff === name
                  ? "bg-[#3b9dd4] text-white"
                  : "border border-[#bbb] bg-[#d4c4a8] text-[#333]"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

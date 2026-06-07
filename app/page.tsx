"use client";

import { useMemo, useState } from "react";

type ItemCategory = "beer" | "soft" | "cocktail" | "food";

type CategoryFilter = "all" | ItemCategory;

interface MenuItem {
  id: string;
  name: string;
  price: number;
  category: ItemCategory;
  accent: string;
  emoji: string;
}

interface CartLine {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

const CATEGORIES: { id: CategoryFilter; label: string }[] = [
  { id: "all", label: "Бүгд" },
  { id: "beer", label: "Шар айраг" },
  { id: "soft", label: "Ундаа" },
  { id: "cocktail", label: "Коктейль" },
  { id: "food", label: "Хоол" },
];

const MENU_ITEMS: MenuItem[] = [
  {
    id: "beer-1",
    name: "Сэнгүр 0.5л",
    price: 8500,
    category: "beer",
    accent: "bg-amber-400",
    emoji: "🍺",
  },
  {
    id: "beer-2",
    name: "Гэрэл 0.5л",
    price: 8000,
    category: "beer",
    accent: "bg-yellow-400",
    emoji: "🍺",
  },
  {
    id: "beer-3",
    name: "Хаан 0.5л",
    price: 7500,
    category: "beer",
    accent: "bg-orange-300",
    emoji: "🍺",
  },
  {
    id: "beer-4",
    name: "Corona 0.33л",
    price: 12000,
    category: "beer",
    accent: "bg-lime-400",
    emoji: "🍺",
  },
  {
    id: "soft-1",
    name: "Coca-Cola",
    price: 4500,
    category: "soft",
    accent: "bg-red-500",
    emoji: "🥤",
  },
  {
    id: "soft-2",
    name: "Sprite",
    price: 4500,
    category: "soft",
    accent: "bg-green-400",
    emoji: "🥤",
  },
  {
    id: "soft-3",
    name: "Ус 0.5л",
    price: 2000,
    category: "soft",
    accent: "bg-sky-300",
    emoji: "💧",
  },
  {
    id: "soft-4",
    name: "Лимонад",
    price: 5500,
    category: "soft",
    accent: "bg-yellow-300",
    emoji: "🍋",
  },
  {
    id: "cocktail-1",
    name: "Мохито",
    price: 18000,
    category: "cocktail",
    accent: "bg-emerald-400",
    emoji: "🍹",
  },
  {
    id: "cocktail-2",
    name: "Маргарита",
    price: 20000,
    category: "cocktail",
    accent: "bg-teal-400",
    emoji: "🍸",
  },
  {
    id: "cocktail-3",
    name: "Пина колада",
    price: 22000,
    category: "cocktail",
    accent: "bg-cyan-300",
    emoji: "🥥",
  },
  {
    id: "cocktail-4",
    name: "Дайкири",
    price: 19000,
    category: "cocktail",
    accent: "bg-pink-400",
    emoji: "🍹",
  },
  {
    id: "food-1",
    name: "Хагас бөөрөнхий хахаш",
    price: 15000,
    category: "food",
    accent: "bg-orange-400",
    emoji: "🥟",
  },
  {
    id: "food-2",
    name: "Шорлог",
    price: 25000,
    category: "food",
    accent: "bg-red-400",
    emoji: "🍖",
  },
  {
    id: "food-3",
    name: "Салат",
    price: 12000,
    category: "food",
    accent: "bg-lime-300",
    emoji: "🥗",
  },
  {
    id: "food-4",
    name: "Тахиа шарсан",
    price: 28000,
    category: "food",
    accent: "bg-amber-500",
    emoji: "🍗",
  },
  {
    id: "food-5",
    name: "Бууз (6 ширхэг)",
    price: 14000,
    category: "food",
    accent: "bg-stone-400",
    emoji: "🥟",
  },
  {
    id: "beer-5",
    name: "Heineken 0.33л",
    price: 11000,
    category: "beer",
    accent: "bg-green-500",
    emoji: "🍺",
  },
];

function formatMNT(amount: number): string {
  return `${amount.toLocaleString("mn-MN")} ₮`;
}

export default function PosDashboard() {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");
  const [cart, setCart] = useState<CartLine[]>([]);

  const filteredItems = useMemo(
    () =>
      activeCategory === "all"
        ? MENU_ITEMS
        : MENU_ITEMS.filter((item) => item.category === activeCategory),
    [activeCategory],
  );

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.price * line.quantity, 0),
    [cart],
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, line) => sum + line.quantity, 0),
    [cart],
  );

  function addToCart(item: MenuItem) {
    setCart((prev) => {
      const existing = prev.find((line) => line.id === item.id);
      if (existing) {
        return prev.map((line) =>
          line.id === item.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
        },
      ];
    });
  }

  function updateQuantity(id: string, delta: number) {
    setCart((prev) =>
      prev
        .map((line) =>
          line.id === id
            ? { ...line, quantity: line.quantity + delta }
            : line,
        )
        .filter((line) => line.quantity > 0),
    );
  }

  function handleCheckout() {
    if (cart.length === 0) return;
    alert(
      `Захиалга батлагдлаа!\nНийт: ${formatMNT(cartTotal)}\nБараа: ${cartCount} ширхэг`,
    );
    setCart([]);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
            Dalai Eej Resort
          </p>
          <h1 className="text-xl font-bold text-slate-900">
            Борлуулалтын цэг
          </h1>
        </div>
        <div className="flex items-center gap-3 rounded-xl bg-slate-100 px-4 py-2">
          <span className="text-sm font-medium text-slate-600">Сагс</span>
          <span className="flex h-9 min-w-9 items-center justify-center rounded-full bg-amber-500 px-2 text-sm font-bold text-white">
            {cartCount}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Menu grid — ~2/3 */}
        <section className="flex min-h-0 flex-[2] flex-col border-r border-slate-200 bg-white">
          <div className="shrink-0 border-b border-slate-100 px-4 py-3">
            <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`shrink-0 rounded-xl px-5 py-3 text-base font-semibold transition-colors active:scale-[0.98] ${
                    activeCategory === cat.id
                      ? "bg-amber-500 text-white shadow-md shadow-amber-500/30"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => addToCart(item)}
                  className="group flex min-h-[140px] flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white text-left shadow-sm transition-all active:scale-[0.97] hover:border-amber-400 hover:shadow-md"
                >
                  <div
                    className={`flex h-20 items-center justify-center ${item.accent}`}
                  >
                    <span className="text-4xl" aria-hidden>
                      {item.emoji}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-between p-3">
                    <p className="text-base font-bold leading-tight text-slate-900">
                      {item.name}
                    </p>
                    <p className="mt-2 text-lg font-extrabold text-amber-700">
                      {formatMNT(item.price)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Cart — ~1/3 */}
        <aside className="flex min-h-0 flex-1 flex-col bg-slate-50 lg:max-w-md lg:flex-[1]">
          <div className="shrink-0 border-b border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xl font-bold text-slate-900">
              Одоогийн захиалга
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Бараа сонгохын тулд зүүн талд дарна уу
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {cart.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-200 bg-white p-8 text-center">
                <span className="text-5xl opacity-40" aria-hidden>
                  🛒
                </span>
                <p className="mt-4 text-lg font-semibold text-slate-500">
                  Сагс хоосон байна
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  Цэснээс бараа нэмнэ үү
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {cart.map((line) => (
                  <li
                    key={line.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-base font-bold text-slate-900">
                        {line.name}
                      </p>
                      <p className="shrink-0 text-base font-bold text-slate-800">
                        {formatMNT(line.price * line.quantity)}
                      </p>
                    </div>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {formatMNT(line.price)} × {line.quantity}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.id, -1)}
                          className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-2xl font-bold text-slate-700 transition-colors active:bg-slate-200 hover:bg-slate-200"
                          aria-label={`${line.name} хасах`}
                        >
                          −
                        </button>
                        <span className="min-w-[2.5rem] text-center text-xl font-bold">
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(line.id, 1)}
                          className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-2xl font-bold text-amber-800 transition-colors active:bg-amber-200 hover:bg-amber-200"
                          aria-label={`${line.name} нэмэх`}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white p-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)]">
            <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-900 px-5 py-4 text-white">
              <span className="text-lg font-semibold">Нийт дүн</span>
              <span className="text-2xl font-extrabold tracking-tight">
                {formatMNT(cartTotal)}
              </span>
            </div>
            <button
              type="button"
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full rounded-2xl bg-amber-500 py-5 text-xl font-extrabold text-white shadow-lg shadow-amber-500/40 transition-all active:scale-[0.99] hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
            >
              Төлбөр авах
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

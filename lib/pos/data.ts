import type { CatalogItem, TableDef, TableOrder, ZoneTab } from "./types";

export const STAFF = ["Анхбаяр", "Оюунбаатар", "Батболд"];

export const ZONE_TABS: ZoneTab[] = [
  { id: "all", label: "(Бүгд)", occupied: 7, total: 34, color: "#c4a882" },
  { id: "a", label: "A заал", occupied: 3, total: 10, color: "#c4a882" },
  { id: "b", label: "B заал", occupied: 0, total: 7, color: "#c4a882" },
  { id: "c", label: "C заал", occupied: 0, total: 4, color: "#9b7bb8" },
  { id: "d", label: "D заал", occupied: 2, total: 6, color: "#b85c38" },
  { id: "vip", label: "VIP", occupied: 1, total: 6, color: "#3d6b4f" },
  { id: "bar", label: "Тек", occupied: 1, total: 1, color: "#4a4a4a" },
];

export const TABLES: TableDef[] = [
  { id: "bar", label: "Тек", zone: "bar", shape: "bar", x: 8, y: 4, w: 84, h: 10, color: "#d4c4a8", badge: 3, occupied: true },
  { id: "t1", label: "1 ширээ", zone: "a", shape: "circle", x: 6, y: 20, w: 14, h: 18, color: "#5ba4b8", occupied: true },
  { id: "t2", label: "2 ширээ", zone: "a", shape: "square", x: 24, y: 20, w: 14, h: 16, color: "#d4c4a8" },
  { id: "t3", label: "3 ширээ", zone: "a", shape: "square", x: 42, y: 20, w: 14, h: 16, color: "#d4c4a8", badge: 2, occupied: true },
  { id: "t4", label: "4 ширээ", zone: "d", shape: "square", x: 60, y: 20, w: 14, h: 16, color: "#c44e3a", occupied: true },
  { id: "t5", label: "5 ширээ", zone: "a", shape: "circle", x: 78, y: 20, w: 14, h: 18, color: "#2e5f8a", occupied: true },
  { id: "t6", label: "6 ширээ", zone: "d", shape: "rect", x: 24, y: 42, w: 28, h: 16, color: "#e8913a", badge: 1, occupied: true },
  { id: "t7", label: "7 ширээ", zone: "a", shape: "square", x: 58, y: 42, w: 14, h: 16, color: "#d4c4a8" },
  { id: "t8", label: "8 ширээ", zone: "b", shape: "square", x: 6, y: 64, w: 14, h: 16, color: "#2e5f8a" },
  { id: "t9", label: "9 ширээ", zone: "b", shape: "square", x: 24, y: 64, w: 14, h: 16, color: "#2e5f8a" },
];

export const TABLE_ORDERS: TableOrder[] = [
  { id: "o-sh3", tableId: "t3", label: "Ш-3", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-sh4", tableId: "t4", label: "Ш-4", amount: 18000, staff: "Батболд", orderCount: 2, elapsed: "00:00" },
  { id: "o-sh4-1", tableId: "t4", label: "# 4", amount: 9000, staff: "Батболд", isSubOrder: true, elapsed: "00:00" },
  { id: "o-sh4-2", tableId: "t4", label: "# 3", amount: 9000, staff: "Батболд", isSubOrder: true, elapsed: "00:00" },
  { id: "o-sh5", tableId: "t5", label: "Ш-5", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-sh6", tableId: "t6", label: "Ш-6", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-sh7", tableId: "t7", label: "Ш-7", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-sh8", tableId: "t8", label: "Ш-8", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-sh9", tableId: "t9", label: "Ш-9", amount: 0, staff: "Батболд", elapsed: "00:00" },
  { id: "o-bar", tableId: "bar", label: "Тек", amount: 0, staff: "Батболд", elapsed: "00:00" },
];

export const FALLBACK_CATALOG: CatalogItem[] = [
  { id: "cat-menu", name: "Меню", category: "menu", price: 0, isCategory: true, color: "#e8913a" },
  { id: "cat-gift", name: "Бэлгийн карт", category: "gift", price: 0, isCategory: true, color: "#9b7bb8" },
  { id: "cat-dessert", name: "Амттан", category: "dessert", price: 0, isCategory: true, color: "#a8d4e6" },
  { id: "food-1", name: "Төмс", category: "food", price: 18000 },
  { id: "food-2", name: "Gem tower", category: "food", price: 34200 },
  { id: "beer-1", name: "Сэнгүр 0.5л", category: "beer", price: 8500 },
  { id: "beer-2", name: "Blanche De Namur 0.33", category: "beer", price: 12500 },
  { id: "soft-1", name: "Coca-Cola", category: "soft", price: 4500 },
  { id: "soft-2", name: "Fanta", category: "soft", price: 1500 },
  { id: "cocktail-1", name: "Мохито", category: "cocktail", price: 18000 },
  { id: "cocktail-2", name: "Маргарита", category: "cocktail", price: 20000 },
  { id: "food-3", name: "Шорлог", category: "food", price: 25000 },
  { id: "food-4", name: "Салат", category: "food", price: 12000 },
  { id: "food-5", name: "Шарсан тахиа", category: "food", price: 28000 },
  { id: "beer-3", name: "Hennessy XO 50гр", category: "beer", price: 380000 },
];

export const CATEGORY_COLORS: Record<string, string> = {
  menu: "#e8913a",
  gift: "#9b7bb8",
  dessert: "#a8d4e6",
  food: "#d4c4a8",
  beer: "#d4c4a8",
  soft: "#d4c4a8",
  cocktail: "#d4c4a8",
};

export const PAYMENT_METHODS = [
  { id: "card", label: "Карт", icon: "💳" },
  { id: "mobile", label: "Mobile", icon: "📱" },
  { id: "epos", label: "ePos", icon: "🟢" },
  { id: "ippos", label: "IPPOS", icon: "🔵" },
  { id: "xacpos", label: "XacPos", icon: "⭐" },
  { id: "qr", label: "QR pay", icon: "▦" },
  { id: "gift", label: "Бэлгийн карт ₮", icon: "🎁" },
  { id: "credit", label: "Ашиглах мөнгө", icon: "👤" },
  { id: "account", label: "Тооцоо", icon: "🧾" },
];

export const ACTION_ITEMS = [
  { id: "internal", label: "ДОТООД ЗАХИАЛГА ҮҮСГЭХ", icon: "✈" },
  { id: "refresh", label: "МЭДЭЭЛЭЛ ШИНЭЧЛЭХ (F5)", icon: "🔄" },
  { id: "member", label: "ГИШҮҮНЧЛЭЛ", icon: "👥" },
  { id: "stock", label: "БАРААНЫ ҮЛДЭГДЭЛ ШАЛГАХ (F2)", icon: "📦" },
  { id: "cash", label: "МӨНГӨ НЭМЭХ, ХАСАХ", icon: "💰" },
  { id: "report", label: "ТАЙЛАН ХАРАХ", icon: "📊" },
  { id: "close", label: "ХААЛТ ХИЙХ (END OF DAY)", icon: "🔒" },
  { id: "table", label: "ШИРЭЭ/ЗӨӨГЧ ТОХИРУУЛАХ", icon: "🪑" },
  { id: "printer", label: "ПРИНТЕР ТОХИРУУЛАХ", icon: "🖨" },
  { id: "help", label: "ТУСЛАМЖ", icon: "❓" },
  { id: "vat", label: "НӨАТУС ИЛГЭЭХ", icon: "📤" },
  { id: "settings", label: "ТОХИРГОО", icon: "⚙" },
];

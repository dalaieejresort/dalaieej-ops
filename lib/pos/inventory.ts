export const UNLIMITED_INVENTORY_CATEGORIES = new Set<string>([
  "food",
  "dessert",
  "Европ, Ази хоол",
  "\"I\" хоол",
  "I хоол",
  "1-р хоол",
  "1 хоол",
  "\"II\" хоол",
  "II хоол",
  "2-р хоол",
  "2 хоол",
  "Хачир",
  "Монгол хоол",
  "Шөл",
  "Цагаан хоол",
  "Хүүхдийн хоол",
  "Өдрийн онцлох хоол",
  "Цай, кофе",
  "Цай кофе",
  "Цай",
  "Кофе",
  "Халуун ундаа",
  "cocktail",
  "Коктейль",
  "Коктейл",
  "Сет",
  "Түрээс",
  "Түрээс, цагийн",
  "Түрээсийн",
  "Түрээсийн бараа",
  "Түрээсийн зүйлс",
  "Үйлчилгээ",
]);

function normalizeInventoryCategory(category: unknown) {
  return String(category ?? "")
    .normalize("NFKC")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/["'`]/g, "")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("mn-MN");
}

const NORMALIZED_UNLIMITED_INVENTORY_CATEGORIES = new Set(
  Array.from(UNLIMITED_INVENTORY_CATEGORIES).map((category) =>
    normalizeInventoryCategory(category),
  ),
);

export function isUnlimitedInventoryCategory(category: unknown) {
  const normalized = normalizeInventoryCategory(category);
  if (NORMALIZED_UNLIMITED_INVENTORY_CATEGORIES.has(normalized)) return true;

  return (
    normalized.includes("түрээс") ||
    normalized.includes("rental") ||
    normalized.includes("халуун ундаа") ||
    normalized.includes("hot drink") ||
    normalized.includes("cocktail") ||
    normalized.includes("коктей") ||
    normalized.includes("үйлчилгээ") ||
    normalized.includes("service")
  );
}

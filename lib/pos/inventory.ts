export const UNLIMITED_INVENTORY_CATEGORIES = new Set<string>([
  "food",
  "dessert",
  "Европ, Ази хоол",
  "Хачир",
  "Монгол хоол",
  "Шөл",
  "Цагаан хоол",
  "Хүүхдийн хоол",
  "Өдрийн онцлох хоол",
  "Халуун ундаа",
  "Түрээс, цагийн",
]);

export function isUnlimitedInventoryCategory(category: unknown) {
  return UNLIMITED_INVENTORY_CATEGORIES.has(String(category ?? "").trim());
}

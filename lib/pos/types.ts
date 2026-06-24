export type AppView = "orders" | "seatplan" | "pos";

export type ItemCategory = string;

export interface CatalogItem {
  id: string;
  sku?: string;
  name: string;
  price: number;
  category: ItemCategory;
  stock?: number;
  isCategory?: boolean;
  color?: string;
}

export interface CartLine {
  id: string;
  sku?: string;
  name: string;
  price: number;
  category?: ItemCategory;
  quantity: number;
  staff: string;
  discount?: number;
}

export interface TableOrder {
  id: string;
  tableId: string;
  label: string;
  amount: number;
  staff: string;
  orderCount?: number;
  isSubOrder?: boolean;
  elapsed: string;
}

export interface TableDef {
  id: string;
  label: string;
  zone: string;
  shape: "square" | "circle" | "rect" | "bar";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  badge?: number;
  occupied?: boolean;
}

export interface ZoneTab {
  id: string;
  label: string;
  occupied: number;
  total: number;
  color: string;
}

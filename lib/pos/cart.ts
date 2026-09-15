import type { CartLine, ItemCategory } from "./types";

type CartItem = CartLine & { category: ItemCategory };

export type CartState = {
  items: CartItem[];
  lastAddition: { previousItems: CartItem[]; name: string } | null;
};

type CartAction =
  | { type: "add"; item: CartItem }
  | { type: "replace"; items: CartItem[] | ((items: CartItem[]) => CartItem[]) }
  | { type: "undo-addition" };

export function cartReducer(state: CartState, action: CartAction): CartState {
  if (action.type === "replace") {
    return {
      items: typeof action.items === "function" ? action.items(state.items) : action.items,
      lastAddition: null,
    };
  }
  if (action.type === "undo-addition") {
    return state.lastAddition
      ? { items: state.lastAddition.previousItems, lastAddition: null }
      : state;
  }
  const existing = state.items.some(item => item.id === action.item.id);
  return {
    items: existing
      ? state.items.map(item => item.id === action.item.id
        ? { ...item, quantity: item.quantity + action.item.quantity }
        : item)
      : [...state.items, action.item],
    lastAddition: { previousItems: state.items, name: action.item.name },
  };
}

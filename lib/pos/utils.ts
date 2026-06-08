export function formatMNT(amount: number): string {
  return `${Math.round(amount).toLocaleString("mn-MN")} ₮`;
}

export function formatNumber(amount: number): string {
  return Math.round(amount).toLocaleString("mn-MN");
}

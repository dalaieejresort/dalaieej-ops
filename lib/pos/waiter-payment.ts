/** A staff-entered reference is evidence for later reconciliation, not bank verification. */
export function waiterPaymentError(payment: {
  paymentMethod?: string;
  amount?: number;
  notes?: string;
}): string | null {
  if (!Number.isFinite(payment.amount) || Number(payment.amount) <= 0) {
    return "Төлбөрийн дүн эерэг тоо байна.";
  }
  const method = (payment.paymentMethod ?? "").trim().toLowerCase();
  if (["cash", "бэлэн"].includes(method)) return null;
  if (!["card", "карт", "bank", "данс"].includes(method)) {
    return "Зөөгчийн төлбөрийн хэлбэр: бэлэн, карт эсвэл данс.";
  }
  if (!payment.notes?.trim()) return "Терминал / шилжүүлгийн баримтын дугаарыг бичнэ үү.";
  return null;
}

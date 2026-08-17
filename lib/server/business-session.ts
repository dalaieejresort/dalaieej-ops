import "server-only";

import { compactBusinessDate } from "@/lib/pos/payment-controls";

export const BUSINESS_CONTEXT_HEADERS = [
  "session_id",
  "business_date",
] as const;

export const DAY_SESSION_HEADERS = [
  "business_date",
  "opened_at",
  "opened_by",
  "starting_cash",
  "status",
  "closed_at",
  "closed_by",
  "counted_cash",
  "expected_cash",
  "cash_difference",
  "payment_total",
  "cash_payment_total",
  "card_payment_total",
  "qpay_payment_total",
  "other_payment_total",
  "room_charge_total",
  "sales_total",
  "notes",
  "session_id",
  "receipt_count",
  "first_receipt_id",
  "last_receipt_id",
  "current_sale_payment_total",
  "prior_debt_collected_total",
  "refund_total",
  "new_room_debt_total",
  "client_request_id",
  "operation_status",
  "operation_error",
  "operation_updated_at",
] as const;

export type BusinessSessionRow = {
  get: (columnName: string) => unknown;
  rowNumber?: number;
};

export type ActiveBusinessSession = {
  sessionId: string;
  businessDate: string;
  openedAt: string;
};

export function getBusinessCell(
  row: Pick<BusinessSessionRow, "get">,
  columnName: string,
) {
  return String(row.get(columnName) ?? "").trim();
}

export function businessDateFromTimestamp(value: unknown) {
  const timestamp = String(value ?? "").trim();
  const match = timestamp.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (match) {
    const [, month, day, year] = match;
    return `${year}.${month.padStart(2, "0")}.${day.padStart(2, "0")}`;
  }

  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return "";

  return new Intl.DateTimeFormat("mn-MN", {
    timeZone: "Asia/Ulaanbaatar",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(parsed)
    .replace(/\//g, ".");
}

export function getSessionBusinessDate(row: BusinessSessionRow) {
  return (
    getBusinessCell(row, "business_date") ||
    businessDateFromTimestamp(getBusinessCell(row, "opened_at"))
  );
}

export function getSessionId(row: BusinessSessionRow) {
  const storedId = getBusinessCell(row, "session_id");
  if (storedId) return storedId;

  const businessDate = getSessionBusinessDate(row);
  const rowNumber = Math.max(row.rowNumber ?? 0, 0).toString().padStart(6, "0");
  return `SES-LEGACY-${compactBusinessDate(businessDate)}-${rowNumber}`;
}

export function getActiveBusinessSession(
  rows: BusinessSessionRow[],
): ActiveBusinessSession | null {
  const latestSession =
    rows
      .slice()
      .reverse()
      .find(
        (row) =>
          getSessionBusinessDate(row) ||
          getBusinessCell(row, "opened_at"),
      ) ?? null;

  if (
    !latestSession ||
    getBusinessCell(latestSession, "status").toLowerCase() !== "open"
  ) {
    return null;
  }

  const businessDate = getSessionBusinessDate(latestSession);
  if (!businessDate) return null;

  return {
    sessionId: getSessionId(latestSession),
    businessDate,
    openedAt: getBusinessCell(latestSession, "opened_at"),
  };
}

export function requireActiveBusinessSession(
  rows: BusinessSessionRow[],
): ActiveBusinessSession {
  const session = getActiveBusinessSession(rows);
  if (!session) {
    throw new Error("Open the business day before recording orders or payments");
  }
  return session;
}

export function rowBelongsToBusinessDate(
  row: Pick<BusinessSessionRow, "get">,
  businessDate: string,
  timestampColumn = "timestamp",
) {
  const storedBusinessDate = getBusinessCell(row, "business_date");
  if (storedBusinessDate) return storedBusinessDate === businessDate;

  return (
    businessDateFromTimestamp(row.get(timestampColumn)) === businessDate
  );
}

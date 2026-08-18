import {
  GoogleSpreadsheet,
  type GoogleSpreadsheetWorksheet,
} from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { after, NextResponse } from "next/server";
import type {
  DataQualityCheck,
  DataQualityReport,
} from "@/lib/data-quality-types";
import { isValidBusinessDate } from "@/lib/pos/business-date";
import {
  parseSaleItemDetails,
  type SaleItemDetail,
} from "@/lib/pos/sale-item-details";
import { withProtectedApiRoute } from "@/lib/server/api-route";
import { clearCachedReads, getCachedRead } from "@/lib/server/read-cache";
import { mergeManagementBoardSectionSafely } from "@/lib/server/management-board";
import {
  makeOrderItemRecords,
  ORDER_ITEM_HEADERS,
  ORDER_ITEMS_SHEET_TITLES,
  orderItemValues,
} from "@/lib/server/order-items";
import {
  appendRowsRequest,
  executeAtomicBatch,
} from "@/lib/server/sheets-atomic";

type SheetDoc = GoogleSpreadsheet;

type RawRow = {
  get: (column: string) => unknown;
  rowNumber: number;
};

type RawTable = {
  headers: string[];
  rows: RawRow[];
};

const QUALITY_CACHE_TTL_MS = 5 * 60 * 1000;
const SHEET_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const APPEND_CHUNK_SIZE = 500;

let cachedSpreadsheet:
  | { expiresAt: number; promise: Promise<SheetDoc> }
  | undefined;

const SALES_TITLES = [
  process.env.GOOGLE_SALES_SHEET_TITLE,
  "Sales_Log",
  "sales_log",
].filter(Boolean) as string[];
const PAYMENTS_TITLES = [
  process.env.GOOGLE_PAYMENTS_SHEET_TITLE,
  "Payments_Log",
  "payments_log",
].filter(Boolean) as string[];
const RECEIPTS_TITLES = [
  process.env.GOOGLE_RECEIPTS_SHEET_TITLE,
  "Receipts_Log",
  "receipts_log",
].filter(Boolean) as string[];
const DAY_SESSION_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  "Day_Sessions",
  "day_sessions",
].filter(Boolean) as string[];
const CATALOG_TITLES = [
  process.env.GOOGLE_CATALOG_SHEET_TITLE,
  "Inventory_Catalog",
  "inventory_catalogue",
  "inventory_catalog",
  "Inventory_Catalogue",
].filter(Boolean) as string[];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value.replace(/^"|"$/g, "");
}

function createDoc() {
  const auth = new JWT({
    email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    key: requiredEnv("GOOGLE_PRIVATE_KEY").replace(/\\n/g, "\n").trim(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return new GoogleSpreadsheet(requiredEnv("GOOGLE_SHEET_ID"), auth);
}

async function loadSpreadsheet() {
  const now = Date.now();
  if (cachedSpreadsheet && cachedSpreadsheet.expiresAt > now) {
    return cachedSpreadsheet.promise;
  }
  const promise = (async () => {
    const doc = createDoc();
    await doc.loadInfo();
    return doc;
  })();
  cachedSpreadsheet = {
    expiresAt: now + SHEET_METADATA_CACHE_TTL_MS,
    promise,
  };
  try {
    return await promise;
  } catch (error) {
    if (cachedSpreadsheet?.promise === promise) cachedSpreadsheet = undefined;
    throw error;
  }
}

function findSheet(doc: SheetDoc, titles: string[]) {
  return titles.map(title => doc.sheetsByTitle[title]).find(Boolean) ?? null;
}

async function ensureSheetHeaders(
  sheet: GoogleSpreadsheetWorksheet,
  headers: readonly string[],
) {
  await sheet.loadHeaderRow();
  const missing = headers.filter(header => !sheet.headerValues.includes(header));
  if (missing.length === 0) return sheet;
  const nextHeaders = [...sheet.headerValues, ...missing];
  if (nextHeaders.length > sheet.columnCount) {
    await sheet.resize({
      rowCount: sheet.rowCount,
      columnCount: nextHeaders.length,
    });
  }
  await sheet.setHeaderRow(nextHeaders);
  return sheet;
}

async function getOrCreateOrderItemsSheet(doc: SheetDoc) {
  const existing = findSheet(doc, ORDER_ITEMS_SHEET_TITLES);
  if (existing) return ensureSheetHeaders(existing, ORDER_ITEM_HEADERS);
  return doc.addSheet({
    title: ORDER_ITEMS_SHEET_TITLES[0] ?? "Order_Items",
    headerValues: [...ORDER_ITEM_HEADERS],
  });
}

function rawTable(values: unknown[][]): RawTable {
  const headers = (values[0] ?? []).map(value => String(value ?? "").trim());
  return {
    headers,
    rows: values.slice(1).map((row, index) => ({
      rowNumber: index + 2,
      get: column => {
        const columnIndex = headers.indexOf(column);
        return columnIndex >= 0 ? row[columnIndex] : undefined;
      },
    })),
  };
}

async function readTables(
  doc: SheetDoc,
  sheets: GoogleSpreadsheetWorksheet[],
) {
  if (sheets.length === 0) return [];
  const ranges = sheets
    .map(sheet => `ranges=${encodeURIComponent(`${sheet.a1SheetName}!A:ZZ`)}`)
    .join("&");
  const response = await doc.sheetsApi.get(`values:batchGet?${ranges}`, {
    searchParams: {
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
    },
  });
  const payload = (await response.json()) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
  };
  return sheets.map((_, index) =>
    rawTable(payload.valueRanges?.[index]?.values ?? []),
  );
}

function cell(row: RawRow, column: string) {
  return String(row.get(column) ?? "").trim();
}

function numberCell(row: RawRow, column: string) {
  const value = Number(String(row.get(column) ?? "").replace(/[₮,\s]/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function inScope(row: RawRow, businessDate: string | null) {
  return !businessDate || cell(row, "business_date") === businessDate;
}

function currentOrderItems(rows: RawRow[]) {
  const latestRevision = new Map<string, string>();
  for (const row of rows) {
    const transactionId = cell(row, "transaction_id");
    const revisionId = cell(row, "revision_id");
    if (transactionId && revisionId) latestRevision.set(transactionId, revisionId);
  }

  const byTransaction = new Map<string, RawRow[]>();
  for (const row of rows) {
    const transactionId = cell(row, "transaction_id");
    if (
      !transactionId ||
      cell(row, "revision_id") !== latestRevision.get(transactionId)
    ) {
      continue;
    }
    const current = byTransaction.get(transactionId) ?? [];
    current.push(row);
    byTransaction.set(transactionId, current);
  }
  return byTransaction;
}

function countDuplicates(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach(value => counts.set(value, (counts.get(value) ?? 0) + 1));
  return Array.from(counts.values()).filter(count => count > 1).length;
}

function makeCheck(
  check: Omit<DataQualityCheck, "severity"> & {
    error?: boolean;
  },
): DataQualityCheck {
  const { error, ...checkData } = check;
  return {
    ...checkData,
    severity: check.count === 0 ? "ok" : error ? "error" : "warning",
  };
}

function buildReport(
  tables: {
    sales: RawTable;
    orderItems: RawTable;
    payments: RawTable;
    receipts: RawTable;
    sessions: RawTable;
  },
  businessDate: string | null,
): DataQualityReport {
  const completedSales = tables.sales.rows.filter(
    row =>
      inScope(row, businessDate) &&
      cell(row, "operation_status") !== "pending" &&
      cell(row, "paid_status").toLowerCase() !== "voided" &&
      Boolean(cell(row, "transaction_id")),
  );
  const scopedOrderItems = tables.orderItems.rows.filter(row =>
    inScope(row, businessDate),
  );
  const itemsByOrder = currentOrderItems(scopedOrderItems);
  const missingLineItems = completedSales.filter(
    row => !itemsByOrder.has(cell(row, "transaction_id")),
  );
  const repairableOrders = missingLineItems.filter(row => {
    if (parseSaleItemDetails(row.get("item_details")).length > 0) return true;
    return /.+?\s+x\d+(?:\.\d+)?(?:,\s*|$)/.test(
      cell(row, "item_summary"),
    );
  }).length;
  const legacySummaryOrders = completedSales.filter(
    row => parseSaleItemDetails(row.get("item_details")).length === 0,
  ).length;
  const lineTotalMismatches = completedSales.filter(row => {
    const items = itemsByOrder.get(cell(row, "transaction_id"));
    if (!items?.length) return false;
    const lineTotal = items.reduce(
      (sum, item) => sum + numberCell(item, "line_total"),
      0,
    );
    return Math.abs(lineTotal - numberCell(row, "subtotal")) > 0.5;
  }).length;
  const duplicateOrders = countDuplicates(
    tables.sales.rows
      .filter(row => inScope(row, businessDate))
      .map(row => cell(row, "transaction_id")),
  );
  const duplicateLines = countDuplicates(
    scopedOrderItems.map(row => cell(row, "line_id")),
  );
  const missingBusinessDates = tables.sales.rows.filter(
    row => !cell(row, "business_date"),
  ).length;
  const pendingOperations = [
    ...tables.sales.rows,
    ...tables.receipts.rows,
  ].filter(
    row => inScope(row, businessDate) && cell(row, "operation_status") === "pending",
  ).length;

  const paymentsByReceipt = new Map<string, number>();
  for (const row of tables.payments.rows.filter(row => inScope(row, businessDate))) {
    const receiptId = cell(row, "receipt_id");
    if (!receiptId) continue;
    paymentsByReceipt.set(
      receiptId,
      (paymentsByReceipt.get(receiptId) ?? 0) + numberCell(row, "amount"),
    );
  }
  const paymentMismatches = tables.receipts.rows.filter(row => {
    if (!inScope(row, businessDate) || cell(row, "operation_status") !== "complete") {
      return false;
    }
    const receiptId = cell(row, "receipt_id");
    return (
      Boolean(receiptId) &&
      Math.abs((paymentsByReceipt.get(receiptId) ?? 0) - numberCell(row, "total")) > 0.5
    );
  }).length;

  const salesDates = new Set(completedSales.map(row => cell(row, "business_date")));
  const zeroSalesSessions = tables.sessions.rows.filter(row => {
    const date = cell(row, "business_date");
    return (
      (!businessDate || date === businessDate) &&
      Boolean(date) &&
      !salesDates.has(date)
    );
  }).length;
  const normalizedOrders = completedSales.length - missingLineItems.length;
  const coveragePercent = completedSales.length
    ? Math.round((normalizedOrders / completedSales.length) * 100)
    : 100;
  const checks: DataQualityCheck[] = [
    makeCheck({
      id: "normalized_coverage",
      label: "Order_Items хамрах хүрээ",
      detail: `${normalizedOrders}/${completedSales.length} захиалга бүтэцтэй мөртэй`,
      count: missingLineItems.length,
      repairable: repairableOrders > 0,
    }),
    makeCheck({
      id: "line_total_mismatch",
      label: "Барааны нийлбэр",
      detail: "Order_Items нийлбэр Sales_Log subtotal-той таарахгүй",
      count: lineTotalMismatches,
      error: true,
    }),
    makeCheck({
      id: "duplicate_orders",
      label: "Давхардсан захиалга",
      detail: "Ижил transaction_id-тай Sales_Log мөр",
      count: duplicateOrders,
      error: true,
    }),
    makeCheck({
      id: "duplicate_lines",
      label: "Давхардсан барааны мөр",
      detail: "Ижил line_id-тай Order_Items мөр",
      count: duplicateLines,
      error: true,
    }),
    makeCheck({
      id: "missing_business_date",
      label: "Огноо дутуу",
      detail: "business_date байхгүй борлуулалтын мөр",
      count: missingBusinessDates,
    }),
    makeCheck({
      id: "pending_operations",
      label: "Дуусаагүй ажиллагаа",
      detail: "pending төлөвтэй борлуулалт эсвэл баримт",
      count: pendingOperations,
      error: true,
    }),
    makeCheck({
      id: "payment_mismatch",
      label: "Баримт ба төлбөр",
      detail: "Receipts_Log болон Payments_Log нийлбэр зөрсөн",
      count: paymentMismatches,
      error: true,
    }),
    makeCheck({
      id: "zero_sales_sessions",
      label: "Борлуулалтгүй өдөр",
      detail: "Session байгаа боловч борлуулалтын мөр алга",
      count: zeroSalesSessions,
    }),
  ];
  const issueCount = checks.reduce((sum, check) => sum + check.count, 0);

  return {
    status: issueCount === 0 ? "healthy" : "attention",
    businessDate,
    checkedAt: new Date().toISOString(),
    summary: {
      salesOrders: completedSales.length,
      normalizedOrders,
      coveragePercent,
      issueCount,
      repairableOrders,
      legacySummaryOrders,
    },
    checks,
  };
}

async function loadQualityReport(businessDate: string | null) {
  const doc = await loadSpreadsheet();
  const salesSheet = findSheet(doc, SALES_TITLES);
  if (!salesSheet) throw new Error("Sales_Log is not initialized");
  const orderItemsSheet = findSheet(doc, ORDER_ITEMS_SHEET_TITLES);
  const paymentsSheet = findSheet(doc, PAYMENTS_TITLES);
  const receiptsSheet = findSheet(doc, RECEIPTS_TITLES);
  const sessionsSheet = findSheet(doc, DAY_SESSION_TITLES);
  const available = [
    salesSheet,
    orderItemsSheet,
    paymentsSheet,
    receiptsSheet,
    sessionsSheet,
  ].filter((sheet): sheet is GoogleSpreadsheetWorksheet => Boolean(sheet));
  const tables = await readTables(doc, available);
  const tableFor = (sheet: GoogleSpreadsheetWorksheet | null) => {
    if (!sheet) return rawTable([]);
    return tables[available.indexOf(sheet)] ?? rawTable([]);
  };
  return buildReport(
    {
      sales: tableFor(salesSheet),
      orderItems: tableFor(orderItemsSheet),
      payments: tableFor(paymentsSheet),
      receipts: tableFor(receiptsSheet),
      sessions: tableFor(sessionsSheet),
    },
    businessDate,
  );
}

function parseSummary(value: unknown, catalog: Map<string, SaleItemDetail>) {
  const summary = String(value ?? "").trim();
  const items: SaleItemDetail[] = [];
  const pattern = /(.+?)\s+x(\d+(?:\.\d+)?)(?:,\s*|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(summary)) !== null) {
    const name = match[1]?.trim() ?? "";
    const qty = Number(match[2]);
    if (!name || !Number.isFinite(qty) || qty <= 0) continue;
    const known = catalog.get(name.normalize("NFKC").toLocaleLowerCase("mn-MN"));
    items.push({
      sku: known?.sku ?? "",
      name,
      category: known?.category ?? "Ангилалгүй",
      qty,
      unitPrice: known?.unitPrice ?? 0,
    });
  }
  return items;
}

function catalogFrom(table: RawTable) {
  const map = new Map<string, SaleItemDetail>();
  const first = (row: RawRow, columns: string[]) => {
    for (const column of columns) {
      const value = cell(row, column);
      if (value) return value;
    }
    return "";
  };
  for (const row of table.rows) {
    const name = first(row, ["name", "item_name", "Item Name", "Item Name (Барааны нэр)", "Барааны нэр"]);
    if (!name) continue;
    const priceText = first(row, ["Guest Price (Амрагчдын үнэ)", "Амрагчдын үнэ", "price", "unit_cost", "Unit Cost", "Unit Cost (Нэгж үнэ ₮)", "Нэгж үнэ ₮"]);
    const price = Number(priceText.replace(/[₮,\s]/g, ""));
    map.set(name.normalize("NFKC").toLocaleLowerCase("mn-MN"), {
      sku: first(row, ["sku", "SKU", "SKU (Барааны код)", "Барааны код"]),
      name,
      category: first(row, ["category", "Category", "Category (Ангилал)", "Ангилал"]) || "Ангилалгүй",
      qty: 1,
      unitPrice: Number.isFinite(price) ? price : 0,
    });
  }
  return map;
}

async function backfillOrderItems() {
  const doc = await loadSpreadsheet();
  const salesSheet = findSheet(doc, SALES_TITLES);
  if (!salesSheet) throw new Error("Sales_Log is not initialized");
  const orderItemsSheet = await getOrCreateOrderItemsSheet(doc);
  const catalogSheet = findSheet(doc, CATALOG_TITLES);
  const available = [salesSheet, orderItemsSheet, catalogSheet].filter(
    (sheet): sheet is GoogleSpreadsheetWorksheet => Boolean(sheet),
  );
  const tables = await readTables(doc, available);
  const tableFor = (sheet: GoogleSpreadsheetWorksheet | null) => {
    if (!sheet) return rawTable([]);
    return tables[available.indexOf(sheet)] ?? rawTable([]);
  };
  const sales = tableFor(salesSheet);
  const orderItems = tableFor(orderItemsSheet);
  const catalog = catalogFrom(tableFor(catalogSheet));
  const existingOrders = new Set(
    orderItems.rows.map(row => cell(row, "transaction_id")).filter(Boolean),
  );
  const plannedOrders = new Set(existingOrders);
  const records = sales.rows.flatMap(row => {
    const transactionId = cell(row, "transaction_id");
    if (
      !transactionId ||
      plannedOrders.has(transactionId) ||
      cell(row, "operation_status") === "pending" ||
      cell(row, "paid_status").toLowerCase() === "voided"
    ) {
      return [];
    }
    const storedItems = parseSaleItemDetails(row.get("item_details"));
    const items = storedItems.length > 0
      ? storedItems
      : parseSummary(row.get("item_summary"), catalog);
    if (items.length === 0) return [];
    plannedOrders.add(transactionId);
    return makeOrderItemRecords(items, {
      transactionId,
      timestamp: cell(row, "timestamp"),
      businessDate: cell(row, "business_date"),
      sessionId: cell(row, "session_id"),
      staff: cell(row, "staff"),
      roomOrGuest: cell(row, "room_or_guest"),
      revisionId: "backfill-v1",
      revisionType: "backfill",
      priceSource:
        storedItems.length > 0
          ? "recorded"
          : items.every(item => item.unitPrice > 0)
            ? "catalog"
            : "unknown",
    });
  });
  const rows = records.map(record =>
    orderItemValues(record, orderItemsSheet.headerValues),
  );
  const requests = [];
  for (let index = 0; index < rows.length; index += APPEND_CHUNK_SIZE) {
    requests.push(
      appendRowsRequest(
        orderItemsSheet,
        rows.slice(index, index + APPEND_CHUNK_SIZE),
      ),
    );
  }
  await executeAtomicBatch(doc, requests);
  clearCachedReads("data-quality:");
  clearCachedReads("day:");
  return {
    ordersBackfilled: new Set(records.map(record => record.transaction_id)).size,
    linesBackfilled: records.length,
  };
}

function requestedBusinessDate(request: Request) {
  const value = new URL(request.url).searchParams.get("businessDate")?.trim() ?? "";
  return isValidBusinessDate(value) ? value : null;
}

async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const boardBusinessDate = requestedBusinessDate(request);
    const businessDate = url.searchParams.get("scope") === "day"
      ? boardBusinessDate
      : null;
    const fresh = url.searchParams.get("fresh") === "1";
    const report = fresh
      ? await loadQualityReport(businessDate)
      : await getCachedRead(
          `data-quality:${businessDate ?? "all"}`,
          QUALITY_CACHE_TTL_MS,
          () => loadQualityReport(businessDate),
        );
    if (boardBusinessDate) {
      after(() =>
        mergeManagementBoardSectionSafely(
          boardBusinessDate,
          "quality",
          report,
        ),
      );
    }
    return NextResponse.json(report, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const rateLimited = /429|quota|rate limit/i.test(
      error instanceof Error ? error.message : String(error),
    );
    console.error(
      `[data-quality:get] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      {
        error: rateLimited
          ? "Google Sheets хүсэлтийн хязгаарт хүрсэн. 60 секунд хүлээгээд дахин оролдоно уу."
          : "Өгөгдлийн шалгалтыг ажиллуулж чадсангүй.",
      },
      {
        status: rateLimited ? 429 : 500,
        headers: rateLimited ? { "Retry-After": "60" } : undefined,
      },
    );
  }
}

async function handlePOST() {
  try {
    const result = await backfillOrderItems();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error(
      `[data-quality:repair] ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      { error: "Order_Items нөхөлтийг хийж чадсангүй." },
      { status: 500 },
    );
  }
}

export const GET = withProtectedApiRoute(
  "/api/data-quality",
  "manager",
  handleGET,
);
export const POST = withProtectedApiRoute(
  "/api/data-quality",
  "manager",
  handlePOST,
);

import {
  GoogleSpreadsheet,
  type GoogleSpreadsheetWorksheet,
} from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { isUnlimitedInventoryItem } from '@/lib/pos/inventory';
import {
  parseSaleItemDetails,
  serializeSaleItemDetails,
} from '@/lib/pos/sale-item-details';
import {
  makePaymentLineNumber,
  makeUniformControlNumber,
  makeUniformReceiptNumber,
  PAYMENT_LOG_HEADERS,
  RECEIPT_LOG_HEADERS,
} from '@/lib/pos/payment-controls';
import {
  DAY_SESSION_HEADERS,
  requireActiveBusinessSession,
} from '@/lib/server/business-session';
import { clearCachedReads, getCachedRead } from '@/lib/server/read-cache';
import { withProtectedApiRoute } from '@/lib/server/api-route';
import { requireApiSession } from '@/lib/server/auth';
import { staleBusinessDayResponse } from '@/lib/server/business-day-guard';

type SettlementPaymentInput = {
  paymentMethod?: string;
  amount?: number;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  notes?: string;
};

type SaleEditItemInput = {
  sku?: string;
  name?: string;
  category?: string;
  qty?: number;
  unitPrice?: number;
  priceMode?: 'guest' | 'staff';
};

type SettleSaleBody = {
  action?: 'settle' | 'edit_unpaid';
  transactionId?: string;
  paymentMethod?: string;
  amount?: number;
  staffName?: string;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  payments?: SettlementPaymentInput[];
  room?: string;
  items?: SaleEditItemInput[];
  total?: number;
  settlements?: Array<{
    transactionId?: string;
    payments?: SettlementPaymentInput[];
  }>;
  clientRequestId?: string;
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
  rowNumber: number;
};

type ReadonlySheetRow = Pick<SheetRow, 'get' | 'rowNumber'>;

type RawSheetTable = {
  headers: string[];
  rows: ReadonlySheetRow[];
  valuesFor: (record: Record<string, unknown>) => unknown[];
};

type CatalogRowItem = {
  sku: string;
  name: string;
  category: string;
  guestPrice: number;
  staffPrice: number;
  price: number;
};

const SALES_READ_CACHE_TTL_MS = 10000;
const SHEET_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSpreadsheet:
  | { expiresAt: number; promise: Promise<SheetDoc> }
  | undefined;

const SALES_LOG_SHEET_TITLES = [
  process.env.GOOGLE_SALES_SHEET_TITLE,
  'Sales_Log',
  'sales_log',
].filter(Boolean) as string[];

const INVENTORY_LOG_SHEET_TITLES = [
  process.env.GOOGLE_LOG_SHEET_TITLE,
  'Inventory_Log',
  'inventory_log',
].filter(Boolean) as string[];

const CATALOG_SHEET_TITLES = [
  process.env.GOOGLE_CATALOG_SHEET_TITLE,
  'Inventory_Catalog',
  'inventory_catalogue',
  'inventory_catalog',
  'Inventory_Catalogue',
].filter(Boolean) as string[];

const PAYMENTS_LOG_SHEET_TITLES = [
  process.env.GOOGLE_PAYMENTS_SHEET_TITLE,
  'Payments_Log',
  'payments_log',
].filter(Boolean) as string[];

const RECEIPTS_LOG_SHEET_TITLES = [
  process.env.GOOGLE_RECEIPTS_SHEET_TITLE,
  'Receipts_Log',
  'receipts_log',
].filter(Boolean) as string[];

const DAY_SESSION_SHEET_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  'Day_Sessions',
  'day_sessions',
].filter(Boolean) as string[];

const SALES_LOG_HEADERS = [
  'transaction_id',
  'timestamp',
  'staff',
  'payment_method',
  'paid_status',
  'room_or_guest',
  'subtotal',
  'discount',
  'total',
  'cash_received',
  'change_due',
  'item_count',
  'item_summary',
  'qpay_invoice_id',
  'notes',
  'item_details',
  'session_id',
  'business_date',
  'client_request_id',
  'operation_status',
  'receipt_id',
];

const INVENTORY_LOG_HEADERS = [
  'Transaction ID',
  'Timestamp',
  'SKU (Барааны код)',
  'Item Description',
  'Type (Хөдөлгөөн)',
  'Quantity (Тоо)',
  'Location (Байршил)',
  'Handled By',
  'Payment Method',
  'Room Number',
  'Session ID',
  'Business Date',
];

const INVENTORY_COLUMNS = {
  transactionId: ['Transaction ID', 'transaction_id'],
  sku: ['SKU (Барааны код)', 'sku', 'SKU'],
  name: ['Item Description', 'item_name', 'name'],
  type: ['Type (Хөдөлгөөн)', 'type'],
  quantity: ['Quantity (Тоо)', 'qty', 'quantity'],
  location: ['Location (Байршил)', 'location'],
};

const CATALOG_COLUMNS = {
  sku: ['sku', 'SKU', 'SKU (Барааны код)', 'Барааны код'],
  name: [
    'name',
    'item_name',
    'Item Name',
    'Item Name (Барааны нэр)',
    'Барааны нэр',
  ],
  category: [
    'category',
    'Category',
    'Category (Ангилал)',
    'Ангилал',
  ],
  guestPrice: [
    'Guest Price (Амрагчдын үнэ)',
    'Амрагчдын үнэ',
    'price',
    'unit_cost',
    'Unit Cost',
    'Unit Cost (Нэгж үнэ ₮)',
    'Нэгж үнэ ₮',
  ],
  staffPrice: [
    'Staff Price',
    'Employee Price',
    'Employee Price (Ажчилчдын үнэ)',
    'Ажчилчдын үнэ',
    'Employee Price (Ажилчдын үнэ)',
    'Ажилчдын үнэ',
  ],
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value.replace(/^"|"$/g, '');
}

function getPrivateKey() {
  const key = requiredEnv('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n').trim();
  const keyLines = key.split('\n');
  const keyBody = keyLines.slice(1, -1).join('');

  if (
    !key.startsWith('-----BEGIN PRIVATE KEY-----') ||
    !key.endsWith('-----END PRIVATE KEY-----') ||
    /[^A-Za-z0-9+/=]/.test(keyBody)
  ) {
    throw new Error('GOOGLE_PRIVATE_KEY is not a valid service-account private key');
  }

  return key;
}

function createDoc(): SheetDoc {
  const serviceAccountAuth = new JWT({
    email: requiredEnv('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    key: getPrivateKey(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return new GoogleSpreadsheet(requiredEnv('GOOGLE_SHEET_ID'), serviceAccountAuth);
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

async function ensureSheetHeaders(
  sheet: GoogleSpreadsheetWorksheet,
  headers: readonly string[],
) {
  await sheet.loadHeaderRow();
  const missingHeaders = headers.filter(
    header => !sheet.headerValues.includes(header),
  );
  if (missingHeaders.length === 0) return sheet;

  const nextHeaders = [...sheet.headerValues, ...missingHeaders];
  if (nextHeaders.length > sheet.columnCount) {
    await sheet.resize({
      rowCount: sheet.rowCount,
      columnCount: nextHeaders.length,
    });
  }
  await sheet.setHeaderRow(nextHeaders);
  return sheet;
}

async function getOrCreateSheet(
  doc: SheetDoc,
  titles: string[],
  headers: readonly string[],
) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return ensureSheetHeaders(sheet, headers);
  }

  return doc.addSheet({
    title: titles[0] ?? 'Sheet',
    headerValues: [...headers],
  });
}

async function getOrCreateSalesLogSheet(doc: SheetDoc) {
  for (const title of SALES_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return ensureSheetHeaders(sheet, SALES_LOG_HEADERS);
  }

  return doc.addSheet({
    title: SALES_LOG_SHEET_TITLES[0] ?? 'Sales_Log',
    headerValues: SALES_LOG_HEADERS,
  });
}

async function getOrCreateInventoryLogSheet(doc: SheetDoc) {
  for (const title of INVENTORY_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return ensureSheetHeaders(sheet, INVENTORY_LOG_HEADERS);
  }

  return doc.addSheet({
    title: INVENTORY_LOG_SHEET_TITLES[0] ?? 'Inventory_Log',
    headerValues: INVENTORY_LOG_HEADERS,
  });
}

async function getOrCreatePaymentsLogSheet(doc: SheetDoc) {
  for (const title of PAYMENTS_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return ensureSheetHeaders(sheet, PAYMENT_LOG_HEADERS);
  }

  return doc.addSheet({
    title: PAYMENTS_LOG_SHEET_TITLES[0] ?? 'Payments_Log',
    headerValues: PAYMENT_LOG_HEADERS,
  });
}

function findCatalogSheet(doc: SheetDoc) {
  for (const title of CATALOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return null;
}

function findExistingSheet(doc: SheetDoc, titles: string[]) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return null;
}

function makeRawSheetTable(
  title: string,
  values: unknown[][],
  requiredHeaders: readonly string[],
): RawSheetTable {
  const headers = (values[0] ?? []).map(value => String(value ?? '').trim());
  const missingHeaders = requiredHeaders.filter(
    header => !headers.includes(header),
  );
  if (missingHeaders.length > 0) {
    throw new Error(
      `${title} is missing required columns: ${missingHeaders.join(', ')}`,
    );
  }

  return {
    headers,
    rows: values.slice(1).map((rowValues, index) => ({
      rowNumber: index + 2,
      get: (columnName: string) => {
        const columnIndex = headers.indexOf(columnName);
        return columnIndex >= 0 ? rowValues[columnIndex] : undefined;
      },
    })),
    valuesFor: record => headers.map(header => record[header] ?? ''),
  };
}

async function batchReadSheetTables(
  doc: SheetDoc,
  sheets: Array<{
    sheet: GoogleSpreadsheetWorksheet;
    requiredHeaders: readonly string[];
  }>,
) {
  const rangeQuery = sheets
    .map(({ sheet }) =>
      `ranges=${encodeURIComponent(`${sheet.a1SheetName}!A:ZZ`)}`,
    )
    .join('&');
  const response = await doc.sheetsApi.get(
    `values:batchGet?${rangeQuery}`,
    {
      searchParams: {
        majorDimension: 'ROWS',
        valueRenderOption: 'FORMATTED_VALUE',
      },
    },
  );
  const payload = (await response.json()) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
  };

  return sheets.map(({ sheet, requiredHeaders }, index) =>
    makeRawSheetTable(
      sheet.title,
      payload.valueRanges?.[index]?.values ?? [],
      requiredHeaders,
    ),
  );
}

function userEnteredCell(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { userEnteredValue: { numberValue: value } };
  }
  if (typeof value === 'boolean') {
    return { userEnteredValue: { boolValue: value } };
  }
  return { userEnteredValue: { stringValue: String(value ?? '') } };
}

function rowData(values: unknown[]) {
  return { values: values.map(userEnteredCell) };
}

async function appendReceiptClaim(
  doc: SheetDoc,
  sheet: GoogleSpreadsheetWorksheet,
  values: unknown[],
) {
  const response = await doc.sheetsApi.post(
    `values/${sheet.encodedA1SheetName}!A1:append`,
    {
      searchParams: {
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        includeValuesInResponse: 'false',
      },
      json: { values: [values] },
    },
  );
  const payload = (await response.json()) as {
    updates?: { updatedRange?: string };
  };
  const rowNumber = payload.updates?.updatedRange?.match(
    /![A-Z]+([0-9]+):?/,
  )?.[1];
  const parsedRowNumber = Number(rowNumber);
  if (!Number.isInteger(parsedRowNumber) || parsedRowNumber < 2) {
    throw new Error('Google Sheets did not return the appended receipt row');
  }
  return parsedRowNumber;
}

async function completeReceiptAndAppendPayments(
  doc: SheetDoc,
  receiptsLogSheet: GoogleSpreadsheetWorksheet,
  receiptRowNumber: number,
  receiptValues: unknown[],
  paymentsLogSheet: GoogleSpreadsheetWorksheet,
  paymentValues: unknown[][],
) {
  await doc.sheetsApi.post(':batchUpdate', {
    json: {
      requests: [
        {
          updateCells: {
            range: {
              sheetId: receiptsLogSheet.sheetId,
              startRowIndex: receiptRowNumber - 1,
              endRowIndex: receiptRowNumber,
              startColumnIndex: 0,
              endColumnIndex: receiptValues.length,
            },
            rows: [rowData(receiptValues)],
            fields: 'userEnteredValue',
          },
        },
        {
          appendCells: {
            sheetId: paymentsLogSheet.sheetId,
            rows: paymentValues.map(rowData),
            fields: 'userEnteredValue',
          },
        },
      ],
      includeSpreadsheetInResponse: false,
    },
  });
}

function toNumber(value: unknown) {
  const cleaned = String(value ?? '').replace(/[₮,\s]/g, '');
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getCell(row: { get: (columnName: string) => unknown }, column: string) {
  return String(row.get(column) ?? '').trim();
}

function getFirstValue(
  row: { get: (columnName: string) => unknown },
  columnNames: string[],
) {
  for (const columnName of columnNames) {
    const value = row.get(columnName);
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }

  return '';
}

function getPaymentTotals(rows: Array<{ get: (columnName: string) => unknown }>) {
  const totals = new Map<string, number>();

  for (const row of rows) {
    const transactionId = getCell(row, 'transaction_id');
    if (!transactionId) continue;

    totals.set(transactionId, (totals.get(transactionId) ?? 0) + toNumber(row.get('amount')));
  }

  return totals;
}

function getPaymentSummaries(rows: Array<{ get: (columnName: string) => unknown }>) {
  const summaries = new Map<string, string[]>();

  for (const row of rows) {
    const transactionId = getCell(row, 'transaction_id');
    if (!transactionId) continue;

    const amount = toNumber(row.get('amount'));
    if (amount <= 0) continue;

    const method = getCell(row, 'payment_method') || 'Төлбөр';
    const current = summaries.get(transactionId) ?? [];
    current.push(`${method} ${amount}`);
    summaries.set(transactionId, current);
  }

  return new Map(
    Array.from(summaries.entries()).map(([transactionId, labels]) => [
      transactionId,
      labels.join(' + '),
    ]),
  );
}

function timestampMs(value: unknown) {
  const timestamp = String(value ?? '').trim();
  const match = timestamp.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i,
  );

  if (match) {
    const [, month, day, year, hour, minute, second = '0', meridiem = ''] = match;
    let hour24 = Number(hour);
    if (meridiem.toUpperCase() === 'PM' && hour24 !== 12) hour24 += 12;
    if (meridiem.toUpperCase() === 'AM' && hour24 === 12) hour24 = 0;

    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      hour24,
      Number(minute),
      Number(second),
    );
  }

  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getPaymentActivity(
  rows: Array<{ get: (columnName: string) => unknown }>,
) {
  const activity = new Map<
    string,
    {
      amount: number;
      latestTimestamp: string;
      sortTime: number;
      labels: string[];
      cashReceived: number;
      changeDue: number;
      qpayInvoiceIds: string[];
      receiptIds: string[];
      sessionId: string;
      businessDate: string;
    }
  >();

  for (const row of rows) {
    const transactionId = getCell(row, 'transaction_id');
    const amount = toNumber(row.get('amount'));
    if (!transactionId || amount <= 0) continue;

    const timestamp = getCell(row, 'timestamp');
    const sortTime = timestampMs(timestamp);
    const method = getCell(row, 'payment_method') || 'Төлбөр';
    const qpayInvoiceId = getCell(row, 'qpay_invoice_id');
    const current = activity.get(transactionId) ?? {
      amount: 0,
      latestTimestamp: timestamp,
      sortTime,
      labels: [],
      cashReceived: 0,
      changeDue: 0,
      qpayInvoiceIds: [],
      receiptIds: [],
      sessionId: getCell(row, 'session_id'),
      businessDate: getCell(row, 'business_date'),
    };

    current.amount += amount;
    current.labels.push(`${method} ${amount}`);
    current.cashReceived += toNumber(row.get('cash_received'));
    current.changeDue += toNumber(row.get('change_due'));
    if (qpayInvoiceId) current.qpayInvoiceIds.push(qpayInvoiceId);
    const receiptId = getCell(row, 'receipt_id');
    if (receiptId && !current.receiptIds.includes(receiptId)) {
      current.receiptIds.push(receiptId);
    }
    if (sortTime >= current.sortTime) {
      current.latestTimestamp = timestamp;
      current.sortTime = sortTime;
      current.sessionId = getCell(row, 'session_id') || current.sessionId;
      current.businessDate =
        getCell(row, 'business_date') || current.businessDate;
    }

    activity.set(transactionId, current);
  }

  return activity;
}

function normalizeLookup(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('mn-MN');
}

function normalizeCatalogItem(row: { get: (columnName: string) => unknown }): CatalogRowItem {
  const guestPrice = toNumber(getFirstValue(row, CATALOG_COLUMNS.guestPrice));
  const staffPrice = toNumber(getFirstValue(row, CATALOG_COLUMNS.staffPrice));

  return {
    sku: String(getFirstValue(row, CATALOG_COLUMNS.sku)).trim(),
    name: String(getFirstValue(row, CATALOG_COLUMNS.name)).trim(),
    category: String(getFirstValue(row, CATALOG_COLUMNS.category)).trim(),
    guestPrice,
    staffPrice,
    price: guestPrice || staffPrice,
  };
}

function parseItemSummary(summary: string) {
  const items: Array<{ name: string; qty: number }> = [];
  const pattern = /(.+?)\s+x(\d+(?:\.\d+)?)(?:,\s*|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(summary)) !== null) {
    const name = match[1]?.trim();
    const qty = Number(match[2]);

    if (name && Number.isFinite(qty) && qty > 0) {
      items.push({ name, qty });
    }
  }

  return items;
}

function buildItemSummary(items: SaleEditItemInput[]) {
  const summaryItems = new Map<string, { name: string; qty: number }>();

  for (const item of items) {
    const name = String(item.name ?? item.sku ?? 'Item').trim() || 'Item';
    const qty = toNumber(item.qty ?? 1);
    const key = normalizeLookup(name);
    const existing = summaryItems.get(key);

    summaryItems.set(key, {
      name: existing?.name ?? name,
      qty: (existing?.qty ?? 0) + (qty > 0 ? qty : 1),
    });
  }

  return Array.from(summaryItems.values())
    .map(item => `${item.name} x${item.qty ?? 1}`)
    .join(', ');
}

function buildEditableItems(
  saleRow: { get: (columnName: string) => unknown },
  inventoryRows: Array<{ get: (columnName: string) => unknown }>,
  catalogItems: CatalogRowItem[],
) {
  const storedItems = parseSaleItemDetails(getCell(saleRow, 'item_details'));
  if (storedItems.length > 0) {
    return storedItems.map(item => ({
      ...item,
      source: 'details' as const,
    }));
  }

  const transactionId = getCell(saleRow, 'transaction_id');
  const bySku = new Map(
    catalogItems
      .filter(item => item.sku)
      .map(item => [normalizeLookup(item.sku), item]),
  );
  const byName = new Map(
    catalogItems
      .filter(item => item.name)
      .map(item => [normalizeLookup(item.name), item]),
  );
  const itemByKey = new Map<
    string,
    {
      sku: string;
      name: string;
      category: string;
      qty: number;
      unitPrice: number;
      priceMode: 'guest' | 'staff';
      source: 'inventory' | 'summary' | 'details';
    }
  >();
  const saleTotal = toNumber(saleRow.get('total'));
  const summaryItems = parseItemSummary(getCell(saleRow, 'item_summary'));
  let knownTotal = 0;

  if (summaryItems.length > 0) {
    const unmatchedSummaryItems: Array<{ name: string; qty: number }> = [];

    for (const summaryItem of summaryItems) {
      const catalogItem = byName.get(normalizeLookup(summaryItem.name));
      if (!catalogItem) {
        unmatchedSummaryItems.push(summaryItem);
        continue;
      }

      const key = catalogItem.sku ? `sku:${catalogItem.sku}` : `name:${normalizeLookup(catalogItem.name)}`;
      const existing = itemByKey.get(key);
      const unitPrice = catalogItem.price || 0;
      itemByKey.set(key, {
        sku: catalogItem.sku,
        name: catalogItem.name,
        category: catalogItem.category || 'Үйлчилгээ',
        qty: (existing?.qty ?? 0) + summaryItem.qty,
        unitPrice: existing?.unitPrice || unitPrice,
        priceMode: catalogItem.guestPrice ? 'guest' : 'staff',
        source: 'summary',
      });
      knownTotal += summaryItem.qty * unitPrice;
    }

    if (unmatchedSummaryItems.length > 0) {
      const unmatchedTotal = Math.max(saleTotal - knownTotal, 0);
      const unmatchedQuantity = unmatchedSummaryItems.reduce(
        (sum, item) => sum + item.qty,
        0,
      );
      let remainingUnmatchedTotal = Math.round(unmatchedTotal);

      unmatchedSummaryItems.forEach((item, index) => {
        const isLast = index === unmatchedSummaryItems.length - 1;
        const lineTotal = isLast
          ? remainingUnmatchedTotal
          : Math.round((unmatchedTotal * item.qty) / unmatchedQuantity);
        const unitPrice = item.qty > 0 ? Math.round(lineTotal / item.qty) : 0;

        remainingUnmatchedTotal -= lineTotal;
        knownTotal += unitPrice * item.qty;
        itemByKey.set(`manual:${index}:${normalizeLookup(item.name)}`, {
          sku: '',
          name: item.name,
          category: 'Үйлчилгээ',
          qty: item.qty,
          unitPrice,
          priceMode: 'guest',
          source: 'summary',
        });
      });
    }

    const adjustedRemainingTotal = saleTotal - knownTotal;
    if (adjustedRemainingTotal > 0) {
      itemByKey.set('manual:adjustment', {
        sku: '',
        name: 'Өмнөх захиалгын тохируулга',
        category: 'Үйлчилгээ',
        qty: 1,
        unitPrice: Math.round(adjustedRemainingTotal),
        priceMode: 'guest',
        source: 'summary',
      });
    }

    return Array.from(itemByKey.values()).filter(item => item.qty > 0 && item.unitPrice >= 0);
  }

  for (const row of inventoryRows) {
    const rowTransactionId = String(getFirstValue(row, INVENTORY_COLUMNS.transactionId)).trim();
    const movementType = String(getFirstValue(row, INVENTORY_COLUMNS.type)).trim();
    if (rowTransactionId !== transactionId || movementType !== 'Зарлага') continue;

    const sku = String(getFirstValue(row, INVENTORY_COLUMNS.sku)).trim();
    const name = String(getFirstValue(row, INVENTORY_COLUMNS.name)).trim();
    const qty = toNumber(getFirstValue(row, INVENTORY_COLUMNS.quantity));
    if (!name || qty <= 0) continue;

    const catalogItem = bySku.get(normalizeLookup(sku)) ?? byName.get(normalizeLookup(name));
    const key = sku ? `sku:${sku}` : `name:${normalizeLookup(name)}`;
    const existing = itemByKey.get(key);
    const unitPrice = catalogItem?.price ?? 0;

    itemByKey.set(key, {
      sku,
      name,
      category: catalogItem?.category ?? 'Үйлчилгээ',
      qty: (existing?.qty ?? 0) + qty,
      unitPrice: existing?.unitPrice || unitPrice,
      priceMode: catalogItem?.guestPrice ? 'guest' : 'staff',
      source: 'inventory',
    });
  }

  knownTotal = Array.from(itemByKey.values()).reduce(
    (sum, item) => sum + item.qty * item.unitPrice,
    0,
  );
  const items = Array.from(itemByKey.values());
  const remainingTotal = saleTotal - knownTotal;

  if (items.length === 0 || remainingTotal > 0) {
    items.push({
      sku: '',
      name: getCell(saleRow, 'item_summary') || 'Өмнөх захиалгын тохируулга',
      category: 'Үйлчилгээ',
      qty: 1,
      unitPrice: Math.max(Math.round(remainingTotal || saleTotal), 0),
      priceMode: 'guest',
      source: 'summary',
    });
  }

  return items.filter(item => item.qty > 0 && item.unitPrice >= 0);
}

function getCurrentInventoryBalances(
  transactionId: string,
  inventoryRows: Array<{ get: (columnName: string) => unknown }>,
) {
  const balances = new Map<
    string,
    { sku: string; name: string; location: string; quantity: number }
  >();

  for (const row of inventoryRows) {
    const rowTransactionId = String(getFirstValue(row, INVENTORY_COLUMNS.transactionId)).trim();
    const movementType = String(getFirstValue(row, INVENTORY_COLUMNS.type)).trim();
    if (rowTransactionId !== transactionId) continue;
    if (movementType !== 'Зарлага' && movementType !== 'Буцаалт') continue;

    const sku = String(getFirstValue(row, INVENTORY_COLUMNS.sku)).trim();
    const name = String(getFirstValue(row, INVENTORY_COLUMNS.name)).trim();
    const location = String(getFirstValue(row, INVENTORY_COLUMNS.location) || 'Front Desk');
    const key = sku ? `sku:${sku}` : `name:${normalizeLookup(name)}`;
    const existing = balances.get(key);
    const signedQuantity =
      movementType === 'Зарлага'
        ? toNumber(getFirstValue(row, INVENTORY_COLUMNS.quantity))
        : -toNumber(getFirstValue(row, INVENTORY_COLUMNS.quantity));

    balances.set(key, {
      sku,
      name,
      location,
      quantity: (existing?.quantity ?? 0) + signedQuantity,
    });
  }

  return Array.from(balances.values()).filter(item => item.quantity > 0);
}

function getSettlementPayments(body: SettleSaleBody) {
  if (Array.isArray(body.payments) && body.payments.length > 0) {
    return body.payments;
  }

  return [
    {
      paymentMethod: body.paymentMethod,
      amount: body.amount,
      cashReceived: body.cashReceived,
      changeDue: body.changeDue,
      qpayInvoiceId: body.qpayInvoiceId,
    },
  ];
}

function salesErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes('GOOGLE_PRIVATE_KEY')) {
    return 'Google Sheets credentials are invalid. Replace GOOGLE_PRIVATE_KEY with the full service-account private_key.';
  }

  if (message.includes('GOOGLE_') && message.includes('is missing')) {
    return message;
  }

  if (
    message.includes('DECODER routines') ||
    message.includes('unsupported') ||
    message.includes('invalid_grant')
  ) {
    return 'Google Sheets authentication failed. Check the service-account email/private key.';
  }

  if (message.includes('Open the business day')) {
    return message;
  }

  return fallback;
}

async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedTransactionId = url.searchParams.get('transactionId')?.trim();
    const settlementRequestId = url.searchParams
      .get('settlementRequestId')
      ?.trim();
    const bypassCache = url.searchParams.get('fresh') === '1';

    if (settlementRequestId) {
      if (settlementRequestId.length > 128) {
        return NextResponse.json(
          { error: 'settlementRequestId is invalid' },
          { status: 400 },
        );
      }

      const doc = await loadSpreadsheet();
      const receiptsLogSheet = findExistingSheet(
        doc,
        RECEIPTS_LOG_SHEET_TITLES,
      );
      if (!receiptsLogSheet) {
        return NextResponse.json(
          { requestStatus: 'missing' },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      const [receiptsTable] = await batchReadSheetTables(doc, [
        {
          sheet: receiptsLogSheet,
          requiredHeaders: RECEIPT_LOG_HEADERS,
        },
      ]);
      const receiptRows = receiptsTable.rows;
      const receiptRow = receiptRows.find(
        row => getCell(row, 'client_request_id') === settlementRequestId,
      );
      if (!receiptRow) {
        return NextResponse.json(
          { requestStatus: 'missing' },
          { headers: { 'Cache-Control': 'no-store' } },
        );
      }

      const operationStatus = getCell(receiptRow, 'operation_status');
      return NextResponse.json(
        {
          success: operationStatus === 'complete',
          requestStatus:
            operationStatus === 'complete' ? 'complete' : 'pending',
          receiptId: getCell(receiptRow, 'receipt_id'),
          settledAt: getCell(receiptRow, 'timestamp'),
          sessionId: getCell(receiptRow, 'session_id'),
          businessDate: getCell(receiptRow, 'business_date'),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    if (requestedTransactionId) {
      const doc = await loadSpreadsheet();
      const salesLogSheet = await getOrCreateSalesLogSheet(doc);
      const paymentsLogSheet = await getOrCreatePaymentsLogSheet(doc);
      const [salesRows, paymentRows] = await Promise.all([
        salesLogSheet.getRows() as Promise<SheetRow[]>,
        paymentsLogSheet.getRows(),
      ]);
      const paymentTotals = getPaymentTotals(paymentRows);
      const saleRow = salesRows.find(
        row => getCell(row, 'transaction_id') === requestedTransactionId,
      );

      if (!saleRow) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
      }
      if (getCell(saleRow, 'operation_status') === 'pending') {
        return NextResponse.json(
          { error: 'Sale is still pending and cannot be opened yet' },
          { status: 409 },
        );
      }

      if (getCell(saleRow, 'paid_status').toLowerCase() !== 'unpaid') {
        return NextResponse.json({ error: 'Sale is not an unpaid charge' }, { status: 400 });
      }

      const [inventoryRows, catalogRows] = await Promise.all([
        getOrCreateInventoryLogSheet(doc).then(sheet => sheet.getRows()),
        Promise.resolve(findCatalogSheet(doc)).then(sheet => sheet?.getRows() ?? []),
      ]);
      const catalogItems = catalogRows.map(normalizeCatalogItem);
      const total = toNumber(saleRow.get('total'));
      const paidAmount = paymentTotals.get(requestedTransactionId) ?? 0;

      return NextResponse.json({
        charge: {
          transactionId: requestedTransactionId,
          timestamp: getCell(saleRow, 'timestamp'),
          staff: getCell(saleRow, 'staff'),
          paymentMethod: getCell(saleRow, 'payment_method'),
          paidStatus: getCell(saleRow, 'paid_status'),
          roomOrGuest: getCell(saleRow, 'room_or_guest'),
          subtotal: toNumber(saleRow.get('subtotal')),
          discount: toNumber(saleRow.get('discount')),
          total: Math.max(total - paidAmount, 0),
          originalTotal: total,
          paidAmount,
          balance: Math.max(total - paidAmount, 0),
          itemCount: toNumber(saleRow.get('item_count')),
          itemSummary: getCell(saleRow, 'item_summary'),
          qpayInvoiceId: getCell(saleRow, 'qpay_invoice_id'),
          notes: getCell(saleRow, 'notes'),
          items: buildEditableItems(saleRow, inventoryRows, catalogItems),
        },
      });
    }

    const loadSalesList = async () => {
      const doc = await loadSpreadsheet();
      const [salesLogSheet, paymentsLogSheet, receiptsLogSheet] =
        await Promise.all([
          getOrCreateSalesLogSheet(doc),
          getOrCreatePaymentsLogSheet(doc),
          getOrCreateSheet(
            doc,
            RECEIPTS_LOG_SHEET_TITLES,
            RECEIPT_LOG_HEADERS,
          ),
        ]);
      const [salesRows, paymentRows, receiptRows] = await Promise.all([
        salesLogSheet.getRows() as Promise<SheetRow[]>,
        paymentsLogSheet.getRows(),
        receiptsLogSheet.getRows(),
      ]);
      const paymentTotals = getPaymentTotals(paymentRows);
      const paymentSummaries = getPaymentSummaries(paymentRows);
      const paymentActivityByTransaction = getPaymentActivity(paymentRows);
      const completedSalesRows = salesRows.filter(
        row => getCell(row, 'operation_status') !== 'pending',
      );
      const unpaidCharges = completedSalesRows
        .filter(row => getCell(row, 'paid_status').toLowerCase() === 'unpaid')
        .map(row => {
          const transactionId = getCell(row, 'transaction_id');
          const saleTotal = toNumber(row.get('total'));
          const paidAmount = paymentTotals.get(transactionId) ?? 0;
          const balance = Math.max(saleTotal - paidAmount, 0);

          return {
            transactionId,
            timestamp: getCell(row, 'timestamp'),
            staff: getCell(row, 'staff'),
            paymentMethod: getCell(row, 'payment_method'),
            roomOrGuest: getCell(row, 'room_or_guest'),
            subtotal: toNumber(row.get('subtotal')),
            discount: toNumber(row.get('discount')),
            total: balance,
            originalTotal: saleTotal,
            paidAmount,
            balance,
            itemCount: toNumber(row.get('item_count')),
            itemSummary: getCell(row, 'item_summary'),
            qpayInvoiceId: getCell(row, 'qpay_invoice_id'),
            notes: getCell(row, 'notes'),
            items: parseSaleItemDetails(getCell(row, 'item_details')),
          };
        })
        .filter(charge => charge.balance > 0)
        .filter(charge => charge.transactionId);
      const legacyHistory = completedSalesRows
        .flatMap(row => {
          const transactionId = getCell(row, 'transaction_id');
          const saleTimestamp = getCell(row, 'timestamp');
          const saleTotal = toNumber(row.get('total'));
          const recordedPaidAmount = paymentTotals.get(transactionId) ?? 0;
          const paymentActivity = paymentActivityByTransaction.get(transactionId);
          const hasPayment = Number(paymentActivity?.amount ?? 0) > 0;
          const paidStatus = getCell(row, 'paid_status').toLowerCase();
          const effectivePaidStatus =
            recordedPaidAmount >= saleTotal && paidStatus !== 'voided' ? 'paid' : paidStatus;
          const isPaidSale = effectivePaidStatus === 'paid';
          const shouldInclude =
            transactionId &&
            saleTotal > 0 &&
            paidStatus !== 'voided' &&
            (isPaidSale || hasPayment);

          if (!shouldInclude) return [];

          const displayPaidAmount = hasPayment
            ? Number(paymentActivity?.amount ?? 0)
            : isPaidSale && recordedPaidAmount <= 0
              ? saleTotal
              : recordedPaidAmount;
          const balance = Math.max(saleTotal - recordedPaidAmount, 0);
          const historyStatus = isPaidSale ? 'paid' : 'partial';

          return [{
            transactionId,
            timestamp: paymentActivity?.latestTimestamp || saleTimestamp,
            staff: getCell(row, 'staff'),
            paymentMethod:
              paymentActivity?.labels.join(' + ') ||
              paymentSummaries.get(transactionId) ||
              getCell(row, 'payment_method'),
            paidStatus: historyStatus,
            roomOrGuest: getCell(row, 'room_or_guest'),
            total: displayPaidAmount,
            saleTotal,
            paidAmount: displayPaidAmount,
            paidToDate: Math.max(recordedPaidAmount, 0),
            balance,
            historyKind:
              paidStatus === 'unpaid' && hasPayment ? 'payment' : 'sale',
            refundableAmount: Math.max(displayPaidAmount, 0),
            itemCount: toNumber(row.get('item_count')),
            itemSummary: getCell(row, 'item_summary'),
            qpayInvoiceId:
              paymentActivity?.qpayInvoiceIds.join(' + ') || getCell(row, 'qpay_invoice_id'),
            receiptId: paymentActivity?.receiptIds.at(-1) || '',
            sessionId:
              paymentActivity?.sessionId || getCell(row, 'session_id'),
            businessDate:
              paymentActivity?.businessDate || getCell(row, 'business_date'),
            cashReceived: paymentActivity?.cashReceived || toNumber(row.get('cash_received')),
            changeDue: paymentActivity?.changeDue || toNumber(row.get('change_due')),
            notes: getCell(row, 'notes'),
            items: parseSaleItemDetails(getCell(row, 'item_details')),
            sortTime: paymentActivity?.sortTime || timestampMs(saleTimestamp),
          }];
        })
        .sort((a, b) => b.sortTime - a.sortTime)
        .map(sale => ({
          transactionId: sale.transactionId,
          timestamp: sale.timestamp,
          staff: sale.staff,
          paymentMethod: sale.paymentMethod,
          paidStatus: sale.paidStatus,
          roomOrGuest: sale.roomOrGuest,
          total: sale.total,
          saleTotal: sale.saleTotal,
          paidAmount: sale.paidAmount,
          paidToDate: sale.paidToDate,
          balance: sale.balance,
          historyKind: sale.historyKind,
          refundableAmount: sale.refundableAmount,
          itemCount: sale.itemCount,
          itemSummary: sale.itemSummary,
          qpayInvoiceId: sale.qpayInvoiceId,
          receiptId: sale.receiptId,
          sessionId: sale.sessionId,
          businessDate: sale.businessDate,
          cashReceived: sale.cashReceived,
          changeDue: sale.changeDue,
          notes: sale.notes,
          items: sale.items,
        }))
        .filter(sale => !sale.receiptId);

      const salesByTransactionId = new Map(
        completedSalesRows.map(row => [getCell(row, 'transaction_id'), row]),
      );
      const receiptHistory = receiptRows
        .filter(row => getCell(row, 'operation_status') === 'complete')
        .map(row => {
          const orderIds = getCell(row, 'order_ids')
            .split(',')
            .map(orderId => orderId.trim())
            .filter(Boolean);
          const orderRows = orderIds
            .map(orderId => salesByTransactionId.get(orderId))
            .filter((saleRow): saleRow is SheetRow => Boolean(saleRow));
          const total = toNumber(row.get('total'));
          const saleTotal = orderRows.reduce(
            (sum, saleRow) => sum + toNumber(saleRow.get('total')),
            0,
          );
          const balance = orderIds.reduce((sum, orderId) => {
            const saleRow = salesByTransactionId.get(orderId);
            const orderTotal = saleRow ? toNumber(saleRow.get('total')) : 0;
            return (
              sum +
              Math.max(orderTotal - (paymentTotals.get(orderId) ?? 0), 0)
            );
          }, 0);
          const isDebtPayment = orderRows.some(
            saleRow =>
              getCell(saleRow, 'paid_status').toLowerCase() === 'unpaid',
          );

          return {
            transactionId: orderIds.join(', '),
            orderIds,
            receiptId: getCell(row, 'receipt_id'),
            timestamp: getCell(row, 'timestamp'),
            staff: getCell(row, 'staff'),
            paymentMethod: getCell(row, 'payment_summary'),
            paidStatus: balance > 0 ? 'partial' : 'paid',
            roomOrGuest: Array.from(
              new Set(
                orderRows
                  .map(saleRow => getCell(saleRow, 'room_or_guest'))
                  .filter(Boolean),
              ),
            ).join(', '),
            total,
            saleTotal,
            paidAmount: total,
            paidToDate: orderIds.reduce(
              (sum, orderId) => sum + (paymentTotals.get(orderId) ?? 0),
              0,
            ),
            balance,
            historyKind: isDebtPayment ? ('payment' as const) : ('sale' as const),
            refundableAmount: total,
            itemCount: orderRows.reduce(
              (sum, saleRow) => sum + toNumber(saleRow.get('item_count')),
              0,
            ),
            itemSummary: orderRows
              .map(saleRow => getCell(saleRow, 'item_summary'))
              .filter(Boolean)
              .join(', '),
            qpayInvoiceId: getCell(row, 'qpay_invoice_id'),
            sessionId: getCell(row, 'session_id'),
            businessDate: getCell(row, 'business_date'),
            cashReceived: toNumber(row.get('cash_received')),
            changeDue: toNumber(row.get('change_due')),
            notes: getCell(row, 'notes'),
            items: orderRows.flatMap(saleRow =>
              parseSaleItemDetails(getCell(saleRow, 'item_details')),
            ),
          };
        });
      const history = [...receiptHistory, ...legacyHistory].sort(
        (first, second) =>
          timestampMs(second.timestamp) - timestampMs(first.timestamp),
      );

      return { charges: unpaidCharges, history };
    };
    const payload = bypassCache
      ? await loadSalesList()
      : await getCachedRead(
        'sales:list:all',
        SALES_READ_CACHE_TTL_MS,
        loadSalesList,
      );

    return NextResponse.json(payload);
  } catch (error) {
    console.error(`Sales GET Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: salesErrorMessage(error, 'Failed to fetch sales') },
      { status: 500 },
    );
  }
}

async function handlePATCH(request: Request) {
  const requestStartedAt = Date.now();
  let settlementRequestId = '';

  try {
    const sessionOrResponse = requireApiSession(request, 'cashier');
    if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
    const actorName = sessionOrResponse.displayName;
    const body = (await request.json()) as SettleSaleBody;
    settlementRequestId = String(body.clientRequestId ?? '').trim();
    const transactionId = body.transactionId?.trim() ?? '';
    const requestedSettlementBodies =
      Array.isArray(body.settlements) && body.settlements.length > 0
        ? body.settlements
        : [{ transactionId, payments: body.payments }];

    console.info('[sales:settlement] started', {
      requestId: settlementRequestId || 'legacy',
      settlementCount: requestedSettlementBodies.length,
    });

    if (
      body.action === 'edit_unpaid'
        ? !transactionId
        : requestedSettlementBodies.some(
            settlement => !settlement.transactionId?.trim(),
          )
    ) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const doc = await loadSpreadsheet();

    if (body.action === 'edit_unpaid') {
      const [salesLogSheet, paymentsLogSheet, daySessionSheet] =
        await Promise.all([
          getOrCreateSalesLogSheet(doc),
          getOrCreatePaymentsLogSheet(doc),
          getOrCreateSheet(
            doc,
            DAY_SESSION_SHEET_TITLES,
            DAY_SESSION_HEADERS,
          ),
        ]);
      const [salesRows, paymentRows, daySessionRows] = await Promise.all([
        salesLogSheet.getRows() as Promise<SheetRow[]>,
        paymentsLogSheet.getRows(),
        daySessionSheet.getRows(),
      ]);
      const activeSession = requireActiveBusinessSession(daySessionRows);
      const editStaleResponse = staleBusinessDayResponse(activeSession.businessDate);
      if (editStaleResponse) return editStaleResponse;
      const paymentTotals = getPaymentTotals(paymentRows);
      const row = salesRows.find(
        item => getCell(item, 'transaction_id') === transactionId,
      );
      if (!row) {
        return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
      }
      if (getCell(row, 'paid_status').toLowerCase() !== 'unpaid') {
        return NextResponse.json(
          { error: 'Sale is not an unpaid charge' },
          { status: 400 },
        );
      }
      const paidToDate = paymentTotals.get(transactionId) ?? 0;
      if (paidToDate > 0) {
        return NextResponse.json(
          { error: 'Partially paid charges cannot be edited' },
          { status: 400 },
        );
      }

      const items = (body.items ?? [])
        .map(item => ({
          sku: String(item.sku ?? '').trim(),
          name: String(item.name ?? item.sku ?? '').trim(),
          category: String(item.category ?? '').trim() || 'Үйлчилгээ',
          qty: toNumber(item.qty ?? 1),
          unitPrice: toNumber(item.unitPrice),
          priceMode:
            item.priceMode === 'guest' || item.priceMode === 'staff'
              ? item.priceMode
              : undefined,
        }))
        .filter(item => item.name && item.qty > 0 && item.unitPrice >= 0);

      if (items.length === 0) {
        return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
      }

      const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
      const total = Number.isFinite(body.total) ? toNumber(body.total) : subtotal;
      const room = String(body.room ?? '').trim();

      if (!room) {
        return NextResponse.json({ error: 'room is required' }, { status: 400 });
      }

      if (total <= 0) {
        return NextResponse.json({ error: 'total must be greater than zero' }, { status: 400 });
      }

      const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
      const inventoryLogSheet = await getOrCreateInventoryLogSheet(doc);
      const inventoryRows = await inventoryLogSheet.getRows();
      const currentInventoryBalances = getCurrentInventoryBalances(transactionId, inventoryRows);
      const reversalRows = currentInventoryBalances.map(inventoryItem => [
        transactionId,
        timestamp,
        inventoryItem.sku,
        inventoryItem.name,
        'Буцаалт',
        inventoryItem.quantity,
        inventoryItem.location,
        actorName,
        'Өр засвар',
        room,
        activeSession.sessionId,
        activeSession.businessDate,
      ]);
      const newInventoryRows = items
        .filter(item => item.sku && !isUnlimitedInventoryItem(item))
        .map(item => [
          transactionId,
          timestamp,
          item.sku,
          item.name,
          'Зарлага',
          item.qty,
          'Front Desk',
          actorName,
          'Өр засвар',
          room,
          activeSession.sessionId,
          activeSession.businessDate,
        ]);

      if (reversalRows.length > 0 || newInventoryRows.length > 0) {
        await inventoryLogSheet.addRows([...reversalRows, ...newInventoryRows]);
      }

      row.set('staff', actorName);
      row.set('payment_method', 'Байшин/Зочин');
      row.set('paid_status', 'unpaid');
      row.set('room_or_guest', room);
      row.set('subtotal', subtotal);
      row.set('discount', 0);
      row.set('total', total);
      row.set('cash_received', '');
      row.set('change_due', '');
      row.set('item_count', items.reduce((sum, item) => sum + item.qty, 0));
      row.set('item_summary', buildItemSummary(items));
      row.set('qpay_invoice_id', '');
      row.set('item_details', serializeSaleItemDetails(items));
      row.set(
        'notes',
        [getCell(row, 'notes'), `Edited ${timestamp} by ${actorName}`]
          .filter(Boolean)
          .join(' | '),
      );
      await row.save();
      clearCachedReads('sales:');
      clearCachedReads('day:');

      return NextResponse.json({
        success: true,
        message: 'Sale updated',
        transactionId,
        total,
      });
    }

    const salesLogSheet = findExistingSheet(doc, SALES_LOG_SHEET_TITLES);
    const paymentsLogSheet = findExistingSheet(
      doc,
      PAYMENTS_LOG_SHEET_TITLES,
    );
    const receiptsLogSheet = findExistingSheet(
      doc,
      RECEIPTS_LOG_SHEET_TITLES,
    );
    const daySessionSheet = findExistingSheet(
      doc,
      DAY_SESSION_SHEET_TITLES,
    );
    if (
      !salesLogSheet ||
      !paymentsLogSheet ||
      !receiptsLogSheet ||
      !daySessionSheet
    ) {
      throw new Error(
        'Settlement sheets are not initialized. Open the register once and retry.',
      );
    }

    const [salesTable, paymentsTable, receiptsTable, daySessionTable] =
      await batchReadSheetTables(doc, [
        { sheet: salesLogSheet, requiredHeaders: SALES_LOG_HEADERS },
        { sheet: paymentsLogSheet, requiredHeaders: PAYMENT_LOG_HEADERS },
        { sheet: receiptsLogSheet, requiredHeaders: RECEIPT_LOG_HEADERS },
        { sheet: daySessionSheet, requiredHeaders: DAY_SESSION_HEADERS },
      ]);
    const salesRows = salesTable.rows;
    const paymentRows = paymentsTable.rows;
    const receiptRows = receiptsTable.rows;
    const daySessionRows = daySessionTable.rows;
    const normalizedClientRequestId = settlementRequestId;
    const existingReceipt = normalizedClientRequestId
      ? receiptRows.find(
          row =>
            getCell(row, 'client_request_id') ===
            normalizedClientRequestId,
        )
      : undefined;
    if (existingReceipt) {
      const operationStatus = getCell(existingReceipt, 'operation_status');
      if (operationStatus !== 'complete') {
        console.warn('[sales:settlement] replay-pending', {
          requestId: normalizedClientRequestId,
          receiptId: getCell(existingReceipt, 'receipt_id'),
          durationMs: Date.now() - requestStartedAt,
        });
        return NextResponse.json(
          {
            error:
              'This payment request reached the ledger but did not finish. Check History before retrying.',
            receiptId: getCell(existingReceipt, 'receipt_id'),
          },
          { status: 409 },
        );
      }

      console.info('[sales:settlement] replay-complete', {
        requestId: normalizedClientRequestId,
        receiptId: getCell(existingReceipt, 'receipt_id'),
        durationMs: Date.now() - requestStartedAt,
      });
      return NextResponse.json({
        success: true,
        duplicateRequest: true,
        receiptId: getCell(existingReceipt, 'receipt_id'),
        settledAt: getCell(existingReceipt, 'timestamp'),
        sessionId: getCell(existingReceipt, 'session_id'),
        businessDate: getCell(existingReceipt, 'business_date'),
      });
    }
    const activeSession = requireActiveBusinessSession(daySessionRows);
    const staleResponse = staleBusinessDayResponse(activeSession.businessDate);
    if (staleResponse) return staleResponse;
    const paymentTotals = getPaymentTotals(paymentRows);

    const plannedSettlements: Array<{
      transactionId: string;
      payments: Array<SettlementPaymentInput & {
        paymentMethod: string;
        amount: number;
      }>;
      balance: number;
      paymentTotal: number;
    }> = [];

    for (const settlementBody of requestedSettlementBodies) {
      const settlementTransactionId = settlementBody.transactionId?.trim() ?? '';
      const row = salesRows.find(
        item => getCell(item, 'transaction_id') === settlementTransactionId,
      );
      if (!row) {
        return NextResponse.json(
          { error: `Sale not found: ${settlementTransactionId}` },
          { status: 404 },
        );
      }
      if (getCell(row, 'paid_status').toLowerCase() !== 'unpaid') {
        return NextResponse.json(
          { error: `Sale is not an unpaid charge: ${settlementTransactionId}` },
          { status: 400 },
        );
      }

      const saleTotal = toNumber(row.get('total'));
      const paidToDate = paymentTotals.get(settlementTransactionId) ?? 0;
      const balance = Math.max(saleTotal - paidToDate, 0);
      if (balance === 0) continue;

      const hasNestedPaymentArray =
        Array.isArray(settlementBody.payments) &&
        settlementBody.payments.length > 0;
      const sourcePayments = hasNestedPaymentArray
        ? settlementBody.payments ?? []
        : getSettlementPayments(body);
      const requestedPayments = sourcePayments.map((payment, index) => ({
        ...payment,
        paymentMethod: payment.paymentMethod?.trim() ?? '',
        amount: Number(
          payment.amount ??
            (!hasNestedPaymentArray && index === 0 ? balance : 0),
        ),
      }));
      const invalidPayment = requestedPayments.find(
        payment =>
          !payment.paymentMethod ||
          !Number.isFinite(payment.amount) ||
          payment.amount <= 0,
      );
      if (invalidPayment) {
        return NextResponse.json(
          {
            error: `Each payment must have a method and amount greater than zero: ${settlementTransactionId}`,
          },
          { status: 400 },
        );
      }

      const paymentTotal = requestedPayments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      if (paymentTotal > balance) {
        return NextResponse.json(
          {
            error: `Payment amount is greater than the remaining balance: ${settlementTransactionId}`,
          },
          { status: 400 },
        );
      }

      plannedSettlements.push({
        transactionId: settlementTransactionId,
        payments: requestedPayments,
        balance,
        paymentTotal,
      });
    }

    if (plannedSettlements.length === 0) {
      console.info('[sales:settlement] already-settled', {
        requestId: normalizedClientRequestId || 'legacy',
        durationMs: Date.now() - requestStartedAt,
      });
      return NextResponse.json({
        success: true,
        message: 'Sale is already settled',
      });
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
    const receiptTotal = plannedSettlements.reduce(
      (sum, settlement) => sum + settlement.paymentTotal,
      0,
    );
    const allPayments = plannedSettlements.flatMap(
      settlement => settlement.payments,
    );
    const receiptRecord: Record<string, unknown> = {
      receipt_id: makeUniformControlNumber('RCP'),
      timestamp,
      session_id: activeSession.sessionId,
      business_date: activeSession.businessDate,
      staff: actorName,
      order_ids: plannedSettlements
        .map(settlement => settlement.transactionId)
        .join(', '),
      total: receiptTotal,
      payment_summary: allPayments
        .map(payment => `${payment.paymentMethod} ${payment.amount}`)
        .join(' + '),
      cash_received:
        allPayments.reduce(
          (sum, payment) => sum + Number(payment.cashReceived ?? 0),
          0,
        ) || '',
      change_due:
        allPayments.reduce(
          (sum, payment) => sum + Number(payment.changeDue ?? 0),
          0,
        ) || '',
      qpay_invoice_id: allPayments
        .map(payment => payment.qpayInvoiceId)
        .filter(Boolean)
        .join(' + '),
      notes: `Settlement for ${plannedSettlements
        .map(settlement => settlement.transactionId)
        .join(', ')}`,
      client_request_id: normalizedClientRequestId,
      operation_status: 'pending',
    };
    const receiptRowNumber = await appendReceiptClaim(
      doc,
      receiptsLogSheet,
      receiptsTable.valuesFor(receiptRecord),
    );
    const receiptId = makeUniformReceiptNumber(
      receiptRowNumber,
      activeSession.businessDate,
    );
    receiptRecord.receipt_id = receiptId;
    receiptRecord.operation_status = 'complete';
    let paymentLineIndex = 0;
    const paymentRecords = plannedSettlements.flatMap(settlement =>
      settlement.payments.map(payment => {
        paymentLineIndex += 1;
        return {
          payment_id: makePaymentLineNumber(receiptId, paymentLineIndex),
          transaction_id: settlement.transactionId,
          timestamp,
          staff: actorName,
          payment_method: payment.paymentMethod,
          amount: payment.amount,
          cash_received: payment.cashReceived ?? '',
          change_due: payment.changeDue ?? '',
          qpay_invoice_id: payment.qpayInvoiceId ?? '',
          notes:
            payment.notes ||
            `Settlement payment for ${settlement.transactionId}`,
          receipt_id: receiptId,
          session_id: activeSession.sessionId,
          business_date: activeSession.businessDate,
        };
      }),
    );
    await completeReceiptAndAppendPayments(
      doc,
      receiptsLogSheet,
      receiptRowNumber,
      receiptsTable.valuesFor(receiptRecord),
      paymentsLogSheet,
      paymentRecords.map(record => paymentsTable.valuesFor(record)),
    );
    clearCachedReads('sales:');
    clearCachedReads('day:');

    console.info('[sales:settlement] completed', {
      requestId: normalizedClientRequestId || 'legacy',
      receiptId,
      settlementCount: plannedSettlements.length,
      durationMs: Date.now() - requestStartedAt,
    });

    return NextResponse.json({
      success: true,
      message: 'Payment recorded',
      receiptId,
      sessionId: activeSession.sessionId,
      businessDate: activeSession.businessDate,
      settlements: plannedSettlements.map(settlement => ({
        transactionId: settlement.transactionId,
        balance: Math.max(
          settlement.balance - settlement.paymentTotal,
          0,
        ),
      })),
      balance:
        plannedSettlements.length === 1
          ? Math.max(
              plannedSettlements[0].balance -
                plannedSettlements[0].paymentTotal,
              0,
            )
          : undefined,
      settledAt: timestamp,
    });
  } catch (error) {
    console.error('[sales:settlement] failed', {
      requestId: settlementRequestId || 'legacy',
      durationMs: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: salesErrorMessage(error, 'Failed to settle sale') },
      { status: 500 },
    );
  }
}

export const GET = withProtectedApiRoute('/api/sales', 'cashier', handleGET);
export const PATCH = withProtectedApiRoute('/api/sales', 'cashier', handlePATCH);

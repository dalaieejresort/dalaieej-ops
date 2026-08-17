import {
  GoogleSpreadsheet,
  type GoogleSpreadsheetWorksheet,
} from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { withProtectedApiRoute } from '@/lib/server/api-route';
import { requireApiSession } from '@/lib/server/auth';
import { clearCachedReads } from '@/lib/server/read-cache';
import { staleBusinessDayResponse } from '@/lib/server/business-day-guard';
import {
  makeUniformControlNumber,
  PAYMENT_LOG_HEADERS,
} from '@/lib/pos/payment-controls';
import {
  DAY_SESSION_HEADERS,
  getActiveBusinessSession,
} from '@/lib/server/business-session';
import {
  operationFingerprint,
  operationTimestamp,
} from '@/lib/server/operation-controls';
import {
  appendRowsRequest,
  executeAtomicBatch,
  updateRowRequest,
} from '@/lib/server/sheets-atomic';

type VoidSaleBody = {
  transactionId?: string;
  businessDate?: string;
  staffName?: string;
  reason?: string;
  refundMethod?: string;
  clientRequestId?: string;
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
  rowNumber: number;
};

type SessionWindow = {
  openedAt?: string;
  closedAt?: string;
};

const INVENTORY_LOG_SHEET_TITLES = [
  process.env.GOOGLE_LOG_SHEET_TITLE,
  'Inventory_Log',
  'inventory_log',
].filter(Boolean) as string[];

const SALES_LOG_SHEET_TITLES = [
  process.env.GOOGLE_SALES_SHEET_TITLE,
  'Sales_Log',
  'sales_log',
].filter(Boolean) as string[];

const PAYMENTS_LOG_SHEET_TITLES = [
  process.env.GOOGLE_PAYMENTS_SHEET_TITLE,
  'Payments_Log',
  'payments_log',
].filter(Boolean) as string[];

const VOIDS_LOG_SHEET_TITLES = [
  process.env.GOOGLE_VOIDS_SHEET_TITLE,
  'Voids_Log',
  'voids_log',
].filter(Boolean) as string[];

const DAY_SESSION_SHEET_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  'Day_Sessions',
  'day_sessions',
].filter(Boolean) as string[];

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
  'Adjustment Reason',
  'Client Request ID',
  'Operation Status',
  'Request Fingerprint',
  'Operation Updated At',
];

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
  'request_fingerprint',
  'operation_error',
  'operation_updated_at',
  'last_edit_request_id',
  'last_edit_fingerprint',
];

const VOIDS_LOG_HEADERS = [
  'void_id',
  'transaction_id',
  'timestamp',
  'staff',
  'reason',
  'original_status',
  'original_total',
  'refund_method',
  'refund_amount',
  'item_summary',
  'notes',
  'session_id',
  'business_date',
  'client_request_id',
  'operation_status',
  'request_fingerprint',
  'operation_error',
  'operation_updated_at',
];

function valuesFor(
  sheet: GoogleSpreadsheetWorksheet,
  record: Record<string, unknown>,
) {
  return sheet.headerValues.map(header => record[header] ?? '');
}

const INVENTORY_COLUMNS = {
  transactionId: ['Transaction ID', 'transaction_id'],
  sku: ['SKU (Барааны код)', 'sku', 'SKU'],
  name: ['Item Description', 'item_name', 'name'],
  type: ['Type (Хөдөлгөөн)', 'type'],
  quantity: ['Quantity (Тоо)', 'qty', 'quantity'],
  location: ['Location (Байршил)', 'location'],
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
  const doc = createDoc();
  await doc.loadInfo();
  return doc;
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

function nowTimestamp() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
}

function normalizeBusinessDate(value: unknown) {
  const text = String(value ?? '').trim();
  if (text) return text;

  return new Intl.DateTimeFormat('mn-MN', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '.');
}

function businessDateFromTimestamp(value: unknown) {
  const timestamp = String(value ?? '').trim();
  const match = timestamp.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (match) {
    const [, month, day, year] = match;
    return `${year}.${month.padStart(2, '0')}.${day.padStart(2, '0')}`;
  }

  const parsed = new Date(timestamp);
  if (!Number.isNaN(parsed.getTime())) {
    return new Intl.DateTimeFormat('mn-MN', {
      timeZone: 'Asia/Ulaanbaatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(parsed)
      .replace(/\//g, '.');
  }

  return '';
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

function createVoidId() {
  return `VOID-${Math.floor(100000 + Math.random() * 900000)}`;
}

function getLatestSession(rows: SheetRow[], businessDate: string) {
  return rows
    .filter(row => getCell(row, 'business_date') === businessDate)
    .at(-1) ?? null;
}

function getSessionWindow(row: SheetRow | null): SessionWindow | undefined {
  if (!row) return undefined;

  return {
    openedAt: getCell(row, 'opened_at'),
    closedAt: getCell(row, 'closed_at'),
  };
}

function isInsideSessionWindow(
  timestamp: unknown,
  openedAt?: string,
  closedAt?: string,
) {
  if (!openedAt && !closedAt) return true;

  const rowMs = timestampMs(timestamp);
  const openedMs = openedAt ? timestampMs(openedAt) : 0;
  const closedMs = closedAt ? timestampMs(closedAt) : 0;

  if (!rowMs) return false;
  if (openedMs && rowMs < openedMs) return false;
  if (closedMs && rowMs > closedMs) return false;

  return true;
}

function isInsideBusinessDay(
  timestamp: unknown,
  businessDate: string,
  sessionWindow?: SessionWindow,
) {
  if (sessionWindow?.openedAt || sessionWindow?.closedAt) {
    return isInsideSessionWindow(
      timestamp,
      sessionWindow.openedAt,
      sessionWindow.closedAt,
    );
  }

  return businessDateFromTimestamp(timestamp) === businessDate;
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

function normalizeLookup(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('mn-MN');
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

function getRecentSale(row: SheetRow, paymentTotals: Map<string, number>) {
  const transactionId = getCell(row, 'transaction_id');
  const total = toNumber(row.get('total'));
  const paidAmount = paymentTotals.get(transactionId) ?? 0;

  return {
    transactionId,
    timestamp: getCell(row, 'timestamp'),
    staff: getCell(row, 'staff'),
    paymentMethod: getCell(row, 'payment_method'),
    paidStatus: getCell(row, 'paid_status'),
    roomOrGuest: getCell(row, 'room_or_guest'),
    total,
    paidAmount,
    refundableAmount: Math.max(paidAmount, 0),
    itemSummary: getCell(row, 'item_summary'),
    notes: getCell(row, 'notes'),
  };
}

function voidsErrorMessage(error: unknown, fallback: string) {
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

  return fallback;
}

async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get('businessDate'));
    const doc = await loadSpreadsheet();
    const daySessionSheet = await getOrCreateSheet(
      doc,
      DAY_SESSION_SHEET_TITLES,
      DAY_SESSION_HEADERS,
    );
    const salesLogSheet = await getOrCreateSheet(doc, SALES_LOG_SHEET_TITLES, SALES_LOG_HEADERS);
    const paymentsLogSheet = await getOrCreateSheet(
      doc,
      PAYMENTS_LOG_SHEET_TITLES,
      PAYMENT_LOG_HEADERS,
    );
    const [dayRows, salesRows, paymentRows] = await Promise.all([
      daySessionSheet.getRows() as Promise<SheetRow[]>,
      salesLogSheet.getRows() as Promise<SheetRow[]>,
      paymentsLogSheet.getRows(),
    ]);
    const sessionWindow = getSessionWindow(getLatestSession(dayRows, businessDate));
    const paymentTotals = getPaymentTotals(paymentRows);
    const sales = salesRows
      .filter(row => isInsideBusinessDay(row.get('timestamp'), businessDate, sessionWindow))
      .filter(row => getCell(row, 'operation_status') !== 'pending')
      .filter(row => getCell(row, 'paid_status').toLowerCase() !== 'voided')
      .map(row => getRecentSale(row, paymentTotals))
      .filter(sale => sale.transactionId)
      .reverse()
      .slice(0, 25);

    return NextResponse.json({ sales });
  } catch (error) {
    console.error(`Voids GET Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: voidsErrorMessage(error, 'Failed to fetch recent sales') },
      { status: 500 },
    );
  }
}

async function handlePOST(request: Request) {
  try {
    const sessionOrResponse = requireApiSession(request, 'manager');
    if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
    const actorName = sessionOrResponse.displayName;
    const body = (await request.json()) as VoidSaleBody;
    const transactionId = body.transactionId?.trim();
    const reason = body.reason?.trim();
    const refundMethod = body.refundMethod?.trim() || 'No refund';
    const clientRequestId = body.clientRequestId?.trim() ?? '';

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
    }
    if (!clientRequestId || clientRequestId.length > 128) {
      return NextResponse.json(
        { error: 'clientRequestId is required and must be 128 characters or less' },
        { status: 400 },
      );
    }

    const doc = await loadSpreadsheet();
    const daySessionSheet = await getOrCreateSheet(
      doc,
      DAY_SESSION_SHEET_TITLES,
      DAY_SESSION_HEADERS,
    );
    const inventoryLogSheet = await getOrCreateSheet(
      doc,
      INVENTORY_LOG_SHEET_TITLES,
      INVENTORY_LOG_HEADERS,
    );
    const salesLogSheet = await getOrCreateSheet(doc, SALES_LOG_SHEET_TITLES, SALES_LOG_HEADERS);
    const paymentsLogSheet = await getOrCreateSheet(
      doc,
      PAYMENTS_LOG_SHEET_TITLES,
      PAYMENT_LOG_HEADERS,
    );
    const voidsLogSheet = await getOrCreateSheet(doc, VOIDS_LOG_SHEET_TITLES, VOIDS_LOG_HEADERS);
    const [dayRows, inventoryRows, salesRows, paymentRows, voidRows] = await Promise.all([
      daySessionSheet.getRows() as Promise<SheetRow[]>,
      inventoryLogSheet.getRows(),
      salesLogSheet.getRows() as Promise<SheetRow[]>,
      paymentsLogSheet.getRows(),
      voidsLogSheet.getRows() as Promise<SheetRow[]>,
    ]);
    const requestFingerprint = operationFingerprint({
      action: 'void',
      transactionId,
      reason,
      refundMethod,
    });
    const existingVoid = voidRows.find(
      row => getCell(row, 'client_request_id') === clientRequestId,
    );
    if (existingVoid && getCell(existingVoid, 'operation_status') === 'complete') {
      return NextResponse.json({
        success: true,
        duplicateRequest: true,
        message: 'Sale voided',
        voidId: getCell(existingVoid, 'void_id'),
        transactionId,
        refundAmount: toNumber(existingVoid.get('refund_amount')),
      });
    }
    if (existingVoid) {
      const storedFingerprint = getCell(existingVoid, 'request_fingerprint');
      if (!storedFingerprint || storedFingerprint !== requestFingerprint) {
        return NextResponse.json(
          {
            error: !storedFingerprint
              ? 'This legacy pending void needs manager review before retrying.'
              : 'This request ID was already used for different void data. Refresh and retry once.',
          },
          { status: 409 },
        );
      }
    }
    const activeBusinessSession = existingVoid
      ? {
          sessionId: getCell(existingVoid, 'session_id'),
          businessDate: getCell(existingVoid, 'business_date'),
          openedAt: '',
        }
      : getActiveBusinessSession(dayRows);
    if (!activeBusinessSession) {
      return NextResponse.json(
        { error: 'Open the day before voiding or refunding a sale' },
        { status: 400 },
      );
    }
    if (!existingVoid) {
      const staleResponse = staleBusinessDayResponse(activeBusinessSession.businessDate);
      if (staleResponse) return staleResponse;
    }

    const saleRow = salesRows.find(row => getCell(row, 'transaction_id') === transactionId);

    if (!saleRow) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }
    if (getCell(saleRow, 'operation_status') === 'pending') {
      return NextResponse.json(
        { error: 'Sale is still pending and cannot be voided yet' },
        { status: 409 },
      );
    }

    const originalStatus = getCell(saleRow, 'paid_status').toLowerCase();
    if (originalStatus === 'voided') {
      return NextResponse.json({ error: 'Sale is already voided' }, { status: 400 });
    }

    const timestamp = existingVoid
      ? getCell(existingVoid, 'timestamp')
      : nowTimestamp();
    const originalTotal = toNumber(saleRow.get('total'));
    const paidAmount = getPaymentTotals(paymentRows).get(transactionId) ?? 0;
    const refundAmount = Math.max(paidAmount, 0);
    const itemSummary = getCell(saleRow, 'item_summary');
    const voidId = existingVoid
      ? getCell(existingVoid, 'void_id')
      : createVoidId();
    const currentInventoryBalances = getCurrentInventoryBalances(transactionId, inventoryRows);
    const reversalRows: Array<Array<string | number>> = currentInventoryBalances.map(item => [
      `${transactionId}-VOID`,
      timestamp,
      item.sku,
      item.name,
      'Буцаалт',
      item.quantity,
      item.location,
      actorName,
      `Буцаалт - ${refundMethod}`,
      getCell(saleRow, 'room_or_guest'),
      activeBusinessSession.sessionId,
      activeBusinessSession.businessDate,
    ]);

    const voidRecord: Record<string, string | number> = {
      void_id: voidId,
      transaction_id: transactionId,
      timestamp,
      staff: actorName,
      reason,
      original_status: originalStatus || 'paid',
      original_total: originalTotal,
      refund_method: refundAmount > 0 ? refundMethod : 'No refund',
      refund_amount: refundAmount,
      item_summary: itemSummary,
      notes: '',
      session_id: activeBusinessSession.sessionId,
      business_date: activeBusinessSession.businessDate,
      client_request_id: clientRequestId,
      operation_status: 'pending',
      request_fingerprint: requestFingerprint,
      operation_error: '',
      operation_updated_at: operationTimestamp(),
    };
    const voidRow = existingVoid ?? (await voidsLogSheet.addRows([voidRecord]))[0];
    voidRecord.operation_status = 'complete';
    voidRecord.operation_updated_at = operationTimestamp();
    const saleValues = salesLogSheet.headerValues.map(header => {
      if (header === 'paid_status') return 'voided';
      if (header === 'notes') {
        return [getCell(saleRow, 'notes'), `Voided ${timestamp}: ${reason}`]
          .filter(Boolean)
          .join(' | ');
      }
      return saleRow.get(header) ?? '';
    });
    const refundRecord: Record<string, unknown> = {
      payment_id: makeUniformControlNumber('RFN'),
      transaction_id: transactionId,
      timestamp,
      staff: actorName,
      payment_method: `Буцаалт - ${refundMethod}`,
      amount: -refundAmount,
      cash_received: '',
      change_due: '',
      qpay_invoice_id: getCell(saleRow, 'qpay_invoice_id'),
      notes: `Void ${voidId}: ${reason}`,
      receipt_id: '',
      session_id: activeBusinessSession.sessionId,
      business_date: activeBusinessSession.businessDate,
    };
    await executeAtomicBatch(doc, [
      updateRowRequest(
        voidsLogSheet,
        voidRow.rowNumber,
        valuesFor(voidsLogSheet, voidRecord),
      ),
      updateRowRequest(salesLogSheet, saleRow.rowNumber, saleValues),
      ...(reversalRows.length > 0
        ? [appendRowsRequest(inventoryLogSheet, reversalRows)]
        : []),
      ...(refundAmount > 0
        ? [
            appendRowsRequest(paymentsLogSheet, [
              valuesFor(paymentsLogSheet, refundRecord),
            ]),
          ]
        : []),
    ]);
    clearCachedReads('sales:');
    clearCachedReads('day:');
    clearCachedReads('inventory:');

    return NextResponse.json({
      success: true,
      message: 'Sale voided',
      voidId,
      transactionId,
      refundAmount,
    });
  } catch (error) {
    console.error(`Voids POST Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: voidsErrorMessage(error, 'Failed to void sale') },
      { status: 500 },
    );
  }
}

export const GET = withProtectedApiRoute('/api/voids', 'cashier', handleGET);
export const POST = withProtectedApiRoute('/api/voids', 'manager', handlePOST);

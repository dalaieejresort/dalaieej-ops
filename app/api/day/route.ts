import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { after, NextResponse } from 'next/server';
import {
  makeUniformControlNumber,
  makeUniformSessionNumber,
  PAYMENT_LOG_HEADERS,
} from '@/lib/pos/payment-controls';
import {
  DAY_SESSION_HEADERS,
  getSessionBusinessDate,
  getSessionId,
  businessDateFromTimestamp,
  rowBelongsToBusinessDate,
} from '@/lib/server/business-session';
import { clearCachedReads, getCachedRead } from '@/lib/server/read-cache';
import { withProtectedApiRoute } from '@/lib/server/api-route';
import { requireApiSession } from '@/lib/server/auth';
import { staleBusinessDayResponse } from '@/lib/server/business-day-guard';
import { mergeManagementBoardSectionSafely } from '@/lib/server/management-board';
import { ORDER_ITEMS_SHEET_TITLES } from '@/lib/server/order-items';

type DayAction = 'open' | 'close';

type DayPostBody = {
  action?: DayAction;
  businessDate?: string;
  staffName?: string;
  startingCash?: number;
  countedCash?: number;
  notes?: string;
  clientRequestId?: string;
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
  rowNumber?: number;
};

type DayTotals = {
  salesTotal: number;
  paymentTotal: number;
  cashPaymentTotal: number;
  cardPaymentTotal: number;
  qpayPaymentTotal: number;
  otherPaymentTotal: number;
  roomChargeTotal: number;
  currentSalePaymentTotal: number;
  priorDebtCollectedTotal: number;
  refundTotal: number;
  newRoomDebtTotal: number;
  expectedCash: number;
  receiptCount: number;
  firstReceiptId: string;
  lastReceiptId: string;
};

type DayItemTotal = {
  name: string;
  quantity: number;
};

const DAY_READ_CACHE_TTL_MS = 60000;
const DAY_SESSION_READ_CACHE_TTL_MS = 30000;
const SHEET_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;

let cachedSpreadsheet:
  | { expiresAt: number; promise: Promise<SheetDoc> }
  | undefined;

const DAY_SESSION_SHEET_TITLES = [
  process.env.GOOGLE_DAY_SESSION_SHEET_TITLE,
  'Day_Sessions',
  'day_sessions',
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

function findExistingSheet(doc: SheetDoc, titles: string[]) {
  return titles.map(title => doc.sheetsByTitle[title]).find(Boolean) ?? null;
}

function rowsFromValues(values: unknown[][]): SheetRow[] {
  const headers = (values[0] ?? []).map(value => String(value ?? '').trim());
  return values.slice(1).map((rowValues, index) => ({
    rowNumber: index + 2,
    get: (columnName: string) => {
      const columnIndex = headers.indexOf(columnName);
      return columnIndex >= 0 ? rowValues[columnIndex] : undefined;
    },
    set: () => {
      throw new Error('Read-only Google Sheets row');
    },
    save: async () => {
      throw new Error('Read-only Google Sheets row');
    },
  }));
}

async function batchReadRows(
  doc: SheetDoc,
  sheets: Array<NonNullable<ReturnType<typeof findExistingSheet>>>,
) {
  const rangeQuery = sheets
    .map(sheet => `ranges=${encodeURIComponent(`${sheet.a1SheetName}!A:ZZ`)}`)
    .join('&');
  const response = await doc.sheetsApi.get(`values:batchGet?${rangeQuery}`, {
    searchParams: {
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
    },
  });
  const payload = (await response.json()) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
  };
  return sheets.map((_, index) =>
    rowsFromValues(payload.valueRanges?.[index]?.values ?? []),
  );
}

async function getDayReadContext(businessDate: string) {
  const doc = await loadSpreadsheet();
  const daySheet = findExistingSheet(doc, DAY_SESSION_SHEET_TITLES);
  const salesLogSheet = findExistingSheet(doc, SALES_LOG_SHEET_TITLES);
  const paymentsLogSheet = findExistingSheet(doc, PAYMENTS_LOG_SHEET_TITLES);
  if (!daySheet || !salesLogSheet || !paymentsLogSheet) {
    throw new Error('Day, sales, or payments sheet is not initialized');
  }
  const orderItemsSheet = findExistingSheet(doc, ORDER_ITEMS_SHEET_TITLES);
  const sheets = [
    daySheet,
    salesLogSheet,
    paymentsLogSheet,
    ...(orderItemsSheet ? [orderItemsSheet] : []),
  ];
  const [dayRows, salesRows, paymentRows, orderItemRows = []] =
    await batchReadRows(doc, sheets);
  const sessionRow = getLatestSession(dayRows, businessDate);
  const { totals, itemTotals } = getDayMetrics(
    salesRows,
    paymentRows,
    businessDate,
    sessionRow,
    orderItemRows,
  );
  return { dayRows, sessionRow, totals, itemTotals };
}

async function getDaySessionReadContext(businessDate: string) {
  const doc = await loadSpreadsheet();
  const daySheet = findExistingSheet(doc, DAY_SESSION_SHEET_TITLES);
  if (!daySheet) throw new Error('Day session sheet is not initialized');
  const [dayRows] = await batchReadRows(doc, [daySheet]);
  return { sessionRow: getLatestSession(dayRows, businessDate) };
}

async function getOrCreateSheet(
  doc: SheetDoc,
  titles: string[],
  headers: readonly string[],
) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) {
      await sheet.loadHeaderRow();
      const missingHeaders = headers.filter(
        header => !sheet.headerValues.includes(header),
      );

      if (missingHeaders.length > 0) {
        const nextHeaders = [...sheet.headerValues, ...missingHeaders];
        if (nextHeaders.length > sheet.columnCount) {
          await sheet.resize({
            rowCount: sheet.rowCount,
            columnCount: nextHeaders.length,
          });
        }
        await sheet.setHeaderRow(nextHeaders);
      }

      return sheet;
    }
  }

  return doc.addSheet({
    title: titles[0] ?? 'Sheet',
    headerValues: [...headers],
  });
}

function nowTimestamp() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
}

function startOfBusinessDateTimestamp(businessDate: string) {
  const match = businessDate.match(/^(\d{4})\.(\d{2})\.(\d{2})$/);
  if (!match) return nowTimestamp();

  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}, 12:00:00 AM`;
}

function todayBusinessDate() {
  return new Intl.DateTimeFormat('mn-MN', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(new Date())
    .replace(/\//g, '.');
}

function normalizeBusinessDate(value: unknown) {
  const text = String(value ?? '').trim();
  return text || todayBusinessDate();
}

function getCell(row: { get: (columnName: string) => unknown }, column: string) {
  return String(row.get(column) ?? '').trim();
}

function toNumber(value: unknown) {
  const cleaned = String(value ?? '').replace(/[₮,\s]/g, '');
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function isInsideBusinessDay(
  row: { get: (columnName: string) => unknown },
  businessDate: string,
) {
  return rowBelongsToBusinessDate(row, businessDate);
}

function classifyPaymentMethod(method: string) {
  const normalized = method.toLowerCase();

  if (
    normalized.includes('qpay') ||
    normalized.includes('данс') ||
    normalized.includes('bank')
  ) return 'qpay';
  if (normalized.includes('карт') || normalized.includes('card')) return 'card';
  if (normalized.includes('бэлэн') || normalized.includes('cash')) return 'cash';

  return 'other';
}

function getPaymentTotals(paymentRows: Array<{ get: (columnName: string) => unknown }>) {
  const totals = new Map<string, number>();

  for (const row of paymentRows) {
    const transactionId = getCell(row, 'transaction_id');
    if (!transactionId) continue;

    totals.set(transactionId, (totals.get(transactionId) ?? 0) + toNumber(row.get('amount')));
  }

  return totals;
}

function getLatestSession(rows: SheetRow[], businessDate: string) {
  return rows
    .filter(row => getSessionBusinessDate(row) === businessDate)
    .at(-1) ?? null;
}

function getActiveSession(rows: SheetRow[]) {
  // Sheet order is append-only, so the newest valid row is authoritative.
  // Ignoring older open rows prevents a stale date from resurfacing.
  const latestSession = rows
    .slice()
    .reverse()
    .find(row => getCell(row, 'business_date')) ?? null;

  return latestSession && getCell(latestSession, 'status').toLowerCase() === 'open'
    ? latestSession
    : null;
}

function serializeSession(row: SheetRow | null) {
  if (!row) return null;

  return {
    businessDate: getSessionBusinessDate(row),
    sessionId: getSessionId(row),
    openedAt: getCell(row, 'opened_at'),
    openedBy: getCell(row, 'opened_by'),
    startingCash: toNumber(row.get('starting_cash')),
    status: getCell(row, 'status') || 'open',
    closedAt: getCell(row, 'closed_at'),
    closedBy: getCell(row, 'closed_by'),
    countedCash: toNumber(row.get('counted_cash')),
    expectedCash: toNumber(row.get('expected_cash')),
    cashDifference: toNumber(row.get('cash_difference')),
    paymentTotal: toNumber(row.get('payment_total')),
    cashPaymentTotal: toNumber(row.get('cash_payment_total')),
    cardPaymentTotal: toNumber(row.get('card_payment_total')),
    qpayPaymentTotal: toNumber(row.get('qpay_payment_total')),
    otherPaymentTotal: toNumber(row.get('other_payment_total')),
    roomChargeTotal: toNumber(row.get('room_charge_total')),
    salesTotal: toNumber(row.get('sales_total')),
    notes: getCell(row, 'notes'),
    receiptCount: toNumber(row.get('receipt_count')),
    firstReceiptId: getCell(row, 'first_receipt_id'),
    lastReceiptId: getCell(row, 'last_receipt_id'),
    currentSalePaymentTotal: toNumber(row.get('current_sale_payment_total')),
    priorDebtCollectedTotal: toNumber(row.get('prior_debt_collected_total')),
    refundTotal: toNumber(row.get('refund_total')),
    newRoomDebtTotal: toNumber(row.get('new_room_debt_total')),
    clientRequestId: getCell(row, 'client_request_id'),
    operationStatus: getCell(row, 'operation_status'),
  };
}

function getClosedSessionHistory(rows: SheetRow[]) {
  return rows
    .slice()
    .reverse()
    .map(row => serializeSession(row))
    .filter(session => session?.status.toLowerCase() === 'closed');
}

function getDaySalesRows(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
) {
  return salesRows.filter(
    row =>
      getCell(row, 'operation_status') !== 'pending' &&
      isInsideBusinessDay(row, businessDate),
  );
}

function getDayPaymentRows(
  paymentRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
) {
  const dayPaymentRows = paymentRows.filter(
    row => isInsideBusinessDay(row, businessDate),
  );

  return dayPaymentRows;
}

function getDayTotals(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  paymentRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  startingCash: number,
): DayTotals {
  const daySalesRows = getDaySalesRows(salesRows, businessDate);
  const dayPaymentRows = getDayPaymentRows(paymentRows, businessDate);
  const totals: DayTotals = {
    salesTotal: 0,
    paymentTotal: 0,
    cashPaymentTotal: 0,
    cardPaymentTotal: 0,
    qpayPaymentTotal: 0,
    otherPaymentTotal: 0,
    roomChargeTotal: 0,
    currentSalePaymentTotal: 0,
    priorDebtCollectedTotal: 0,
    refundTotal: 0,
    newRoomDebtTotal: 0,
    expectedCash: startingCash,
    receiptCount: 0,
    firstReceiptId: '',
    lastReceiptId: '',
  };

  const paymentTotals = getPaymentTotals(paymentRows);
  const saleDates = new Map(
    salesRows.map(row => [
      getCell(row, 'transaction_id'),
      getCell(row, 'business_date') || businessDateFromTimestamp(row.get('timestamp')),
    ]),
  );

  for (const row of daySalesRows) {
    if (getCell(row, 'paid_status').toLowerCase() === 'voided') continue;

    const total = toNumber(row.get('total'));
    totals.salesTotal += total;

    if (getCell(row, 'paid_status').toLowerCase() === 'unpaid') {
      const transactionId = getCell(row, 'transaction_id');
      totals.roomChargeTotal += Math.max(total - (paymentTotals.get(transactionId) ?? 0), 0);
    }
  }
  totals.newRoomDebtTotal = totals.roomChargeTotal;

  for (const row of dayPaymentRows) {
    const amount = toNumber(row.get('amount'));
    totals.paymentTotal += amount;

    if (amount < 0) {
      totals.refundTotal += Math.abs(amount);
    } else {
      const saleDate = saleDates.get(getCell(row, 'transaction_id')) ?? '';
      if (saleDate === businessDate) totals.currentSalePaymentTotal += amount;
      else totals.priorDebtCollectedTotal += amount;
    }

    const methodType = classifyPaymentMethod(getCell(row, 'payment_method'));
    if (methodType === 'cash') totals.cashPaymentTotal += amount;
    else if (methodType === 'card') totals.cardPaymentTotal += amount;
    else if (methodType === 'qpay') totals.qpayPaymentTotal += amount;
    else totals.otherPaymentTotal += amount;
  }

  const receiptIds = Array.from(
    new Set(
      dayPaymentRows
        .map(row => getCell(row, 'receipt_id'))
        .filter(Boolean),
    ),
  );
  totals.receiptCount = receiptIds.length;
  totals.firstReceiptId = receiptIds[0] ?? '';
  totals.lastReceiptId = receiptIds.at(-1) ?? '';

  totals.expectedCash = startingCash + totals.cashPaymentTotal;
  return totals;
}

function parseItemSummary(summary: string) {
  const items: DayItemTotal[] = [];
  const pattern = /(.+?)\s+x(\d+(?:\.\d+)?)(?:,\s*|$)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(summary)) !== null) {
    const name = match[1]?.trim();
    const quantity = Number(match[2]);

    if (name && Number.isFinite(quantity) && quantity > 0) {
      items.push({ name, quantity });
    }
  }

  return items;
}

function getDayItemTotals(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  orderItemRows: Array<{ get: (columnName: string) => unknown }> = [],
) {
  const totals = new Map<string, number>();
  const daySalesRows = getDaySalesRows(salesRows, businessDate).filter(
    row => getCell(row, 'paid_status').toLowerCase() !== 'voided',
  );
  const dayTransactionIds = new Set(
    daySalesRows.map(row => getCell(row, 'transaction_id')).filter(Boolean),
  );
  const latestRevision = new Map<string, string>();
  for (const row of orderItemRows) {
    const transactionId = getCell(row, 'transaction_id');
    const revisionId = getCell(row, 'revision_id');
    if (dayTransactionIds.has(transactionId) && revisionId) {
      latestRevision.set(transactionId, revisionId);
    }
  }
  const normalizedTransactions = new Set<string>();
  for (const row of orderItemRows) {
    const transactionId = getCell(row, 'transaction_id');
    if (
      !dayTransactionIds.has(transactionId) ||
      getCell(row, 'revision_id') !== latestRevision.get(transactionId)
    ) {
      continue;
    }
    const name = getCell(row, 'item_name');
    const quantity = toNumber(row.get('quantity'));
    if (!name || quantity <= 0) continue;
    normalizedTransactions.add(transactionId);
    totals.set(name, (totals.get(name) ?? 0) + quantity);
  }

  for (const row of daySalesRows) {
    if (normalizedTransactions.has(getCell(row, 'transaction_id'))) continue;

    for (const item of parseItemSummary(getCell(row, 'item_summary'))) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.quantity);
    }
  }

  return Array.from(totals.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((first, second) => second.quantity - first.quantity || first.name.localeCompare(second.name));
}

function getDayMetrics(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  paymentRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  sessionRow: SheetRow | null,
  orderItemRows: Array<{ get: (columnName: string) => unknown }> = [],
) {
  const startingCash = sessionRow ? toNumber(sessionRow.get('starting_cash')) : 0;

  return {
    totals: getDayTotals(
      salesRows,
      paymentRows,
      businessDate,
      startingCash,
    ),
    itemTotals: getDayItemTotals(
      salesRows,
      businessDate,
      orderItemRows,
    ),
  };
}

function dayErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (/429|quota|rate limit/i.test(message)) {
    return 'Google Sheets хүсэлтийн хязгаарт хүрсэн. 60 секунд хүлээгээд дахин оролдоно уу.';
  }

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

async function getDayContext(businessDate: string) {
  const doc = await loadSpreadsheet();
  const daySheet = await getOrCreateSheet(
    doc,
    DAY_SESSION_SHEET_TITLES,
    DAY_SESSION_HEADERS,
  );
  const salesLogSheet = await getOrCreateSheet(
    doc,
    SALES_LOG_SHEET_TITLES,
    SALES_LOG_HEADERS,
  );
  const paymentsLogSheet = await getOrCreateSheet(
    doc,
    PAYMENTS_LOG_SHEET_TITLES,
    PAYMENT_LOG_HEADERS,
  );
  const orderItemsSheet = findExistingSheet(doc, ORDER_ITEMS_SHEET_TITLES);
  const [dayRows, salesRows, paymentRows, orderItemRows] = await Promise.all([
    daySheet.getRows() as Promise<SheetRow[]>,
    salesLogSheet.getRows(),
    paymentsLogSheet.getRows(),
    orderItemsSheet ? orderItemsSheet.getRows() : Promise.resolve([]),
  ]);
  const sessionRow = getLatestSession(dayRows, businessDate);
  const { totals, itemTotals } = getDayMetrics(
    salesRows,
    paymentRows,
    businessDate,
    sessionRow,
    orderItemRows,
  );

  return {
    daySheet,
    dayRows,
    salesRows,
    paymentRows,
    orderItemRows,
    sessionRow,
    totals,
    itemTotals,
  };
}

async function handleGET(request: Request) {
  try {
    const sessionOrResponse = requireApiSession(request, 'waiter');
    if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
    const url = new URL(request.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get('businessDate'));
    const sessionOnly = url.searchParams.get('sessionOnly') === '1';

    if (sessionOnly || sessionOrResponse.role === 'waiter') {
      const loadDaySessionPayload = async () => {
        const { sessionRow } = await getDaySessionReadContext(businessDate);

        return {
          businessDate,
          session: serializeSession(sessionRow),
        };
      };
      const payload = await getCachedRead(
        `day:session:${businessDate}`,
        DAY_SESSION_READ_CACHE_TTL_MS,
        loadDaySessionPayload,
      );

      return NextResponse.json(payload);
    }

    const loadDayPayload = async () => {
      const {
        dayRows,
        sessionRow,
        totals,
        itemTotals,
      } = await getDayReadContext(businessDate);

      return {
        businessDate,
        session: serializeSession(sessionRow),
        totals,
        itemTotals,
        closeHistory: getClosedSessionHistory(dayRows),
      };
    };
    const payload =
      url.searchParams.get('fresh') === '1'
        ? await loadDayPayload()
        : await getCachedRead(
            `day:${businessDate}`,
            DAY_READ_CACHE_TTL_MS,
            loadDayPayload,
          );
    after(() =>
      mergeManagementBoardSectionSafely(businessDate, 'day', payload),
    );

    return NextResponse.json(payload);
  } catch (error) {
    console.error(`Day GET Error: ${error instanceof Error ? error.message : String(error)}`);
    const rateLimited = /429|quota|rate limit/i.test(
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: dayErrorMessage(error, 'Failed to fetch day status') },
      {
        status: rateLimited ? 429 : 500,
        headers: rateLimited ? { 'Retry-After': '60' } : undefined,
      },
    );
  }
}

async function handlePOST(request: Request) {
  try {
    const body = (await request.json()) as DayPostBody;
    const action = body.action;
    const requestedBusinessDate = normalizeBusinessDate(body.businessDate);
    const clientRequestId = body.clientRequestId?.trim() ?? '';

    if (action !== 'open' && action !== 'close') {
      return NextResponse.json({ error: 'action must be open or close' }, { status: 400 });
    }
    if (!clientRequestId || clientRequestId.length > 128) {
      return NextResponse.json(
        { error: 'clientRequestId is required and must be 128 characters or less' },
        { status: 400 },
      );
    }

    const sessionOrResponse = requireApiSession(
      request,
      action === 'close' ? 'manager' : 'cashier',
    );
    if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
    const actorName = sessionOrResponse.displayName;

    const {
      daySheet,
      dayRows,
      salesRows,
      paymentRows,
      orderItemRows,
    } = await getDayContext(requestedBusinessDate);
    const completedRequestRow = dayRows.find(
      row =>
        getCell(row, 'client_request_id') === clientRequestId &&
        getCell(row, 'operation_status') === 'complete',
    );
    if (completedRequestRow) {
      const completedBusinessDate = getSessionBusinessDate(completedRequestRow);
      const completedMetrics = getDayMetrics(
        salesRows,
        paymentRows,
        completedBusinessDate,
        completedRequestRow,
        orderItemRows,
      );
      return NextResponse.json({
        success: true,
        duplicateRequest: true,
        message: action === 'close' ? 'Day closed' : 'Day opened',
        businessDate: completedBusinessDate,
        activeBusinessDate:
          getCell(completedRequestRow, 'status').toLowerCase() === 'open'
            ? completedBusinessDate
            : todayBusinessDate(),
        session: serializeSession(completedRequestRow),
        totals: completedMetrics.totals,
        itemTotals: completedMetrics.itemTotals,
      });
    }
    const activeSession = getActiveSession(dayRows);
    const businessDate = activeSession
      ? getSessionBusinessDate(activeSession)
      : todayBusinessDate();
    const sessionRow = activeSession ?? getLatestSession(dayRows, businessDate);
    const { totals, itemTotals } = getDayMetrics(
      salesRows,
      paymentRows,
      businessDate,
      sessionRow,
      orderItemRows,
    );
    const timestamp = nowTimestamp();

    if (action === 'open') {
      if (activeSession) {
        const staleResponse = staleBusinessDayResponse(businessDate);
        if (staleResponse) return staleResponse;
        const storedSessionId = getCell(activeSession, 'session_id');
        if (
          storedSessionId &&
          !/^SES-\d{8}-\d{6}$/.test(storedSessionId)
        ) {
          activeSession.set(
            'session_id',
            makeUniformSessionNumber(
              activeSession.rowNumber ?? 0,
              businessDate,
            ),
          );
          await activeSession.save();
        }
        return NextResponse.json({
          success: true,
          message: 'Day is already open',
          businessDate,
          activeBusinessDate: businessDate,
          session: serializeSession(activeSession),
          totals,
          itemTotals,
        });
      }

      if (sessionRow && getCell(sessionRow, 'status').toLowerCase() === 'closed') {
        return NextResponse.json(
          {
            error: `${businessDate} is already closed and cannot be opened again`,
            businessDate,
            activeBusinessDate: todayBusinessDate(),
            session: serializeSession(sessionRow),
          },
          { status: 409 },
        );
      }

      const startingCash = Number(body.startingCash ?? 0);
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        return NextResponse.json(
          { error: 'startingCash must be zero or greater' },
          { status: 400 },
        );
      }

      const shouldBackdateOpening =
        !sessionRow &&
        (totals.salesTotal > 0 ||
          totals.paymentTotal > 0 ||
          itemTotals.length > 0);
      const openedAt = shouldBackdateOpening
        ? startOfBusinessDateTimestamp(businessDate)
        : timestamp;

      const [newRow] = await daySheet.addRows([
        {
          business_date: businessDate,
          opened_at: openedAt,
          opened_by: actorName,
          starting_cash: startingCash,
          status: 'open',
          closed_at: '',
          closed_by: '',
          counted_cash: '',
          expected_cash: startingCash,
          cash_difference: '',
          payment_total: 0,
          cash_payment_total: 0,
          card_payment_total: 0,
          qpay_payment_total: 0,
          other_payment_total: 0,
          room_charge_total: 0,
          sales_total: 0,
          notes: body.notes || '',
          session_id: makeUniformControlNumber('SES'),
          receipt_count: 0,
          first_receipt_id: '',
          last_receipt_id: '',
          current_sale_payment_total: 0,
          prior_debt_collected_total: 0,
          refund_total: 0,
          new_room_debt_total: 0,
          client_request_id: clientRequestId,
          operation_status: 'complete',
          operation_error: '',
          operation_updated_at: new Date().toISOString(),
        },
      ]);
      clearCachedReads('day:');
      clearCachedReads('sales:');
      clearCachedReads('business-date:');

      return NextResponse.json({
        success: true,
        message: 'Day opened',
        businessDate,
        activeBusinessDate: businessDate,
        session: serializeSession(newRow as SheetRow),
        totals: getDayTotals([], [], businessDate, startingCash),
        itemTotals: [],
      });
    }

    if (!activeSession) {
      return NextResponse.json(
        { error: 'Open the day before closing it' },
        { status: 400 },
      );
    }

    const countedCash = Number(body.countedCash ?? 0);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      return NextResponse.json(
        { error: 'countedCash must be zero or greater' },
        { status: 400 },
      );
    }

    const cashDifference = countedCash - totals.expectedCash;
    activeSession.set('status', 'closed');
    activeSession.set('closed_at', timestamp);
    activeSession.set('closed_by', actorName);
    activeSession.set('counted_cash', countedCash);
    activeSession.set('expected_cash', totals.expectedCash);
    activeSession.set('cash_difference', cashDifference);
    activeSession.set('payment_total', totals.paymentTotal);
    activeSession.set('cash_payment_total', totals.cashPaymentTotal);
    activeSession.set('card_payment_total', totals.cardPaymentTotal);
    activeSession.set('qpay_payment_total', totals.qpayPaymentTotal);
    activeSession.set('other_payment_total', totals.otherPaymentTotal);
    activeSession.set('room_charge_total', totals.roomChargeTotal);
    activeSession.set('sales_total', totals.salesTotal);
    activeSession.set('receipt_count', totals.receiptCount);
    activeSession.set('first_receipt_id', totals.firstReceiptId);
    activeSession.set('last_receipt_id', totals.lastReceiptId);
    activeSession.set('current_sale_payment_total', totals.currentSalePaymentTotal);
    activeSession.set('prior_debt_collected_total', totals.priorDebtCollectedTotal);
    activeSession.set('refund_total', totals.refundTotal);
    activeSession.set('new_room_debt_total', totals.newRoomDebtTotal);
    activeSession.set('client_request_id', clientRequestId);
    activeSession.set('operation_status', 'complete');
    activeSession.set('operation_error', '');
    activeSession.set('operation_updated_at', new Date().toISOString());
    activeSession.set('notes', body.notes || '');
    await activeSession.save();
    clearCachedReads('day:');
    clearCachedReads('sales:');
    clearCachedReads('business-date:');

    return NextResponse.json({
      success: true,
      message: 'Day closed',
      businessDate,
      activeBusinessDate: todayBusinessDate(),
      session: serializeSession(activeSession),
      totals: {
        ...totals,
        expectedCash: totals.expectedCash,
      },
      itemTotals,
    });
  } catch (error) {
    console.error(`Day POST Error: ${error instanceof Error ? error.message : String(error)}`);
    const rateLimited = /429|quota|rate limit/i.test(
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: dayErrorMessage(error, 'Failed to save day status') },
      {
        status: rateLimited ? 429 : 500,
        headers: rateLimited ? { 'Retry-After': '60' } : undefined,
      },
    );
  }
}

export const GET = withProtectedApiRoute('/api/day', 'waiter', handleGET);
export const POST = withProtectedApiRoute('/api/day', 'cashier', handlePOST);

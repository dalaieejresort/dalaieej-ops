import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

type DayAction = 'open' | 'close';

type DayPostBody = {
  action?: DayAction;
  businessDate?: string;
  staffName?: string;
  startingCash?: number;
  countedCash?: number;
  notes?: string;
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
};

type DayTotals = {
  salesTotal: number;
  paymentTotal: number;
  cashPaymentTotal: number;
  cardPaymentTotal: number;
  qpayPaymentTotal: number;
  otherPaymentTotal: number;
  roomChargeTotal: number;
  expectedCash: number;
};

type DayItemTotal = {
  name: string;
  quantity: number;
};

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

const DAY_SESSION_HEADERS = [
  'business_date',
  'opened_at',
  'opened_by',
  'starting_cash',
  'status',
  'closed_at',
  'closed_by',
  'counted_cash',
  'expected_cash',
  'cash_difference',
  'payment_total',
  'cash_payment_total',
  'card_payment_total',
  'qpay_payment_total',
  'other_payment_total',
  'room_charge_total',
  'sales_total',
  'notes',
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
];

const PAYMENTS_LOG_HEADERS = [
  'payment_id',
  'transaction_id',
  'timestamp',
  'staff',
  'payment_method',
  'amount',
  'cash_received',
  'change_due',
  'qpay_invoice_id',
  'notes',
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
  const doc = createDoc();
  await doc.loadInfo();
  return doc;
}

async function getOrCreateSheet(
  doc: SheetDoc,
  titles: string[],
  headers: string[],
) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return doc.addSheet({
    title: titles[0] ?? 'Sheet',
    headerValues: headers,
  });
}

function nowTimestamp() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
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
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s*(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i,
  );

  if (match) {
    const [, month, day, year, hour, minute, second, meridiem] = match;
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
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function isInsideSessionWindow(
  timestamp: unknown,
  openedAt?: string,
  closedAt?: string,
) {
  if (!openedAt && !closedAt) return true;

  const rowMs = timestampMs(timestamp);
  const openedMs = openedAt ? timestampMs(openedAt) : null;
  const closedMs = closedAt ? timestampMs(closedAt) : null;

  if (rowMs === null) return false;
  if (openedMs !== null && rowMs < openedMs) return false;
  if (closedMs !== null && rowMs > closedMs) return false;

  return true;
}

function classifyPaymentMethod(method: string) {
  const normalized = method.toLowerCase();

  if (normalized.includes('qpay')) return 'qpay';
  if (normalized.includes('карт') || normalized.includes('card')) return 'card';
  if (normalized.includes('бэлэн') || normalized.includes('cash')) return 'cash';

  return 'other';
}

function getLatestSession(rows: SheetRow[], businessDate: string) {
  return rows
    .filter(row => getCell(row, 'business_date') === businessDate)
    .at(-1) ?? null;
}

function serializeSession(row: SheetRow | null) {
  if (!row) return null;

  return {
    businessDate: getCell(row, 'business_date'),
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
  };
}

function getDaySalesRows(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  sessionWindow?: { openedAt?: string; closedAt?: string },
) {
  return salesRows.filter(
    row =>
      businessDateFromTimestamp(row.get('timestamp')) === businessDate &&
      isInsideSessionWindow(
        row.get('timestamp'),
        sessionWindow?.openedAt,
        sessionWindow?.closedAt,
      ),
  );
}

function getDayPaymentRows(
  paymentRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  sessionWindow?: { openedAt?: string; closedAt?: string },
) {
  const dayPaymentRows = paymentRows.filter(
    row =>
      businessDateFromTimestamp(row.get('timestamp')) === businessDate &&
      isInsideSessionWindow(
        row.get('timestamp'),
        sessionWindow?.openedAt,
        sessionWindow?.closedAt,
      ),
  );

  return dayPaymentRows;
}

function getDayTotals(
  salesRows: Array<{ get: (columnName: string) => unknown }>,
  paymentRows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
  startingCash: number,
  sessionWindow?: { openedAt?: string; closedAt?: string },
): DayTotals {
  const daySalesRows = getDaySalesRows(salesRows, businessDate, sessionWindow);
  const dayPaymentRows = getDayPaymentRows(paymentRows, businessDate, sessionWindow);
  const totals: DayTotals = {
    salesTotal: 0,
    paymentTotal: 0,
    cashPaymentTotal: 0,
    cardPaymentTotal: 0,
    qpayPaymentTotal: 0,
    otherPaymentTotal: 0,
    roomChargeTotal: 0,
    expectedCash: startingCash,
  };

  for (const row of daySalesRows) {
    if (getCell(row, 'paid_status').toLowerCase() === 'voided') continue;

    const total = toNumber(row.get('total'));
    totals.salesTotal += total;

    if (getCell(row, 'paid_status').toLowerCase() === 'unpaid') {
      totals.roomChargeTotal += total;
    }
  }

  for (const row of dayPaymentRows) {
    const amount = toNumber(row.get('amount'));
    totals.paymentTotal += amount;

    const methodType = classifyPaymentMethod(getCell(row, 'payment_method'));
    if (methodType === 'cash') totals.cashPaymentTotal += amount;
    else if (methodType === 'card') totals.cardPaymentTotal += amount;
    else if (methodType === 'qpay') totals.qpayPaymentTotal += amount;
    else totals.otherPaymentTotal += amount;
  }

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
  sessionWindow?: { openedAt?: string; closedAt?: string },
) {
  const totals = new Map<string, number>();
  const daySalesRows = getDaySalesRows(salesRows, businessDate, sessionWindow);

  for (const row of daySalesRows) {
    if (getCell(row, 'paid_status').toLowerCase() === 'voided') continue;

    for (const item of parseItemSummary(getCell(row, 'item_summary'))) {
      totals.set(item.name, (totals.get(item.name) ?? 0) + item.quantity);
    }
  }

  return Array.from(totals.entries())
    .map(([name, quantity]) => ({ name, quantity }))
    .sort((first, second) => second.quantity - first.quantity || first.name.localeCompare(second.name));
}

function dayErrorMessage(error: unknown, fallback: string) {
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
    PAYMENTS_LOG_HEADERS,
  );
  const [dayRows, salesRows, paymentRows] = await Promise.all([
    daySheet.getRows() as Promise<SheetRow[]>,
    salesLogSheet.getRows(),
    paymentsLogSheet.getRows(),
  ]);
  const sessionRow = getLatestSession(dayRows, businessDate);
  const startingCash = sessionRow ? toNumber(sessionRow.get('starting_cash')) : 0;
  const sessionWindow = {
    openedAt: sessionRow ? getCell(sessionRow, 'opened_at') : undefined,
    closedAt: sessionRow ? getCell(sessionRow, 'closed_at') : undefined,
  };
  const totals = getDayTotals(
    salesRows,
    paymentRows,
    businessDate,
    startingCash,
    sessionWindow,
  );
  const itemTotals = getDayItemTotals(salesRows, businessDate, sessionWindow);

  return { daySheet, dayRows, sessionRow, totals, itemTotals };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get('businessDate'));
    const { sessionRow, totals, itemTotals } = await getDayContext(businessDate);

    return NextResponse.json({
      businessDate,
      session: serializeSession(sessionRow),
      totals,
      itemTotals,
    });
  } catch (error) {
    console.error(`Day GET Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: dayErrorMessage(error, 'Failed to fetch day status') },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as DayPostBody;
    const action = body.action;
    const businessDate = normalizeBusinessDate(body.businessDate);

    if (action !== 'open' && action !== 'close') {
      return NextResponse.json({ error: 'action must be open or close' }, { status: 400 });
    }

    const { daySheet, sessionRow, totals, itemTotals } = await getDayContext(businessDate);
    const timestamp = nowTimestamp();

    if (action === 'open') {
      if (sessionRow && getCell(sessionRow, 'status').toLowerCase() === 'open') {
        return NextResponse.json({
          success: true,
          message: 'Day is already open',
          businessDate,
          session: serializeSession(sessionRow),
          totals,
          itemTotals,
        });
      }

      const startingCash = Number(body.startingCash ?? 0);
      if (!Number.isFinite(startingCash) || startingCash < 0) {
        return NextResponse.json(
          { error: 'startingCash must be zero or greater' },
          { status: 400 },
        );
      }

      const [newRow] = await daySheet.addRows([
        [
          businessDate,
          timestamp,
          body.staffName || 'Staff',
          startingCash,
          'open',
          '',
          '',
          '',
          startingCash,
          '',
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          body.notes || '',
        ],
      ]);

      return NextResponse.json({
        success: true,
        message: 'Day opened',
        businessDate,
        session: serializeSession(newRow as SheetRow),
        totals: getDayTotals([], [], businessDate, startingCash),
        itemTotals: [],
      });
    }

    if (!sessionRow || getCell(sessionRow, 'status').toLowerCase() !== 'open') {
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
    sessionRow.set('status', 'closed');
    sessionRow.set('closed_at', timestamp);
    sessionRow.set('closed_by', body.staffName || 'Staff');
    sessionRow.set('counted_cash', countedCash);
    sessionRow.set('expected_cash', totals.expectedCash);
    sessionRow.set('cash_difference', cashDifference);
    sessionRow.set('payment_total', totals.paymentTotal);
    sessionRow.set('cash_payment_total', totals.cashPaymentTotal);
    sessionRow.set('card_payment_total', totals.cardPaymentTotal);
    sessionRow.set('qpay_payment_total', totals.qpayPaymentTotal);
    sessionRow.set('other_payment_total', totals.otherPaymentTotal);
    sessionRow.set('room_charge_total', totals.roomChargeTotal);
    sessionRow.set('sales_total', totals.salesTotal);
    sessionRow.set('notes', body.notes || '');
    await sessionRow.save();

    return NextResponse.json({
      success: true,
      message: 'Day closed',
      businessDate,
      session: serializeSession(sessionRow),
      totals: {
        ...totals,
        expectedCash: totals.expectedCash,
      },
      itemTotals,
    });
  } catch (error) {
    console.error(`Day POST Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: dayErrorMessage(error, 'Failed to save day status') },
      { status: 500 },
    );
  }
}

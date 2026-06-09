import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

type VoidSaleBody = {
  transactionId?: string;
  businessDate?: string;
  staffName?: string;
  reason?: string;
  refundMethod?: string;
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
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
];

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

function createPaymentId() {
  return `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
}

function createVoidId() {
  return `VOID-${Math.floor(100000 + Math.random() * 900000)}`;
}

function getLatestSession(rows: SheetRow[], businessDate: string) {
  return rows
    .filter(row => getCell(row, 'business_date') === businessDate)
    .at(-1) ?? null;
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

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const businessDate = normalizeBusinessDate(url.searchParams.get('businessDate'));
    const doc = await loadSpreadsheet();
    const salesLogSheet = await getOrCreateSheet(doc, SALES_LOG_SHEET_TITLES, SALES_LOG_HEADERS);
    const paymentsLogSheet = await getOrCreateSheet(
      doc,
      PAYMENTS_LOG_SHEET_TITLES,
      PAYMENTS_LOG_HEADERS,
    );
    const [salesRows, paymentRows] = await Promise.all([
      salesLogSheet.getRows() as Promise<SheetRow[]>,
      paymentsLogSheet.getRows(),
    ]);
    const paymentTotals = getPaymentTotals(paymentRows);
    const sales = salesRows
      .filter(row => businessDateFromTimestamp(row.get('timestamp')) === businessDate)
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as VoidSaleBody;
    const transactionId = body.transactionId?.trim();
    const businessDate = normalizeBusinessDate(body.businessDate);
    const reason = body.reason?.trim();
    const refundMethod = body.refundMethod?.trim() || 'No refund';

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    if (!reason) {
      return NextResponse.json({ error: 'reason is required' }, { status: 400 });
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
      PAYMENTS_LOG_HEADERS,
    );
    const voidsLogSheet = await getOrCreateSheet(doc, VOIDS_LOG_SHEET_TITLES, VOIDS_LOG_HEADERS);
    const [dayRows, inventoryRows, salesRows, paymentRows] = await Promise.all([
      daySessionSheet.getRows() as Promise<SheetRow[]>,
      inventoryLogSheet.getRows(),
      salesLogSheet.getRows() as Promise<SheetRow[]>,
      paymentsLogSheet.getRows(),
    ]);
    const activeDaySession = getLatestSession(dayRows, businessDate);
    if (!activeDaySession || getCell(activeDaySession, 'status').toLowerCase() !== 'open') {
      return NextResponse.json(
        { error: 'Open the day before voiding or refunding a sale' },
        { status: 400 },
      );
    }

    const saleRow = salesRows.find(row => getCell(row, 'transaction_id') === transactionId);

    if (!saleRow) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    const originalStatus = getCell(saleRow, 'paid_status').toLowerCase();
    if (originalStatus === 'voided') {
      return NextResponse.json({ error: 'Sale is already voided' }, { status: 400 });
    }

    const timestamp = nowTimestamp();
    const originalTotal = toNumber(saleRow.get('total'));
    const paidAmount = getPaymentTotals(paymentRows).get(transactionId) ?? 0;
    const refundAmount = Math.max(paidAmount, 0);
    const itemSummary = getCell(saleRow, 'item_summary');
    const voidId = createVoidId();
    const matchingInventoryRows = inventoryRows.filter(
      row =>
        String(getFirstValue(row, INVENTORY_COLUMNS.transactionId)).trim() === transactionId &&
        String(getFirstValue(row, INVENTORY_COLUMNS.type)).trim() !== 'Буцаалт',
    );
    const reversalRows: Array<Array<string | number>> = matchingInventoryRows.map(row => [
      `${transactionId}-VOID`,
      timestamp,
      String(getFirstValue(row, INVENTORY_COLUMNS.sku)),
      String(getFirstValue(row, INVENTORY_COLUMNS.name)),
      'Буцаалт',
      toNumber(getFirstValue(row, INVENTORY_COLUMNS.quantity)),
      String(getFirstValue(row, INVENTORY_COLUMNS.location) || 'Front Desk'),
      body.staffName || 'Staff',
    ]);

    await Promise.all([
      voidsLogSheet.addRows([
        [
          voidId,
          transactionId,
          timestamp,
          body.staffName || 'Staff',
          reason,
          originalStatus || 'paid',
          originalTotal,
          refundAmount > 0 ? refundMethod : 'No refund',
          refundAmount,
          itemSummary,
          '',
        ],
      ]),
      reversalRows.length > 0
        ? inventoryLogSheet.addRows(reversalRows)
        : Promise.resolve(),
      refundAmount > 0
        ? paymentsLogSheet.addRows([
            [
              createPaymentId(),
              transactionId,
              timestamp,
              body.staffName || 'Staff',
              `Буцаалт - ${refundMethod}`,
              -refundAmount,
              '',
              '',
              getCell(saleRow, 'qpay_invoice_id'),
              `Void ${voidId}: ${reason}`,
            ],
          ])
        : Promise.resolve(),
    ]);

    saleRow.set('paid_status', 'voided');
    saleRow.set(
      'notes',
      [getCell(saleRow, 'notes'), `Voided ${timestamp}: ${reason}`]
        .filter(Boolean)
        .join(' | '),
    );
    await saleRow.save();

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

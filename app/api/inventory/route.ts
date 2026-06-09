import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

type InventoryPostBody = {
  items?: Array<{
    sku?: string;
    name?: string;
    qty?: number;
    unitPrice?: number;
  }>;
  method?: string;
  room?: string;
  staffName?: string;
  paidStatus?: string;
  total?: number;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
};

type SheetDoc = GoogleSpreadsheet;

const CATALOG_SHEET_TITLES = [
  process.env.GOOGLE_CATALOG_SHEET_TITLE,
  'Inventory_Catalog',
  'inventory_catalogue',
  'inventory_catalog',
  'Inventory_Catalogue',
].filter(Boolean) as string[];

const LOG_SHEET_TITLES = [
  process.env.GOOGLE_LOG_SHEET_TITLE,
  'Inventory_Log',
  'inventory_log',
].filter(Boolean) as string[];

const SALES_LOG_SHEET_TITLES = [
  process.env.GOOGLE_SALES_SHEET_TITLE,
  'Sales_Log',
  'sales_log',
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
];

const CATALOG_COLUMNS = {
  sku: ['sku', 'SKU', 'SKU (Барааны код)', 'Барааны код'],
  name: [
    'name',
    'item_name',
    'Item Name',
    'Item Name (Барааны нэр)',
    'Барааны нэр',
  ],
  price: [
    'price',
    'unit_cost',
    'Unit Cost',
    'Unit Cost (Нэгж үнэ ₮)',
    'Нэгж үнэ ₮',
  ],
  stock: [
    'stock',
    'current_stock',
    'Current Stock',
    'Current Stock (Үлдэгдэл)',
    'Үлдэгдэл',
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
  // Vercel and local env files may store the PEM with either real newlines or
  // escaped "\n" sequences. Normalize both shapes before passing it to Google.
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

function findSheet(doc: SheetDoc, titles: string[], purpose: string) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  throw new Error(
    `Missing ${purpose} sheet. Tried: ${titles.join(', ')}. Available: ${Object.keys(doc.sheetsByTitle).join(', ')}`,
  );
}

async function getOrCreateSalesLogSheet(doc: SheetDoc) {
  for (const title of SALES_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return doc.addSheet({
    title: SALES_LOG_SHEET_TITLES[0] ?? 'Sales_Log',
    headerValues: SALES_LOG_HEADERS,
  });
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

function toNumber(value: unknown) {
  const cleaned = String(value ?? '').replace(/[₮,\s]/g, '');
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function inventoryErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Google Sheets API has not been used') ||
    message.includes('sheets.googleapis.com') ||
    message.includes('PERMISSION_DENIED')
  ) {
    return 'Google Sheets API is disabled for this Google Cloud project. Enable the Google Sheets API, then retry.';
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

  if (message.includes('Missing inventory')) {
    return message;
  }

  return fallback;
}

function logInventoryError(label: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${label}: ${message}`);
}

// ==========================================
// GET: Fetch the Catalog for the iPad Screen
// ==========================================
export async function GET() {
  try {
    const doc = await loadSpreadsheet();
    const catalogSheet = findSheet(doc, CATALOG_SHEET_TITLES, 'inventory catalogue');
    const rows = await catalogSheet.getRows();

    // Clean up the Google Sheets data into a simple JSON array for your React frontend
    const products = rows.map(row => ({
      sku: String(getFirstValue(row, CATALOG_COLUMNS.sku)),
      name: String(getFirstValue(row, CATALOG_COLUMNS.name)),
      price: toNumber(getFirstValue(row, CATALOG_COLUMNS.price)),
      stock: toNumber(getFirstValue(row, CATALOG_COLUMNS.stock)),
    }));

    // Filter out any empty rows just in case
    const validProducts = products.filter(p => p.sku);

    return NextResponse.json(validProducts);
  } catch (error) {
    logInventoryError('Inventory GET Error', error);
    return NextResponse.json(
      { error: inventoryErrorMessage(error, 'Failed to fetch catalog') },
      { status: 500 },
    );
  }
}

// ==========================================
// POST: Push confirmed orders to the Ledger
// ==========================================
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InventoryPostBody;
    const {
      items,
      method,
      room,
      staffName,
      paidStatus,
      total,
      cashReceived,
      changeDue,
      qpayInvoiceId,
    } = body;
    if (!items?.length) {
      return NextResponse.json({ error: 'No items to log' }, { status: 400 });
    }

    const doc = await loadSpreadsheet();
    const logSheet = findSheet(doc, LOG_SHEET_TITLES, 'inventory log');
    const salesLogSheet = await getOrCreateSalesLogSheet(doc);

    // Lock the timestamp to Ulaanbaatar time regardless of where Vercel's servers are
    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
    const transactionId = `TXN-${Math.floor(100000 + Math.random() * 900000)}`;
    const saleSubtotal = items.reduce(
      (sum, item) => sum + (item.unitPrice ?? 0) * (item.qty ?? 1),
      0,
    );
    const saleTotal = total ?? saleSubtotal;
    const itemSummary = items
      .map(item => `${item.name ?? item.sku ?? 'Item'} x${item.qty ?? 1}`)
      .join(', ');

    // Map every item in the shopping cart to its own row for the log
    const newRows = items.map(item => {
      // Using an array guarantees the data perfectly matches your 10 columns 
      // from left to right, ignoring header typos.
      return [
        transactionId,             // A: Transaction ID
        timestamp,                 // B: Timestamp
        item.sku ?? '',            // C: SKU
        item.name ?? '',           // D: Item Description
        'Зарлага',                 // E: Type (Strictly Outflow for POS sales)
        item.qty ?? 1,             // F: Quantity
        'Front Desk',              // G: Location (Can be dynamic later)
        staffName || 'Staff',      // H: Handled By
        method || '',              // I: Payment Method (Qpay/Card/Cash/Room)
        room || ''                 // J: Room Number (If applicable)
      ];
    });

    const salesRow = [
      transactionId,
      timestamp,
      staffName || 'Staff',
      method || '',
      paidStatus || 'paid',
      room || '',
      saleSubtotal,
      0,
      saleTotal,
      cashReceived ?? '',
      changeDue ?? '',
      items.reduce((sum, item) => sum + (item.qty ?? 1), 0),
      itemSummary,
      qpayInvoiceId || '',
      '',
    ];

    // Fire the data into Google Sheets
    await Promise.all([
      logSheet.addRows(newRows),
      salesLogSheet.addRows([salesRow]),
    ]);

    return NextResponse.json({
      success: true,
      message: `Logged ${newRows.length} items and 1 sale.`,
      transactionId,
    });
  } catch (error) {
    logInventoryError('Inventory POST Error', error);
    return NextResponse.json(
      { error: inventoryErrorMessage(error, 'Failed to log transaction') },
      { status: 500 },
    );
  }
}

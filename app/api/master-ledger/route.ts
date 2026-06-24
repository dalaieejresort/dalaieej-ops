import { createHash } from 'node:crypto';
import { GoogleSpreadsheet, type GoogleSpreadsheetRow } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

type SheetDoc = GoogleSpreadsheet;
type SheetRow = GoogleSpreadsheetRow<Record<string, string | number | boolean>>;

type MasterLedgerPostBody = {
  dryRun?: boolean;
};

const MASTER_LEDGER_SHEET_TITLES = [
  process.env.GOOGLE_MASTER_LEDGER_SHEET_TITLE,
  'Master_Ledger',
  'Master Ledger',
].filter(Boolean) as string[];

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

const MASTER_LEDGER_COLUMNS = {
  date: ['Огноо (Transaction Date)', 'Огноо (Date)', 'Date'],
  bank: ['Банк (Bank)', 'Bank'],
  paidVia: ['Данс (Paid Via)', 'Paid Via'],
  supplier: ['Нийлүүлэгч (Supplier)', 'Supplier'],
  description: ['Гүйлгээний утга (Description)', 'Гүйлгээний утга (Item)', 'Description'],
  category: ['Ангилал (Category)', 'Category'],
  wing: ['Салбар (Wing)', 'Wing'],
  quantity: ['Тоо ширхэг (Qty)', 'Qty', 'Quantity'],
  amount: ['Дүн ₮', 'Дүн ₮ (Amount)', 'Amount'],
};

const CATALOG_COLUMNS = {
  sku: ['SKU (Барааны код)', 'sku', 'SKU', 'Барааны код'],
  name: ['Item Name (Барааны нэр)', 'name', 'Item Name', 'Барааны нэр'],
  category: ['Category (Ангилал)', 'category', 'Category', 'Ангилал'],
  employeePrice: ['Employee Price (Ажчилчдын үнэ)', 'Employee Price (Ажилчдын үнэ)'],
  guestPrice: ['Guest Price (Амрагчдын үнэ)', 'Амрагчдын үнэ'],
  preferredSupplier: ['Preferred Supplier (Үндсэн нийлүүлэгч)', 'Preferred Supplier'],
  reorderPoint: ['Reorder Point (Доод хэмжээ)', 'Reorder Point'],
  currentStock: ['Current Stock (Үлдэгдэл)', 'Current Stock'],
};

const LOG_COLUMNS = {
  transactionId: ['Transaction ID', 'transaction_id'],
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

function findSheet(doc: SheetDoc, titles: string[], purpose: string) {
  for (const title of titles) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  throw new Error(
    `Missing ${purpose} sheet. Tried: ${titles.join(', ')}. Available: ${Object.keys(doc.sheetsByTitle).join(', ')}`,
  );
}

function getFirstValue(row: { get: (columnName: string) => unknown }, columnNames: string[]) {
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

function normalize(value: unknown) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isInventoryCategory(value: unknown) {
  return normalize(value) === normalize('Бараа');
}

function masterLedgerFingerprint(row: SheetRow) {
  const parts = [
    row.rowNumber,
    getFirstValue(row, MASTER_LEDGER_COLUMNS.date),
    getFirstValue(row, MASTER_LEDGER_COLUMNS.supplier),
    getFirstValue(row, MASTER_LEDGER_COLUMNS.description),
    getFirstValue(row, MASTER_LEDGER_COLUMNS.quantity),
    getFirstValue(row, MASTER_LEDGER_COLUMNS.amount),
  ];

  return createHash('sha1')
    .update(parts.map(part => String(part ?? '').trim()).join('|'))
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
}

function makeTransactionId(row: SheetRow) {
  return `ML-${row.rowNumber}-${masterLedgerFingerprint(row)}`;
}

function timestamp() {
  return new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractQuantity(row: SheetRow) {
  const explicitQuantity = toNumber(getFirstValue(row, MASTER_LEDGER_COLUMNS.quantity));
  if (explicitQuantity > 0) return explicitQuantity;

  const description = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.description));
  const patterns = [
    /\bqty\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /\bquantity\s*[:=]?\s*(\d+(?:\.\d+)?)/i,
    /(?:^|\s)[x×]\s*(\d+(?:\.\d+)?)(?:\s|$)/i,
    /(\d+(?:\.\d+)?)\s*(?:ш|ширхэг|pcs?|pc)\b/i,
  ];

  for (const pattern of patterns) {
    const match = description.match(pattern);
    if (!match?.[1]) continue;
    const parsed = toNumber(match[1]);
    if (parsed > 0) return parsed;
  }

  return 1;
}

function unitCost(row: SheetRow) {
  const amount = toNumber(getFirstValue(row, MASTER_LEDGER_COLUMNS.amount));
  const quantity = extractQuantity(row);
  return amount > 0 && quantity > 0 ? amount / quantity : 0;
}

function catalogueRowInput(row: SheetRow) {
  return {
    [CATALOG_COLUMNS.name[0]]: String(getFirstValue(row, MASTER_LEDGER_COLUMNS.description)),
    [CATALOG_COLUMNS.category[0]]: 'Бараа',
    [CATALOG_COLUMNS.employeePrice[0]]: '',
    [CATALOG_COLUMNS.guestPrice[0]]: '',
    [CATALOG_COLUMNS.preferredSupplier[0]]: String(getFirstValue(row, MASTER_LEDGER_COLUMNS.supplier)),
    [CATALOG_COLUMNS.reorderPoint[0]]: '',
    [CATALOG_COLUMNS.currentStock[0]]: '',
  };
}

function findCatalogueMatch(catalogRows: SheetRow[], itemName: string) {
  const normalizedName = normalize(itemName);
  return catalogRows.find(row => normalize(getFirstValue(row, CATALOG_COLUMNS.name)) === normalizedName);
}

async function findOrCreateCatalogueItem(
  row: SheetRow,
  catalogSheet: ReturnType<typeof findSheet>,
) {
  const itemName = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.description)).trim();
  if (!itemName) return { sku: '', name: '', created: false };

  let created = false;
  let catalogRows = await catalogSheet.getRows() as SheetRow[];
  let match = findCatalogueMatch(catalogRows, itemName);

  if (!match) {
    created = true;
    await catalogSheet.addRow(catalogueRowInput(row));
  }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) await sleep(500);
    catalogRows = await catalogSheet.getRows() as SheetRow[];
    match = findCatalogueMatch(catalogRows, itemName);
    const sku = match ? String(getFirstValue(match, CATALOG_COLUMNS.sku)).trim() : '';
    if (!created || sku || attempt === 3) {
      return {
        sku,
        name: match ? String(getFirstValue(match, CATALOG_COLUMNS.name)) : itemName,
        created,
      };
    }
  }

  return { sku: '', name: itemName, created };
}

function inventoryLogRow(
  row: SheetRow,
  catalogueItem: { sku: string; name: string },
) {
  const transactionDate = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.date)).trim();
  const supplier = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.supplier)).trim();
  const paidVia = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.paidVia)).trim();
  const bank = String(getFirstValue(row, MASTER_LEDGER_COLUMNS.bank)).trim();
  const paymentSource = [bank, paidVia].filter(Boolean).join(' / ');

  return [
    makeTransactionId(row),
    transactionDate || timestamp(),
    catalogueItem.sku,
    catalogueItem.name,
    'Орлого',
    extractQuantity(row),
    String(getFirstValue(row, MASTER_LEDGER_COLUMNS.wing)) || 'Inventory',
    supplier || 'Master_Ledger',
    paymentSource,
    '',
  ];
}

function masterLedgerErrorMessage(error: unknown, fallback: string) {
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

  return fallback;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as MasterLedgerPostBody;
    const dryRun = body.dryRun === true;
    const doc = await loadSpreadsheet();
    const masterLedgerSheet = findSheet(doc, MASTER_LEDGER_SHEET_TITLES, 'master ledger');
    const catalogSheet = findSheet(doc, CATALOG_SHEET_TITLES, 'inventory catalogue');
    const inventoryLogSheet = findSheet(doc, LOG_SHEET_TITLES, 'inventory log');
    const masterRows = await masterLedgerSheet.getRows() as SheetRow[];
    const inventoryRows = masterRows.filter(row =>
      isInventoryCategory(getFirstValue(row, MASTER_LEDGER_COLUMNS.category)),
    );
    const existingInventoryLogRows = await inventoryLogSheet.getRows() as SheetRow[];
    const existingTransactionIds = new Set(
      existingInventoryLogRows
        .map(row => String(getFirstValue(row, LOG_COLUMNS.transactionId)).trim())
        .filter(Boolean),
    );
    const rowsToSync = inventoryRows.filter(row => !existingTransactionIds.has(makeTransactionId(row)));
    const alreadySyncedCount = inventoryRows.length - rowsToSync.length;

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        inventoryCount: inventoryRows.length,
        toSyncCount: rowsToSync.length,
        alreadySyncedCount,
      });
    }

    const logRows = [];
    const createdCatalogueItems = [];
    for (const row of rowsToSync) {
      const catalogueItem = await findOrCreateCatalogueItem(row, catalogSheet);
      logRows.push(inventoryLogRow(row, catalogueItem));

      if (catalogueItem.created) {
        createdCatalogueItems.push({
          sku: catalogueItem.sku,
          name: catalogueItem.name,
          unitCost: unitCost(row),
        });
      }
    }

    if (logRows.length > 0) {
      await inventoryLogSheet.addRows(logRows);
    }

    return NextResponse.json({
      success: true,
      masterLedgerRowsKept: inventoryRows.length,
      inventoryCount: logRows.length,
      alreadySyncedCount,
      createdCatalogueItems,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Master Ledger POST Error: ${message}`);
    return NextResponse.json(
      { error: masterLedgerErrorMessage(error, 'Failed to sync Master_Ledger inventory rows') },
      { status: 500 },
    );
  }
}

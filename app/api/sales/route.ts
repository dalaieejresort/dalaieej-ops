import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import { isUnlimitedInventoryItem } from '@/lib/pos/inventory';
import { clearCachedReads, getCachedRead } from '@/lib/server/read-cache';

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
};

type SheetDoc = GoogleSpreadsheet;

type SheetRow = {
  get: (columnName: string) => unknown;
  set: (columnName: string, value: unknown) => void;
  save: () => Promise<void>;
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
  const doc = createDoc();
  await doc.loadInfo();
  return doc;
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

async function getOrCreateInventoryLogSheet(doc: SheetDoc) {
  for (const title of INVENTORY_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return doc.addSheet({
    title: INVENTORY_LOG_SHEET_TITLES[0] ?? 'Inventory_Log',
    headerValues: INVENTORY_LOG_HEADERS,
  });
}

async function getOrCreatePaymentsLogSheet(doc: SheetDoc) {
  for (const title of PAYMENTS_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return doc.addSheet({
    title: PAYMENTS_LOG_SHEET_TITLES[0] ?? 'Payments_Log',
    headerValues: PAYMENTS_LOG_HEADERS,
  });
}

function findCatalogSheet(doc: SheetDoc) {
  for (const title of CATALOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) return sheet;
  }

  return null;
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

function getBusinessDatePaymentActivity(
  rows: Array<{ get: (columnName: string) => unknown }>,
  businessDate: string,
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
    }
  >();

  for (const row of rows) {
    if (businessDateFromTimestamp(row.get('timestamp')) !== businessDate) continue;

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
    };

    current.amount += amount;
    current.labels.push(`${method} ${amount}`);
    current.cashReceived += toNumber(row.get('cash_received'));
    current.changeDue += toNumber(row.get('change_due'));
    if (qpayInvoiceId) current.qpayInvoiceIds.push(qpayInvoiceId);
    if (sortTime >= current.sortTime) {
      current.latestTimestamp = timestamp;
      current.sortTime = sortTime;
    }

    activity.set(transactionId, current);
  }

  return activity;
}

function createPaymentId() {
  return `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
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
  return items
    .map(item => `${item.name ?? item.sku ?? 'Item'} x${item.qty ?? 1}`)
    .join(', ');
}

function buildEditableItems(
  saleRow: { get: (columnName: string) => unknown },
  inventoryRows: Array<{ get: (columnName: string) => unknown }>,
  catalogItems: CatalogRowItem[],
) {
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
      source: 'inventory' | 'summary';
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

    const remainingTotal = saleTotal - knownTotal;
    if (unmatchedSummaryItems.length === 1 && remainingTotal > 0) {
      const item = unmatchedSummaryItems[0];
      itemByKey.set(`manual:${normalizeLookup(item.name)}`, {
        sku: '',
        name: item.name,
        category: 'Үйлчилгээ',
        qty: item.qty,
        unitPrice: Math.round(remainingTotal / item.qty),
        priceMode: 'guest',
        source: 'summary',
      });
      knownTotal += remainingTotal;
    } else if (unmatchedSummaryItems.length > 0 && remainingTotal > 0) {
      itemByKey.set('manual:summary', {
        sku: '',
        name: getCell(saleRow, 'item_summary'),
        category: 'Үйлчилгээ',
        qty: 1,
        unitPrice: Math.round(remainingTotal),
        priceMode: 'guest',
        source: 'summary',
      });
      knownTotal += remainingTotal;
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

  return fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedTransactionId = url.searchParams.get('transactionId')?.trim();
    const businessDate = normalizeBusinessDate(url.searchParams.get('businessDate'));
    const bypassCache = url.searchParams.get('fresh') === '1';

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
      const salesLogSheet = await getOrCreateSalesLogSheet(doc);
      const paymentsLogSheet = await getOrCreatePaymentsLogSheet(doc);
      const [salesRows, paymentRows] = await Promise.all([
        salesLogSheet.getRows() as Promise<SheetRow[]>,
        paymentsLogSheet.getRows(),
      ]);
      const paymentTotals = getPaymentTotals(paymentRows);
      const paymentSummaries = getPaymentSummaries(paymentRows);
      const businessDatePaymentActivity = getBusinessDatePaymentActivity(
        paymentRows,
        businessDate,
      );
      const unpaidCharges = salesRows
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
          };
        })
        .filter(charge => charge.balance > 0)
        .filter(charge => charge.transactionId);
      const history = salesRows
        .flatMap(row => {
          const transactionId = getCell(row, 'transaction_id');
          const saleTimestamp = getCell(row, 'timestamp');
          const saleTotal = toNumber(row.get('total'));
          const recordedPaidAmount = paymentTotals.get(transactionId) ?? 0;
          const paymentActivity = businessDatePaymentActivity.get(transactionId);
          const hasBusinessDatePayment = Number(paymentActivity?.amount ?? 0) > 0;
          const saleIsFromBusinessDate =
            businessDateFromTimestamp(saleTimestamp) === businessDate;
          const paidStatus = getCell(row, 'paid_status').toLowerCase();
          const effectivePaidStatus =
            recordedPaidAmount >= saleTotal && paidStatus !== 'voided' ? 'paid' : paidStatus;
          const isPaidSale = effectivePaidStatus === 'paid';
          const shouldInclude =
            transactionId &&
            saleTotal > 0 &&
            paidStatus !== 'voided' &&
            ((saleIsFromBusinessDate && isPaidSale) || hasBusinessDatePayment);

          if (!shouldInclude) return [];

          const displayPaidAmount = hasBusinessDatePayment
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
            historyKind: hasBusinessDatePayment ? 'payment' : 'sale',
            refundableAmount: Math.max(displayPaidAmount, 0),
            itemCount: toNumber(row.get('item_count')),
            itemSummary: getCell(row, 'item_summary'),
            qpayInvoiceId:
              paymentActivity?.qpayInvoiceIds.join(' + ') || getCell(row, 'qpay_invoice_id'),
            cashReceived: paymentActivity?.cashReceived || toNumber(row.get('cash_received')),
            changeDue: paymentActivity?.changeDue || toNumber(row.get('change_due')),
            notes: getCell(row, 'notes'),
            sortTime: paymentActivity?.sortTime || timestampMs(saleTimestamp),
          }];
        })
        .sort((a, b) => b.sortTime - a.sortTime)
        .slice(0, 50)
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
          cashReceived: sale.cashReceived,
          changeDue: sale.changeDue,
          notes: sale.notes,
        }));

      return { charges: unpaidCharges, history };
    };
    const payload = bypassCache
      ? await loadSalesList()
      : await getCachedRead(
        `sales:list:${businessDate}`,
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

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as SettleSaleBody;
    const transactionId = body.transactionId?.trim();

    if (!transactionId) {
      return NextResponse.json({ error: 'transactionId is required' }, { status: 400 });
    }

    const doc = await loadSpreadsheet();
    const salesLogSheet = await getOrCreateSalesLogSheet(doc);
    const paymentsLogSheet = await getOrCreatePaymentsLogSheet(doc);
    const [salesRows, paymentRows] = await Promise.all([
      salesLogSheet.getRows() as Promise<SheetRow[]>,
      paymentsLogSheet.getRows(),
    ]);
    const row = salesRows.find(item => getCell(item, 'transaction_id') === transactionId);

    if (!row) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 });
    }

    if (getCell(row, 'paid_status').toLowerCase() !== 'unpaid') {
      return NextResponse.json({ error: 'Sale is not an unpaid charge' }, { status: 400 });
    }

    const saleTotal = toNumber(row.get('total'));
    const paidToDate = getPaymentTotals(paymentRows).get(transactionId) ?? 0;
    const balance = Math.max(saleTotal - paidToDate, 0);

    if (body.action === 'edit_unpaid') {
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
        body.staffName || 'Staff',
        'Өр засвар',
        room,
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
          body.staffName || 'Staff',
          'Өр засвар',
          room,
        ]);

      if (reversalRows.length > 0 || newInventoryRows.length > 0) {
        await inventoryLogSheet.addRows([...reversalRows, ...newInventoryRows]);
      }

      row.set('staff', body.staffName || getCell(row, 'staff') || 'Staff');
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
      row.set(
        'notes',
        [getCell(row, 'notes'), `Edited ${timestamp} by ${body.staffName || 'Staff'}`]
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

    if (balance === 0) {
      return NextResponse.json({ success: true, message: 'Sale is already settled' });
    }

    const bodyUsesPaymentArray = Array.isArray(body.payments) && body.payments.length > 0;
    const requestedPayments = getSettlementPayments(body).map((payment, index) => ({
      ...payment,
      paymentMethod: payment.paymentMethod?.trim(),
      amount: Number(payment.amount ?? (!bodyUsesPaymentArray && index === 0 ? balance : 0)),
    }));
    const invalidPayment = requestedPayments.find(
      payment =>
        !payment.paymentMethod ||
        !Number.isFinite(payment.amount) ||
        payment.amount <= 0,
    );

    if (invalidPayment) {
      return NextResponse.json(
        { error: 'Each payment must have a method and amount greater than zero' },
        { status: 400 },
      );
    }

    const paymentTotal = requestedPayments.reduce((sum, payment) => sum + payment.amount, 0);

    if (paymentTotal > balance) {
      return NextResponse.json(
        { error: 'Payment amount is greater than the remaining balance' },
        { status: 400 },
      );
    }

    const timestamp = new Date().toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
    await paymentsLogSheet.addRows(
      requestedPayments.map(payment => [
        createPaymentId(),
        transactionId,
        timestamp,
        body.staffName || 'Staff',
        payment.paymentMethod ?? '',
        payment.amount,
        payment.cashReceived ?? '',
        payment.changeDue ?? '',
        payment.qpayInvoiceId ?? '',
        payment.notes || `Settlement payment for ${transactionId}`,
      ]),
    );
    clearCachedReads('sales:');
    clearCachedReads('day:');

    return NextResponse.json({
      success: true,
      message: 'Payment recorded',
      balance: Math.max(balance - paymentTotal, 0),
    });
  } catch (error) {
    console.error(`Sales PATCH Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: salesErrorMessage(error, 'Failed to settle sale') },
      { status: 500 },
    );
  }
}

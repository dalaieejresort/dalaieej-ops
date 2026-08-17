import {
  GoogleSpreadsheet,
  type GoogleSpreadsheetWorksheet,
} from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';
import {
  isUnlimitedInventoryItem,
} from '@/lib/pos/inventory';
import { serializeSaleItemDetails } from '@/lib/pos/sale-item-details';
import {
  makePaymentLineNumber,
  makeUniformControlNumber,
  makeUniformOrderNumber,
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

type InventoryPostBody = {
  items?: Array<{
    sku?: string;
    name?: string;
    category?: string;
    qty?: number;
    unitPrice?: number;
    priceMode?: 'guest' | 'staff';
  }>;
  method?: string;
  room?: string;
  staffName?: string;
  paidStatus?: string;
  total?: number;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  payments?: InventoryPaymentInput[];
  clientRequestId?: string;
};

type InventoryPaymentInput = {
  paymentMethod?: string;
  amount?: number;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  notes?: string;
};

type SheetDoc = GoogleSpreadsheet;

const INVENTORY_READ_CACHE_TTL_MS = 30000;

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
    if (sheet) {
      await sheet.loadHeaderRow();
      const missingHeaders = SALES_LOG_HEADERS.filter(
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
    title: SALES_LOG_SHEET_TITLES[0] ?? 'Sales_Log',
    headerValues: SALES_LOG_HEADERS,
  });
}

async function getOrCreatePaymentsLogSheet(doc: SheetDoc) {
  for (const title of PAYMENTS_LOG_SHEET_TITLES) {
    const sheet = doc.sheetsByTitle[title];
    if (sheet) {
      await sheet.loadHeaderRow();
      const missingHeaders = PAYMENT_LOG_HEADERS.filter(
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
    title: PAYMENTS_LOG_SHEET_TITLES[0] ?? 'Payments_Log',
    headerValues: PAYMENT_LOG_HEADERS,
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

function getInventoryPayments(
  payments: InventoryPaymentInput[] | undefined,
  fallback: InventoryPaymentInput,
) {
  const source = Array.isArray(payments) && payments.length > 0
    ? payments
    : [fallback];

  return source
    .map(payment => ({
      paymentMethod: String(payment.paymentMethod ?? fallback.paymentMethod ?? '').trim(),
      amount: toNumber(payment.amount),
      cashReceived: toNumber(payment.cashReceived),
      changeDue: toNumber(payment.changeDue),
      qpayInvoiceId: String(payment.qpayInvoiceId ?? '').trim(),
      notes: String(payment.notes ?? '').trim(),
    }))
    .filter(payment => payment.paymentMethod && payment.amount > 0);
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

  if (message.includes('Open the business day')) {
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
async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const bypassCache = url.searchParams.get('fresh') === '1';
    const loadCatalog = async () => {
      const doc = await loadSpreadsheet();
      const catalogSheet = findSheet(doc, CATALOG_SHEET_TITLES, 'inventory catalogue');
      const rows = await catalogSheet.getRows();

      // Clean up the Google Sheets data into a simple JSON array for your React frontend
      const products = rows.map(row => {
        const guestPrice = toNumber(getFirstValue(row, CATALOG_COLUMNS.guestPrice));
        const staffPrice = toNumber(getFirstValue(row, CATALOG_COLUMNS.staffPrice));

        return {
          sku: String(getFirstValue(row, CATALOG_COLUMNS.sku)),
          name: String(getFirstValue(row, CATALOG_COLUMNS.name)),
          category: String(getFirstValue(row, CATALOG_COLUMNS.category)),
          price: guestPrice || staffPrice,
          guestPrice: guestPrice || undefined,
          staffPrice: staffPrice || undefined,
          stock: toNumber(getFirstValue(row, CATALOG_COLUMNS.stock)),
        };
      });

      // Keep every priced catalogue item visible, even when its stock is zero.
      return products.filter(
        p =>
          p.sku &&
          p.price > 0,
      );
    };
    const validProducts = bypassCache
      ? await loadCatalog()
      : await getCachedRead(
        'inventory:catalog',
        INVENTORY_READ_CACHE_TTL_MS,
        loadCatalog,
      );

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
async function handlePOST(request: Request) {
  try {
    const sessionOrResponse = requireApiSession(request, 'cashier');
    if (sessionOrResponse instanceof NextResponse) return sessionOrResponse;
    const body = (await request.json()) as InventoryPostBody;
    const {
      items,
      method,
      room,
      staffName: requestedStaffName,
      paidStatus,
      total,
      cashReceived,
      changeDue,
      qpayInvoiceId,
      payments,
      clientRequestId,
    } = body;
    const staffName = sessionOrResponse.displayName;
    void requestedStaffName;
    if (!items?.length) {
      return NextResponse.json({ error: 'No items to log' }, { status: 400 });
    }

    const doc = await loadSpreadsheet();
    const [
      logSheet,
      salesLogSheet,
      paymentsLogSheet,
      receiptsLogSheet,
      daySessionSheet,
    ] =
      await Promise.all([
        ensureSheetHeaders(
          findSheet(doc, LOG_SHEET_TITLES, 'inventory log'),
          INVENTORY_LOG_HEADERS,
        ),
        getOrCreateSalesLogSheet(doc),
        getOrCreatePaymentsLogSheet(doc),
        getOrCreateSheet(
          doc,
          RECEIPTS_LOG_SHEET_TITLES,
          RECEIPT_LOG_HEADERS,
        ),
        getOrCreateSheet(
          doc,
          DAY_SESSION_SHEET_TITLES,
          DAY_SESSION_HEADERS,
        ),
      ]);
    const [daySessionRows, existingSalesRows] = await Promise.all([
      daySessionSheet.getRows(),
      clientRequestId ? salesLogSheet.getRows() : Promise.resolve([]),
    ]);
    const activeSession = requireActiveBusinessSession(daySessionRows);
    const staleResponse = staleBusinessDayResponse(activeSession.businessDate);
    if (staleResponse) return staleResponse;
    const normalizedClientRequestId = String(clientRequestId ?? '').trim();
    const existingSale = normalizedClientRequestId
      ? existingSalesRows.find(
          row =>
            String(row.get('client_request_id') ?? '').trim() ===
            normalizedClientRequestId,
        )
      : undefined;

    if (existingSale) {
      const existingOrderId = String(
        existingSale.get('transaction_id') ?? '',
      ).trim();
      const existingReceiptId = String(
        existingSale.get('receipt_id') ?? '',
      ).trim();
      const operationStatus = String(
        existingSale.get('operation_status') ?? '',
      ).trim();

      if (operationStatus !== 'complete') {
        return NextResponse.json(
          {
            error:
              'This order request already reached the ledger but did not finish. Check History before retrying.',
            orderId: existingOrderId,
          },
          { status: 409 },
        );
      }

      return NextResponse.json({
        success: true,
        duplicateRequest: true,
        transactionId: existingOrderId,
        orderId: existingOrderId,
        receiptId: existingReceiptId || undefined,
        sessionId: String(existingSale.get('session_id') ?? '').trim(),
        businessDate: String(
          existingSale.get('business_date') ?? '',
        ).trim(),
        paidAt: existingReceiptId
          ? String(existingSale.get('timestamp') ?? '').trim()
          : undefined,
      });
    }

    // Lock the timestamp to Ulaanbaatar time regardless of where Vercel's servers are
    const saleCreatedAt = new Date();
    const timestamp = saleCreatedAt.toLocaleString('en-US', { timeZone: 'Asia/Ulaanbaatar' });
    let transactionId = makeUniformControlNumber('ORD', saleCreatedAt);
    const saleSubtotal = items.reduce(
      (sum, item) => sum + (item.unitPrice ?? 0) * (item.qty ?? 1),
      0,
    );
    const saleTotal = total ?? saleSubtotal;
    const normalizedPaidStatus = (paidStatus || 'paid').toLowerCase();
    const hasExplicitPayments = Array.isArray(payments) && payments.length > 0;
    const inventoryPayments = getInventoryPayments(payments, {
      paymentMethod: method || '',
      amount: saleTotal,
      cashReceived,
      changeDue,
      qpayInvoiceId,
    });
    const paymentTotal = inventoryPayments.reduce(
      (sum, payment) => sum + payment.amount,
      0,
    );

    if (hasExplicitPayments && inventoryPayments.length === 0) {
      return NextResponse.json(
        { error: 'Explicit payments must include a method and amount greater than zero' },
        { status: 400 },
      );
    }

    if (hasExplicitPayments && paymentTotal > saleTotal) {
      return NextResponse.json(
        { error: 'Payment amount is greater than the sale total' },
        { status: 400 },
      );
    }

    if (normalizedPaidStatus === 'unpaid' && hasExplicitPayments && paymentTotal >= saleTotal) {
      return NextResponse.json(
        { error: 'Partial unpaid sales must leave a remaining balance' },
        { status: 400 },
      );
    }

    const paymentMethod =
      method ||
      inventoryPayments
        .map(payment => payment.paymentMethod)
        .join(' + ');
    const paymentCashReceived =
      cashReceived ??
      inventoryPayments.reduce((sum, payment) => sum + payment.cashReceived, 0);
    const paymentChangeDue =
      changeDue ??
      inventoryPayments.reduce((sum, payment) => sum + payment.changeDue, 0);
    const paymentBankReferenceId =
      qpayInvoiceId ||
      inventoryPayments.map(payment => payment.qpayInvoiceId).filter(Boolean).join(' + ');
    const itemSummary = items
      .map(item => `${item.name ?? item.sku ?? 'Item'} x${item.qty ?? 1}`)
      .join(', ');

    const inventoryItems = items.filter(item => {
      return !isUnlimitedInventoryItem(item);
    });

    // Map stock-tracked cart items to inventory ledger rows. Food stays in Sales_Log only.
    const newRows = inventoryItems.map(item => {
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
        paymentMethod || '',       // I: Payment Method (Bank/Card/Cash/Room)
        room || '',                // J: Room Number (If applicable)
        activeSession.sessionId,   // K: Immutable day session
        activeSession.businessDate // L: Operational business date
      ];
    });

    const shouldAppendPayment = normalizedPaidStatus !== 'unpaid' || hasExplicitPayments;
    const salesRow = {
      transaction_id: transactionId,
      timestamp,
      staff: staffName || 'Staff',
      payment_method: paymentMethod || '',
      paid_status: normalizedPaidStatus,
      room_or_guest: room || '',
      subtotal: saleSubtotal,
      discount: 0,
      total: saleTotal,
      cash_received: paymentCashReceived,
      change_due: paymentChangeDue,
      item_count: items.reduce((sum, item) => sum + (item.qty ?? 1), 0),
      item_summary: itemSummary,
      qpay_invoice_id: paymentBankReferenceId,
      notes: '',
      item_details: serializeSaleItemDetails(items),
      session_id: activeSession.sessionId,
      business_date: activeSession.businessDate,
      client_request_id: normalizedClientRequestId,
      operation_status: 'pending',
      receipt_id: '',
    };

    // The permanent order number uses the append-only Sales_Log row number.
    const [createdSaleRow] = await salesLogSheet.addRows([salesRow]);
    transactionId = makeUniformOrderNumber(
      createdSaleRow.rowNumber,
      activeSession.businessDate,
    );
    createdSaleRow.set('transaction_id', transactionId);
    await createdSaleRow.save();
    newRows.forEach(row => {
      row[0] = transactionId;
    });
    let receiptId: string | undefined;
    let receiptRowToFinalize:
      | {
          set: (columnName: string, value: unknown) => void;
          save: () => Promise<void>;
        }
      | undefined;
    if (shouldAppendPayment && inventoryPayments.length > 0) {
      const [createdReceiptRow] = await receiptsLogSheet.addRows([
        {
          receipt_id: makeUniformControlNumber('RCP'),
          timestamp,
          session_id: activeSession.sessionId,
          business_date: activeSession.businessDate,
          staff: staffName || 'Staff',
          order_ids: transactionId,
          total: paymentTotal,
          payment_summary: inventoryPayments
            .map(payment => `${payment.paymentMethod} ${payment.amount}`)
            .join(' + '),
          cash_received: paymentCashReceived || '',
          change_due: paymentChangeDue || '',
          qpay_invoice_id: paymentBankReferenceId || '',
          notes:
            normalizedPaidStatus === 'unpaid'
              ? `Partial payment for ${transactionId}`
              : `Payment for ${transactionId}`,
          client_request_id: normalizedClientRequestId,
          operation_status: 'pending',
        },
      ]);
      receiptId = makeUniformReceiptNumber(
        createdReceiptRow.rowNumber,
        activeSession.businessDate,
      );
      createdReceiptRow.set('receipt_id', receiptId);
      await createdReceiptRow.save();
      receiptRowToFinalize = createdReceiptRow;
    }
    const paymentRows = inventoryPayments.map((payment, index) => ({
      payment_id: receiptId
        ? makePaymentLineNumber(receiptId, index + 1)
        : makeUniformControlNumber('PAY'),
      transaction_id: transactionId,
      timestamp,
      staff: staffName || 'Staff',
      payment_method: payment.paymentMethod,
      amount: payment.amount,
      cash_received: payment.cashReceived || '',
      change_due: payment.changeDue || '',
      qpay_invoice_id: payment.qpayInvoiceId || '',
      notes: payment.notes || 'Initial sale payment',
      receipt_id: receiptId ?? '',
      session_id: activeSession.sessionId,
      business_date: activeSession.businessDate,
    }));

    // Fire the linked inventory and payment records into Google Sheets.
    await Promise.all([
      newRows.length > 0 ? logSheet.addRows(newRows) : Promise.resolve(),
      shouldAppendPayment && paymentRows.length > 0
        ? paymentsLogSheet.addRows(paymentRows)
        : Promise.resolve([]),
    ]);
    if (receiptRowToFinalize) {
      receiptRowToFinalize.set('operation_status', 'complete');
      await receiptRowToFinalize.save();
    }
    createdSaleRow.set('receipt_id', receiptId ?? '');
    createdSaleRow.set('operation_status', 'complete');
    await createdSaleRow.save();
    clearCachedReads('day:');
    clearCachedReads('sales:');
    clearCachedReads('inventory:');

    return NextResponse.json({
      success: true,
      message: `Logged ${newRows.length} inventory items and 1 sale.`,
      transactionId,
      orderId: transactionId,
      receiptId,
      sessionId: activeSession.sessionId,
      businessDate: activeSession.businessDate,
      paidAt: receiptId ? timestamp : undefined,
    });
  } catch (error) {
    logInventoryError('Inventory POST Error', error);
    return NextResponse.json(
      { error: inventoryErrorMessage(error, 'Failed to log transaction') },
      { status: 500 },
    );
  }
}

export const GET = withProtectedApiRoute('/api/inventory', 'cashier', handleGET);
export const POST = withProtectedApiRoute('/api/inventory', 'cashier', handlePOST);

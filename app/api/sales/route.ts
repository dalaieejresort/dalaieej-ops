import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { NextResponse } from 'next/server';

type SettlementPaymentInput = {
  paymentMethod?: string;
  amount?: number;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  notes?: string;
};

type SettleSaleBody = {
  transactionId?: string;
  paymentMethod?: string;
  amount?: number;
  staffName?: string;
  cashReceived?: number;
  changeDue?: number;
  qpayInvoiceId?: string;
  payments?: SettlementPaymentInput[];
};

type SheetDoc = GoogleSpreadsheet;

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

function toNumber(value: unknown) {
  const cleaned = String(value ?? '').replace(/[₮,\s]/g, '');
  const numberValue = Number(cleaned);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function getCell(row: { get: (columnName: string) => unknown }, column: string) {
  return String(row.get(column) ?? '').trim();
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

function createPaymentId() {
  return `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
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

export async function GET() {
  try {
    const doc = await loadSpreadsheet();
    const salesLogSheet = await getOrCreateSalesLogSheet(doc);
    const paymentsLogSheet = await getOrCreatePaymentsLogSheet(doc);
    const [salesRows, paymentRows] = await Promise.all([
      salesLogSheet.getRows(),
      paymentsLogSheet.getRows(),
    ]);
    const paymentTotals = getPaymentTotals(paymentRows);
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

    return NextResponse.json({ charges: unpaidCharges });
  } catch (error) {
    console.error(`Sales GET Error: ${error instanceof Error ? error.message : String(error)}`);
    return NextResponse.json(
      { error: salesErrorMessage(error, 'Failed to fetch unpaid sales') },
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
      salesLogSheet.getRows(),
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

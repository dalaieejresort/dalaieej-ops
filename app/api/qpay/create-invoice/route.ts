import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';

const QPAY_AUTH_URL = 'https://merchant.qpay.mn/v2/auth/token';
const QPAY_INVOICE_URL = 'https://merchant.qpay.mn/v2/invoice';
const DEFAULT_QPAY_CALLBACK_URL = 'https://www.dalaieej.mn/api/qpay/webhook';

type InvoiceRequest = {
  amount?: number;
  description?: string;
  callbackUrl?: string;
};

type QPayTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type QPayInvoiceResponse = {
  invoice_id?: string;
  qr_text?: string;
  qr_image?: string;
  qPay_shortUrl?: string;
  urls?: Array<{
    name?: string;
    description?: string;
    logo?: string;
    link?: string;
  }>;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is missing`);
  }
  return value;
}

async function readJsonResponse<T>(response: Response) {
  const text = await response.text();
  const data = text ? (JSON.parse(text) as T) : ({} as T);

  if (!response.ok) {
    const detail = typeof data === 'object' ? JSON.stringify(data) : text;
    throw new Error(`QPay error ${response.status}: ${detail}`);
  }

  return data;
}

async function getQPayToken() {
  const username = requiredEnv('QPAY_USERNAME');
  const password = requiredEnv('QPAY_PASSWORD');
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  const response = await fetch(QPAY_AUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const data = await readJsonResponse<QPayTokenResponse>(response);

  if (!data.access_token) {
    throw new Error('QPay did not return an access token');
  }

  return data.access_token;
}

function getCallbackUrl(callbackUrl?: string) {
  const publicBaseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');

  return (
    callbackUrl?.trim() ||
    process.env.QPAY_CALLBACK_URL?.trim() ||
    (publicBaseUrl ? `${publicBaseUrl}/api/qpay/webhook` : '') ||
    DEFAULT_QPAY_CALLBACK_URL
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InvoiceRequest;
    const amount = Number(body.amount ?? 0);

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Invalid QPay amount' }, { status: 400 });
    }

    const token = await getQPayToken();
    const invoiceCode = process.env.QPAY_INVOICE_CODE || 'DALAI_EEJ_RESORT_INVOICE';
    const callbackUrl = getCallbackUrl(body.callbackUrl);
    const invoiceResponse = await fetch(QPAY_INVOICE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        invoice_code: invoiceCode,
        sender_invoice_no: randomUUID(),
        invoice_receiver_code: 'terminal',
        invoice_description: body.description || 'Dalai Eej POS payment',
        amount,
        callback_url: callbackUrl,
      }),
    });
    const invoice = await readJsonResponse<QPayInvoiceResponse>(invoiceResponse);

    if (!invoice.invoice_id) {
      throw new Error('QPay did not return an invoice id');
    }

    return NextResponse.json({
      success: true,
      invoiceId: invoice.invoice_id,
      qrCode: invoice.qr_image || '',
      qrText: invoice.qr_text || '',
      shortUrl: invoice.qPay_shortUrl || '',
      bankUrls: invoice.urls || [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create QPay invoice';
    console.error(`QPay invoice error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

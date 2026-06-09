import { NextResponse } from 'next/server';

const QPAY_AUTH_URL = 'https://merchant.qpay.mn/v2/auth/token';
const QPAY_CHECK_URL = 'https://merchant.qpay.mn/v2/payment/check';

let cachedToken: string | null = null;
let tokenExpiry = 0;

type CheckPaymentRequest = {
  invoiceId?: string;
  expectedAmount?: number;
};

type QPayTokenResponse = {
  access_token?: string;
  expires_in?: number;
};

type QPayCheckRow = {
  payment_status?: string;
  payment_amount?: string | number;
};

type QPayCheckResponse = {
  rows?: QPayCheckRow[];
  paid_amount?: string | number;
  count?: number;
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
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

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

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in ? data.expires_in * 1000 - 60000 : 3500000);

  return cachedToken;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CheckPaymentRequest;
    const invoiceId = body.invoiceId?.trim();

    if (!invoiceId) {
      return NextResponse.json({ error: 'Invoice ID is required' }, { status: 400 });
    }

    const token = await getQPayToken();
    const response = await fetch(QPAY_CHECK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        object_type: 'INVOICE',
        object_id: invoiceId,
        offset: {
          page_number: 1,
          page_limit: 100,
        },
      }),
    });
    const data = await readJsonResponse<QPayCheckResponse>(response);
    const paidRow = data.rows?.find((row) => row.payment_status === 'PAID');
    const expectedAmount = Number(body.expectedAmount ?? 0);
    const paidAmount = Number(paidRow?.payment_amount ?? data.paid_amount ?? 0);
    const paid = Boolean(paidRow) && (!expectedAmount || paidAmount >= expectedAmount);

    return NextResponse.json({
      success: true,
      paid,
      paidAmount,
      count: data.count || 0,
    });
  } catch (error) {
    cachedToken = null;
    tokenExpiry = 0;
    const message = error instanceof Error ? error.message : 'Failed to check QPay payment';
    console.error(`QPay check error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

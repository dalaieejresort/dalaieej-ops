import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');

test('only the two receipt information pages are public; private pages and OAuth routes remain gated', () => {
  const { proxy } = load('proxy.ts', {
    'next/server': { NextResponse: {
      next: () => ({ kind: 'next' }),
      redirect: url => ({ kind: 'redirect', location: String(url) }),
      json: (body, options) => ({ kind: 'json', body, status: options.status }),
    } },
  });
  const request = pathname => ({ nextUrl: { pathname }, url: `https://test.example${pathname}`, cookies: { has: () => false } });
  for (const path of ['/receipt-payments', '/receipt-payments/privacy']) {
    assert.equal(proxy(request(path)).kind, 'next');
  }
  for (const path of ['/receipt-payments/connect', '/receipt-payments/privacy/private', '/reconciliation', '/register']) {
    assert.equal(proxy(request(path)).kind, 'redirect');
  }
  for (const path of ['/api/receipt-payments/gmail/connect', '/api/receipt-payments/gmail/callback', '/api/reconciliation/gmail/sync']) {
    assert.equal(proxy(request(path)).status, 401);
  }
});

test('public receipt pages contain disclosures and links, not data access', () => {
  const home = read('app/receipt-payments/page.tsx');
  const privacy = read('app/receipt-payments/privacy/page.tsx');
  assert.match(home, /href="\/receipt-payments\/privacy"/);
  assert.match(privacy, /Limited Use/);
  assert.match(privacy, /myaccount.google.com\/connections/);
  for (const source of [home, privacy]) {
    assert.doesNotMatch(source, /getReceiptConnection|findReceiptBankPayments|process\.env|fetch\(/);
    assert.match(source, /dalaieejcamp@gmail.com/);
  }
});
function load(path, mocks = {}) {
  const compiled = ts.transpileModule(read(path), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => {
    if (name === 'server-only') return {};
    if (name in mocks) return mocks[name];
    return require(name);
  }, module, module.exports);
  return module.exports;
}

test('receipt modules never import reconciliation state or use its environment variables', () => {
  for (const file of readdirSync(new URL('lib/receipt-payments/', root)).filter(f => f.endsWith('.ts'))) {
    const source = read(`lib/receipt-payments/${file}`);
    assert.doesNotMatch(source, /RECONCILIATION_|reconciliation\/(?:database|gmail|token-crypto)|sqlite/i);
  }
  assert.doesNotMatch(read('lib/reconciliation/gmail.ts'), /findReceiptBankPayments/);
  assert.match(read('app/api/reconciliation/paid-via/route.ts'), /receipt-payments\/paid-via/);
});

test('configuration never falls back to reconciliation OAuth or storage', () => {
  const keys = ['RECEIPT_PAYMENTS_DATABASE_URL', 'RECEIPT_GMAIL_CLIENT_ID', 'RECEIPT_GMAIL_CLIENT_SECRET', 'RECEIPT_GMAIL_REDIRECT_URI', 'RECEIPT_TOKEN_ENCRYPTION_KEY'];
  const original = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  try {
    keys.forEach(k => delete process.env[k]);
    const config = load('lib/receipt-payments/config.ts');
    assert.deepEqual(config.receiptSetup(), { database: false, oauth: false, redirect: false, encryption: false });
    assert.throws(() => config.receiptRedirectUri(), /receipt_setup_required/);
    process.env.RECEIPT_GMAIL_REDIRECT_URI = 'https://example.com/api/reconciliation/gmail/callback';
    assert.throws(() => config.receiptRedirectUri(), /receipt_setup_required/);
    process.env.RECEIPT_GMAIL_REDIRECT_URI = 'https://example.com/api/receipt-payments/gmail/callback';
    assert.equal(config.receiptRedirectUri(), process.env.RECEIPT_GMAIL_REDIRECT_URI);
  } finally {
    keys.forEach(k => original[k] === undefined ? delete process.env[k] : process.env[k] = original[k]);
  }
});

test('wrong Gmail account cannot save or overwrite credentials; expected account can', async () => {
  let email = 'wrong@example.com';
  const saved = [];
  class OAuth2Client {
    async getToken() { return { tokens: { refresh_token: 'test-token', scope: 'https://www.googleapis.com/auth/gmail.readonly' } }; }
    setCredentials() {}
    async request() { return { data: { emailAddress: email } }; }
  }
  const original = [process.env.RECEIPT_GMAIL_CLIENT_ID, process.env.RECEIPT_GMAIL_CLIENT_SECRET];
  process.env.RECEIPT_GMAIL_CLIENT_ID = 'test-id';
  process.env.RECEIPT_GMAIL_CLIENT_SECRET = 'test-secret';
  try {
    const oauth = load('lib/receipt-payments/oauth.ts', {
      'google-auth-library': { OAuth2Client },
      './config': { receiptRedirectUri: () => 'https://test.example/callback', RECEIPT_MAILBOX: 'dalaieejcamp@gmail.com' },
      './database': { saveReceiptConnection: async (...args) => saved.push(args) },
      './token-crypto': { encryptReceiptToken: value => `encrypted:${value}` },
    });
    await assert.rejects(oauth.completeReceiptAuthorization('test-code'), /wrong_mailbox/);
    assert.equal(saved.length, 0);
    email = 'theenerzaya@gmail.com';
    await assert.rejects(oauth.completeReceiptAuthorization('test-code'), /wrong_mailbox/);
    assert.equal(saved.length, 0);
    email = 'dalaieejcamp@gmail.com';
    await oauth.completeReceiptAuthorization('test-code');
    assert.deepEqual(saved, [[email, 'encrypted:test-token']]);
  } finally {
    ['RECEIPT_GMAIL_CLIENT_ID', 'RECEIPT_GMAIL_CLIENT_SECRET'].forEach((key, i) => original[i] === undefined ? delete process.env[key] : process.env[key] = original[i]);
  }
});

test('matching endpoint rejects unauthenticated requests before email access', async () => {
  let lookups = 0;
  const route = load('app/api/receipt-payments/paid-via/route.ts', {
    '@/lib/receipt-payments/gmail': { findReceiptBankPayments: async () => { lookups++; throw new Error('receipt_setup_required'); } },
    '@/lib/receipt-payments/paid-via-match': {},
  });
  const original = process.env.RECEIPT_MATCH_SECRET;
  process.env.RECEIPT_MATCH_SECRET = 'test-secret';
  try {
    const denied = await route.POST(new Request('https://test.example', { method: 'POST' }));
    assert.equal(denied.status, 401);
    assert.equal(lookups, 0);
    const unavailable = await route.POST(new Request('https://test.example', {
      method: 'POST', headers: { authorization: 'Bearer test-secret' },
      body: JSON.stringify({ amount: 77000, currency: 'MNT', supplier: 'MON PASS', reference: '123456', date: '2026-09-03' }),
    }));
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), { status: 'unavailable', code: 'receipt_setup_required' });
  } finally {
    if (original === undefined) delete process.env.RECEIPT_MATCH_SECRET;
    else process.env.RECEIPT_MATCH_SECRET = original;
  }
});

test('active mailbox is the business inbox and credential reads have no legacy fallback', async () => {
  const config = load('lib/receipt-payments/config.ts');
  assert.equal(config.RECEIPT_MAILBOX, 'dalaieejcamp@gmail.com');
  const queries = [];
  const sql = (strings, ...values) => {
    queries.push({ text: strings.join('?'), values });
    return [];
  };
  const old = process.env.RECEIPT_PAYMENTS_DATABASE_URL;
  process.env.RECEIPT_PAYMENTS_DATABASE_URL = 'test-only';
  try {
    const db = load('lib/receipt-payments/database.ts', {
      '@neondatabase/serverless': { neon: () => sql }, './config': config,
    });
    assert.equal(await db.getReceiptConnection(), null);
    assert.equal(queries.length, 1);
    assert.match(queries[0].text, /WHERE email_address = \?/);
    assert.deepEqual(queries[0].values, ['dalaieejcamp@gmail.com']);
    await assert.rejects(db.saveReceiptConnection('theenerzaya@gmail.com', 'legacy'), /wrong_mailbox/);
    assert.equal(queries.length, 1);
  } finally {
    if (old === undefined) delete process.env.RECEIPT_PAYMENTS_DATABASE_URL;
    else process.env.RECEIPT_PAYMENTS_DATABASE_URL = old;
  }
});

test('new authorization migrates the credential constraint and saves atomically without deleting history', async () => {
  const config = load('lib/receipt-payments/config.ts');
  let batch;
  const sql = (strings, ...values) => ({ text: strings.join('?'), values });
  sql.transaction = async queries => { batch = queries; };
  const old = process.env.RECEIPT_PAYMENTS_DATABASE_URL;
  process.env.RECEIPT_PAYMENTS_DATABASE_URL = 'test-only';
  try {
    const db = load('lib/receipt-payments/database.ts', {
      '@neondatabase/serverless': { neon: () => sql }, './config': config,
    });
    await db.saveReceiptConnection(config.RECEIPT_MAILBOX, 'encrypted-new-token');
    assert.equal(batch.length, 5);
    assert.match(batch[2].text, /DROP CONSTRAINT IF EXISTS gmail_connection_email_address_check/);
    assert.match(batch[3].text, /CHECK \(email_address IN \('theenerzaya@gmail.com', 'dalaieejcamp@gmail.com'\)\)/);
    assert.deepEqual(batch[4].values, ['dalaieejcamp@gmail.com', 'encrypted-new-token']);
    for (const query of batch) assert.doesNotMatch(query.text, /DELETE|TRUNCATE|DROP TABLE|reconciliation\./i);
  } finally {
    if (old === undefined) delete process.env.RECEIPT_PAYMENTS_DATABASE_URL;
    else process.env.RECEIPT_PAYMENTS_DATABASE_URL = old;
  }
});

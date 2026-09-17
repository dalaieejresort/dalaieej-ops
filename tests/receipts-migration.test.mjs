import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';

function load(file) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    () => ({ NextResponse }), loaded, loaded.exports,
  );
  return loaded.exports;
}
const { proxy } = load('proxy.ts');

test('retired receipt APIs identify the new endpoint without redirecting bearer requests', async () => {
  for (const path of ['/api/reconciliation/cron/sync', '/api/reconciliation/paid-via', '/api/receipt-payments/paid-via']) {
    const response = proxy(new NextRequest(`https://ops.dalaieej.mn${path}`, { method: 'POST' }));
    assert.equal(response.status, 410);
    assert.equal(response.headers.get('location'), null);
    const body = await response.json();
    assert.equal(body.code, 'RECEIPTS_MOVED');
    assert.equal(body.endpoint, `https://receipts.dalaieej.mn${path === '/api/reconciliation/paid-via' ? '/api/receipt-payments/paid-via' : path}`);
  }
});

test('Ops authentication gates remain intact after receipt extraction', () => {
  assert.equal(proxy(new NextRequest('https://ops.dalaieej.mn/api/sales')).status, 401);
  assert.equal(proxy(new NextRequest('https://ops.dalaieej.mn/register')).headers.get('location'), 'https://ops.dalaieej.mn/login?next=%2Fregister');
  assert.equal(proxy(new NextRequest('https://ops.dalaieej.mn/api/health')).headers.get('x-middleware-next'), '1');
});

test('legacy receipt bookmarks redirect to the corresponding standalone pages', async () => {
  const redirects = await load('next.config.ts').default.redirects();
  for (const path of ['reconciliation', 'receipt-payments']) {
    assert.ok(redirects.some(rule => rule.source === `/${path}/:path*` && rule.destination === `https://receipts.dalaieej.mn/${path}/:path*` && rule.permanent));
  }
});

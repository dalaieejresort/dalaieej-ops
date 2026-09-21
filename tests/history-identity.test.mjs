import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/pos/history.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('exports', compiled)(loaded.exports);
const { getHistoryEntryKey } = loaded.exports;

test('separate payments against the same bill have distinct identities', () => {
  const payments = [
    { transactionId: 'BILL-20260721-000220', receiptId: 'R-1', paidAmount: 50000 },
    { transactionId: 'BILL-20260721-000220', receiptId: 'R-2', paidAmount: 300 },
  ];
  assert.equal(new Set(payments.map(getHistoryEntryKey)).size, 2);
});

test('receipt identity survives refreshed amounts, reordered orders and new history entries', () => {
  const selected = { receiptId: 'R-2', transactionId: 'ORDER-1, ORDER-2', balance: 5000 };
  const refreshed = { ...selected, transactionId: 'ORDER-2, ORDER-1', balance: 0 };
  assert.equal(getHistoryEntryKey(selected), getHistoryEntryKey(refreshed));
  assert.notEqual(getHistoryEntryKey(selected), getHistoryEntryKey({ ...selected, receiptId: 'R-3' }));
});

test('legacy history without receipts keeps a stable, separate transaction identity', () => {
  const legacy = { transactionId: 'BILL-1' };
  assert.equal(getHistoryEntryKey(legacy), getHistoryEntryKey({ ...legacy, receiptId: '' }));
  assert.notEqual(getHistoryEntryKey(legacy), getHistoryEntryKey({ transactionId: 'BILL-2' }));
  assert.notEqual(getHistoryEntryKey(legacy), getHistoryEntryKey({ ...legacy, receiptId: 'BILL-1' }));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../lib/pos/operational-checks.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('exports', source)(loaded.exports);
const { needsOperationalAttention, lowStockProducts } = loaded.exports;

test('checks stay quiet when healthy but never hide pending operations or read failures', () => {
  assert.equal(needsOperationalAttention(null, [], []), false);
  assert.equal(needsOperationalAttention({ status: 'healthy' }, [], []), false);
  assert.equal(needsOperationalAttention({ status: 'attention' }, [], []), true);
  assert.equal(needsOperationalAttention({ status: 'healthy' }, [{ requestId: 'unfinished' }], []), true);
  assert.equal(needsOperationalAttention({ status: 'healthy' }, [], ['read failed']), true);
  assert.equal(needsOperationalAttention(null, [], ['read failed']), true);
});

test('stock alerts include all low tracked stock, exclude unlimited food, and preserve catalogue order', () => {
  const products = [
    { sku: 'normal', tracked: true, stock: 4 },
    { sku: 'food', tracked: false, stock: 0 },
    { sku: 'boundary', tracked: true, stock: 3 },
    { sku: 'negative', tracked: true, stock: -1 },
    ...Array.from({ length: 30 }, (_, index) => ({ sku: `zero-${index}`, tracked: true, stock: 0 })),
  ];
  const before = structuredClone(products);
  const alerts = lowStockProducts(products);
  assert.equal(alerts.length, 32);
  assert.equal(alerts[0].sku, 'negative');
  assert.equal(alerts.at(-1).sku, 'boundary');
  assert.ok(alerts.every(item => item.sku !== 'food' && item.sku !== 'normal'));
  assert.deepEqual(products, before);
});

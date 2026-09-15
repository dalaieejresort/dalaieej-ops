import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/pos/cart.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('exports', compiled)(loaded.exports);
const { cartReducer } = loaded.exports;

const item = (id, quantity = 1, price = 27000) => ({
  id, name: id, quantity, price, category: 'Food', staff: 'Waiter',
});
const basket = items => ({ items, lastAddition: null });
const add = (state, value) => cartReducer(state, { type: 'add', item: value });
const undo = state => cartReducer(state, { type: 'undo-addition' });
const total = state => state.items.reduce((sum, line) => sum + line.price * line.quantity, 0);

test('undo removes a newly added item while preserving the existing basket and total', () => {
  const before = basket([item('soup', 2)]);
  const after = add(before, item('salad'));
  assert.equal(total(after), 81000);
  const restored = undo(after);
  assert.deepEqual(restored, before);
  assert.equal(total(restored), 54000);
  assert.deepEqual(before.items, [item('soup', 2)]);
  assert.strictEqual(undo(restored), restored);
});

test('undo reverses one repeated product tap, not the whole line or earlier additions', () => {
  const before = basket([item('soup', 2)]);
  const firstTap = add(before, item('soup'));
  const secondTap = add(firstTap, item('soup'));
  assert.equal(secondTap.items[0].quantity, 4);
  assert.equal(undo(secondTap).items[0].quantity, 3);
  assert.equal(before.items[0].quantity, 2);
});

test('guest and staff price lines stay separate when undoing an addition', () => {
  const before = basket([item('soup:guest', 2), item('soup:staff', 1, 15000)]);
  const after = add(before, item('soup:staff', 1, 15000));
  assert.equal(after.items[1].quantity, 2);
  assert.deepEqual(undo(after), before);
});

test('the first addition can be undone back to an empty basket', () => {
  const before = basket([]);
  assert.deepEqual(undo(add(before, item('custom'))), before);
});

test('clear, save, restore and quantity edits invalidate the previous addition', () => {
  const added = add(basket([item('soup')]), item('salad'));
  for (const replacement of [[], [item('other-order')], items => items.map(line => ({ ...line, quantity: 5 }))]) {
    const changed = cartReducer(added, { type: 'replace', items: replacement });
    assert.equal(changed.lastAddition, null);
    assert.strictEqual(undo(changed), changed);
  }
});

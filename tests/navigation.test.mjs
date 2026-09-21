import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = ts.transpileModule(
  readFileSync(new URL('../lib/pos/navigation.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('exports', source)(loaded.exports);
const items = role => loaded.exports.operationsNavigation(role).flatMap(section => section.items);

test('navigation respects the different staff workspaces and owner-only archive', () => {
  for (const role of ['waiter', 'cashier', 'kitchen']) {
    assert.ok(items(role).every(item => !['products', 'ops', 'archive', 'finance'].includes(item.id)));
  }
  assert.deepEqual(items('kitchen').map(item => item.id), ['kitchen']);
  assert.ok(items('waiter').every(item => item.tab && item.tab !== 'day-close'));
  assert.ok(!items('cashier').some(item => item.id === 'kitchen'));
  assert.ok(items('manager').some(item => item.id === 'products'));
  assert.ok(!items('manager').some(item => item.id === 'archive'));
  assert.ok(items('owner').some(item => item.id === 'archive'));
});

test('staff with desktop access always get desktop destinations; restricted waiters keep their permitted workspace', () => {
  for (const [role, base] of [['owner', '/register'], ['manager', '/register'], ['cashier', '/register'], ['waiter', '/waiter']]) {
    for (const item of items(role).filter(item => item.tab)) {
      const url = new URL(item.href, 'https://ops.dalaieej.mn');
      assert.equal(url.pathname, base);
      assert.equal(url.searchParams.get('tab'), item.tab);
    }
  }
});


test('the daily overview is removed for every role while closing and stock remain accessible', () => {
  for (const role of ['waiter', 'cashier', 'kitchen', 'manager', 'owner']) {
    assert.ok(items(role).every(item => item.href !== '/ops' && item.id !== 'ops'));
  }
  for (const role of ['manager', 'owner']) {
    assert.ok(items(role).some(item => item.tab === 'day-close'));
    assert.ok(items(role).some(item => item.href === '/products'));
  }
});

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
const items = (role, service = false) => loaded.exports.operationsNavigation(role, service).flatMap(section => section.items);

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

test('cross-page tab links target the selected register or waiter workflow', () => {
  for (const [role, service, base] of [['owner', false, '/register'], ['cashier', false, '/register'], ['waiter', false, '/waiter'], ['owner', true, '/waiter']]) {
    for (const item of items(role, service).filter(item => item.tab)) {
      const url = new URL(item.href, 'https://ops.dalaieej.mn');
      assert.equal(url.pathname, base);
      assert.equal(url.searchParams.get('tab'), item.tab);
    }
  }
});

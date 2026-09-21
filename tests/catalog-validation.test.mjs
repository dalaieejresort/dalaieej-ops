import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(
  readFileSync(new URL('../lib/pos/catalog-validation.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const loaded = { exports: {} };
new Function('exports', compiled)(loaded.exports);
const { validateCatalogSkus } = loaded.exports;
const product = (sku, name) => ({ id: sku, sku, name, price: 1000, category: 'Food' });

test('Bebeto and Mentos sharing a SKU are both withheld while other products remain available', () => {
  const unaffected = product('INV-0206', 'Water');
  const catalog = [product('INV-0205', 'Bebeto'), product('INV-0205', 'Mentos'), unaffected];
  const result = validateCatalogSkus(catalog);
  assert.deepEqual(result.items, [unaffected]);
  assert.deepEqual(result.conflicts, [{ sku: 'INV-0205', names: ['Bebeto', 'Mentos'] }]);
  assert.equal(catalog.length, 3);
});

test('whitespace and letter casing cannot disguise duplicate SKUs in live or cached data', () => {
  const result = validateCatalogSkus([product(' inv-0205 ', 'Bebeto'), product('INV-0205', 'Mentos')]);
  assert.equal(result.items.length, 0);
  assert.equal(result.conflicts.length, 1);
});

test('correcting the duplicate restores both products on the next validation', () => {
  const catalog = [product('INV-0205', 'Bebeto'), product('INV-0207', 'Mentos')];
  assert.deepEqual(validateCatalogSkus(catalog), { items: catalog, conflicts: [] });
});

test('packaged food remains counted stock even when its name contains a dessert keyword',()=>{
 const source=ts.transpileModule(readFileSync(new URL('../lib/pos/inventory.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const inventoryModule={exports:{}};new Function('exports',source)(inventoryModule.exports);
 const {isUnlimitedInventoryItem}=inventoryModule.exports;
 assert.equal(isUnlimitedInventoryItem({sku:'INV-0038',category:'Бэлэн хүнс',name:'Lotte chocopie 4ш 112гр'}),false);
 assert.equal(isUnlimitedInventoryItem({category:'Дессерт',name:'Apple pie'}),true);
 assert.equal(isUnlimitedInventoryItem({category:'',name:'Apple pie'}),true);
 assert.equal(isUnlimitedInventoryItem({sku:'INV-0188',category:'Архи',name:'Hennessy shot'}),true);
});

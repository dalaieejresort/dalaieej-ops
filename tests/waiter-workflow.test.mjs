import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
function load(path, mocks = {}) {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const loaded={exports:{}};
  new Function('require','module','exports',compiled)(name=>{if(name==='server-only')return {};if(name in mocks)return mocks[name];throw new Error(`Unmocked dependency: ${name}`);},loaded,loaded.exports);
  return loaded.exports;
}
const preparation=load('lib/pos/preparation.ts');
const {waiterPaymentError}=load('lib/pos/waiter-payment.ts');
test('waiters record cash, card and transfer payments without requiring references',()=>{
  assert.equal(waiterPaymentError({paymentMethod:'Бэлэн',amount:12000}),null);
  for(const method of ['Карт','Данс']) {
    assert.equal(waiterPaymentError({paymentMethod:method,amount:12000}),null);
    assert.equal(waiterPaymentError({paymentMethod:method,amount:12000,notes:'  '}),null);
    assert.equal(waiterPaymentError({paymentMethod:method,amount:12000,notes:'Terminal 123, 12000 MNT'}),null);
  }
  for(const method of ['Бэлэн','Карт','Данс']) {
    for(const amount of [0,-1,NaN,Infinity])assert.ok(waiterPaymentError({paymentMethod:method,amount}));
  }
  for(const paymentMethod of ['',undefined,'Өр'])assert.ok(waiterPaymentError({paymentMethod,amount:12000}));
});
test('POS ticket and kitchen queue use the same food routing, including salad and pizza',()=>{
  for(const name of ['Ногоотой шөл','Грек салат','Пицца','Сүүтэй цай'])assert.equal(preparation.isKitchenTicketItem({name}),true,name);
  for(const name of ['Цэвэр ус','Печень','Зайрмаг'])assert.equal(preparation.isKitchenTicketItem({name}),false,name);
});
test('kitchen handoff retains table, billing account and preparation notes; replay preserves readiness; edits create a new revision',async()=>{
  const saved=new Map();
  const redis={hget:async(_key,id)=>saved.get(id),hdel:async(_key,id)=>saved.delete(id),pipeline(){let entry;return {hset(_key,value){entry=value;return this;},expire(){return this;},async exec(){for(const [key,value]of Object.entries(entry))saved.set(key,value);}};}};
  const {syncKitchenOrder}=load('lib/server/kitchen-queue.ts',{'@upstash/redis':{Redis:{fromEnv:()=>redis}},'@/lib/pos/preparation':preparation});
  const input={orderId:'TEST',businessDate:'2026-09-14',roomOrGuest:'7',serviceTable:'12',preparationNotes:'Сонгиногүй',staff:'Waiter A',items:[{sku:'SALAD',name:'Грек салат',qty:2}]};
  const first=await syncKitchenOrder(input);
  assert.equal(first.serviceTable,'12');assert.equal(first.roomOrGuest,'7');assert.equal(first.preparationNotes,'Сонгиногүй');assert.equal(first.items[0].quantity,2);
  saved.set('TEST',{...first,status:'ready'});
  const replay=await syncKitchenOrder(input);assert.equal(replay.status,'ready');assert.equal(replay.revision,first.revision);
  const edited=await syncKitchenOrder({...input,preparationNotes:'Давсгүй'});assert.equal(edited.status,'new');assert.equal(edited.revision,first.revision+1);
});

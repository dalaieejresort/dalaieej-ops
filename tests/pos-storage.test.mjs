import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';
import {Pool as NeonPool,neonConfig} from '@neondatabase/serverless';
import {randomBytes} from 'node:crypto';
const root=path.resolve(new URL('..',import.meta.url).pathname),nativeRequire=createRequire(import.meta.url);
class JsonResponse extends Response {static json(v,o){return new JsonResponse(JSON.stringify(v),o);}}
async function fixture() {
 const hosted=process.env.POS_HOSTED_TEST_URL;
 const schema=hosted?'pos_test_workflow_'+randomBytes(8).toString('hex'):'pos';
 process.env.POS_DATABASE_SCHEMA=schema;
 neonConfig.webSocketConstructor=globalThis.WebSocket;
 const nativePool=hosted?new NeonPool({connectionString:hosted,max:6}):null;
 const rewrite=sql=>sql.replaceAll('pos.',`"${schema}".`).replace('CREATE SCHEMA IF NOT EXISTS pos;',`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
 const db=nativePool?{
  query:(sql,params)=>nativePool.query(rewrite(sql),params),
  exec:async sql=>{for(const part of rewrite(sql).split(';').filter(x=>x.trim()))await nativePool.query(part);},
  close:async()=>{await nativePool.query(`DROP SCHEMA "${schema}" CASCADE`);await nativePool.end();},
 }:new PGlite();
 await db.exec(readFileSync(path.join(root,'lib/server/pos-storage/schema.sql'),'utf8'));
 let failure=false,queue=Promise.resolve();const effects=[];
 const query=async(sql,params=[])=>{
  if(!hosted && sql.includes('pg_advisory_xact_lock'))return {rows:[]};
  if(failure && sql.includes(`INSERT INTO "${schema}".records`)){failure=false;throw Error('Injected storage failure');}
  return db.query(sql,params);
 };
 class Pool {async connect(){
  if(nativePool){const client=await nativePool.connect();return {query:async(sql,params)=>{
   if(failure && sql.includes(`INSERT INTO "${schema}".records`)){failure=false;throw Error('Injected storage failure');}
   return client.query(sql,params);
  },release:()=>client.release()};}
  let release;const prior=queue;queue=new Promise(r=>{release=r;});await prior;return {query,release};}query=query;}
 const cache=new Map();
 const noProjection=new Proxy({}, {get:()=>async()=>{}});
 const mocks={
  'server-only':{},'@neondatabase/serverless':{Pool,neonConfig:{}},
  'next/server':{NextResponse:JsonResponse,after:fn=>effects.push(fn)},
  '@/lib/server/auth':{requireApiSession:request=>request.headers.get('test-role')?{role:request.headers.get('test-role'),displayName:'Test owner',username:'owner'}:JsonResponse.json({error:'Unauthorized'},{status:401})},
  '@/lib/server/kitchen-queue':noProjection,'@/lib/server/live-order-board':noProjection,'@/lib/server/management-board':noProjection,
  'google-spreadsheet':{GoogleSpreadsheet:class {constructor(){throw Error('Unexpected Sheets access');}}},'google-auth-library':{JWT:class{}},
 };
 function load(file) {
  if(cache.has(file))return cache.get(file);
  const source=readFileSync(file,'utf8'),compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};cache.set(file,mod.exports);
  new Function('require','module','exports',compiled)(name=>{
   if(name in mocks)return mocks[name];
   if(name.startsWith('@/')||name.startsWith('.')){
    const base=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(file),name);
    return load(existsSync(base+'.ts')?base+'.ts':path.join(base,'index.ts'));
   }
   return nativeRequire(name);
  },mod,mod.exports);cache.set(file,mod.exports);return mod.exports;
 }
 process.env.POS_STORAGE_BACKEND='postgres';process.env.POS_DATABASE_URL='postgres://isolated.invalid/test';delete process.env.POS_WRITES_PAUSED;
 const storage=load(path.join(root,'lib/server/pos-storage/index.ts'));
 const tx=load(path.join(root,'lib/server/pos-storage/transaction.ts'));
 await tx.withPosTransaction(async()=>{
  const doc=storage.createPosDocument();await doc.loadInfo();
  const cat=await doc.addSheet({title:'Inventory_Catalogue',headerValues:['SKU (Барааны код)','Item Name (Барааны нэр)','Category (Ангилал)','Employee Price (Ажчилчдын үнэ)','Guest Price (Амрагчдын үнэ)','Preferred Supplier (Үндсэн нийлүүлэгч)','Reorder Point (Доод хэмжээ)','Current Stock (Үлдэгдэл)']});
  await cat.addRows([['INV-TEST','Цэвэр ус','Ус',1000,1000,'',2,10]]);
  const inv=await doc.addSheet({title:'Inventory_Log',headerValues:['Transaction ID','Timestamp','SKU (Барааны код)','Item Description','Type (Хөдөлгөөн)','Quantity (Тоо)','Location (Байршил)','Handled By','Payment Method','Room Number']});
  await inv.addRows([['OPENING','','INV-TEST','Цэвэр ус','Орлого',10,'Тек','Test owner','','']]);
 });
 async function request(route,method='GET',body,role='owner') {
  const url=new URL(route,'http://localhost');const api=load(path.join(root,'app',url.pathname,'route.ts'));
  const response=await api[method](new Request(url,{method,headers:{'content-type':'application/json',...(role?{'test-role':role}:{})},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
 }
 const records=async title=>(await db.query('SELECT fields FROM pos.named_records WHERE title=$1 ORDER BY row_number',[title])).rows.map(r=>r.fields);
 const stock=async()=>Number((await db.query('SELECT quantity FROM pos.stock_balances WHERE sku=$1',['INV-TEST'])).rows[0]?.quantity??0);
 return {db,request,records,stock,tx,storage,fail:()=>{failure=true;}};
}
const sale=(id,extra={})=>({clientRequestId:id,items:[{sku:'INV-TEST',name:'Цэвэр ус',category:'Ус',qty:2,unitPrice:1000}],method:'Бэлэн',paidStatus:'paid',total:2000,cashReceived:2000,...extra});
test('PostgreSQL POS preserves complete sale/replay/refund/stock/day workflow',async()=>{
 const f=await fixture();try {
  assert.equal((await f.request('/api/inventory','GET',null,null)).status,401);
  const opened=await f.request('/api/day','POST',{action:'open',startingCash:5000,clientRequestId:'open-1'});assert.equal(opened.status,200,JSON.stringify(opened));
  const first=await f.request('/api/inventory','POST',sale('sale-1'));assert.equal(first.status,200,JSON.stringify(first));
  assert.equal(await f.stock(),8);assert.equal((await f.records('Sales_Log')).length,1);assert.equal((await f.records('Payments_Log')).length,1);assert.equal((await f.records('Order_Items')).length,1);
  const replay=await f.request('/api/inventory','POST',sale('sale-1'));assert.equal(replay.status,200);assert.equal((await f.records('Sales_Log')).length,1);assert.equal(await f.stock(),8);
  const conflicting=await f.request('/api/inventory','POST',sale('sale-1',{total:1999}));assert.equal(conflicting.status,409);
  const tx=(await f.records('Sales_Log'))[0].transaction_id;
  const refund=await f.request('/api/voids','POST',{transactionId:tx,clientRequestId:'void-1',reason:'Test return',refundMethod:'Бэлэн'});assert.equal(refund.status,200,JSON.stringify(refund));
  assert.equal(await f.stock(),10);assert.equal((await f.records('Payments_Log')).length,2);
  const again=await f.request('/api/voids','POST',{transactionId:tx,clientRequestId:'void-1',reason:'Test return',refundMethod:'Бэлэн'});assert.equal(again.status,200);assert.equal(await f.stock(),10);
  const adjusted=await f.request('/api/inventory-adjustments','POST',{clientRequestId:'adjust-1',reason:'Counted stock',adjustments:[{sku:'INV-TEST',quantityDelta:3}]});assert.equal(adjusted.status,200,JSON.stringify(adjusted));assert.equal(await f.stock(),13);
  const catalog=await f.request('/api/inventory');assert.equal(catalog.status,200);assert.equal(catalog.data[0].stock,13);
  const closed=await f.request('/api/day','POST',{action:'close',countedCash:5000,clientRequestId:'close-1'});assert.equal(closed.status,200,JSON.stringify(closed));
  assert.equal((await f.records('Day_Sessions'))[0].status,'closed');
 }finally{await f.db.close();}
});
test('failed writes and rejected responses roll back claims, row allocation, audit, and deferred effects',async()=>{
 const f=await fixture();try {
  await f.request('/api/day','POST',{action:'open',startingCash:0,clientRequestId:'open-2'});
  f.fail();const failed=await f.request('/api/inventory','POST',sale('retry-1'));assert.equal(failed.status,500);assert.equal((await f.records('Sales_Log')).length,0);assert.equal(await f.stock(),10);
  const retry=await f.request('/api/inventory','POST',sale('retry-1'));assert.equal(retry.status,200,JSON.stringify(retry));assert.equal((await f.records('Sales_Log')).length,1);
  let sideEffect=false;
  await f.tx.withPosTransaction(async()=>{f.tx.deferPosEffect(async()=>{sideEffect=true;});const doc=f.storage.createPosDocument();await doc.loadInfo();await doc.sheetsByTitle.Sales_Log.addRows([{}]);return {ok:false};},r=>r.ok);
  assert.equal(sideEffect,false);assert.equal((await f.records('Sales_Log')).length,1);
  process.env.POS_WRITES_PAUSED='true';assert.equal((await f.request('/api/inventory','POST',sale('paused'))).status,503);delete process.env.POS_WRITES_PAUSED;
 }finally{await f.db.close();}
});
test('concurrent duplicate submissions retain one sale, one receipt, and one stock movement',async()=>{
 const f=await fixture();try {
  await f.request('/api/day','POST',{action:'open',startingCash:0,clientRequestId:'open-3'});
  const results=await Promise.all(Array.from({length:3},()=>f.request('/api/inventory','POST',sale('concurrent'))));
  for(const r of results)assert.equal(r.status,200,JSON.stringify(r));
  assert.equal((await f.records('Sales_Log')).length,1);assert.equal((await f.records('Receipts_Log')).length,1);assert.equal(await f.stock(),8);
 }finally{await f.db.close();}
});

test('unpaid edits and split settlement preserve order items, claims, replay, and stock',async()=>{
 const f=await fixture();try {
  await f.request('/api/day','POST',{action:'open',startingCash:0,clientRequestId:'open-4'});
  const unpaid=await f.request('/api/inventory','POST',sale('unpaid-1',{paidStatus:'unpaid',method:'Өр',room:'101'}));assert.equal(unpaid.status,200,JSON.stringify(unpaid));
  const transactionId=(await f.records('Sales_Log'))[0].transaction_id;
  const edit=await f.request('/api/sales','PATCH',{action:'edit_unpaid',transactionId,clientRequestId:'edit-1',items:[{sku:'INV-TEST',name:'Цэвэр ус',category:'Ус',qty:3,unitPrice:1000}],total:3000,room:'101'});assert.equal(edit.status,200,JSON.stringify(edit));assert.equal(await f.stock(),7);
  const body={action:'settle',transactionId,clientRequestId:'settle-1',payments:[{paymentMethod:'Бэлэн',amount:1000,cashReceived:1000},{paymentMethod:'Карт',amount:2000}]};
  const results=await Promise.all([f.request('/api/sales','PATCH',body),f.request('/api/sales','PATCH',body)]);
  for(const r of results)assert.equal(r.status,200,JSON.stringify(r));
  assert.equal((await f.records('Payments_Log')).length,2);assert.equal((await f.records('Receipts_Log')).length,1);assert.equal(await f.stock(),7);
  assert.equal(results[0].data.balance,0);
  assert.equal((await f.records('Payments_Log')).reduce((n,p)=>n+Number(p.amount),0),3000);
 }finally{await f.db.close();}
});

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
 async function request(route,method='GET',body,role='owner',headers={}) {
  const url=new URL(route,'http://localhost');const api=load(path.join(root,'app',url.pathname,'route.ts'));
  const response=await api[method](new Request(url,{method,headers:{'content-type':'application/json',...(role?{'test-role':role}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}));
  return {status:response.status,data:await response.json()};
 }
 const records=async title=>(await db.query('SELECT fields FROM pos.named_records WHERE title=$1 ORDER BY row_number',[title])).rows.map(r=>r.fields);
 const stock=async()=>Number((await db.query('SELECT quantity FROM pos.stock_balances WHERE sku=$1',['INV-TEST'])).rows[0]?.quantity??0);
 return {db,request,records,stock,tx,storage,load,fail:()=>{failure=true;}};
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

test('product creation and stock receiving are unique, replay-safe and work before cash opening',async()=>{
 const f=await fixture();try {
  assert.equal((await f.request('/api/products','GET',null,null)).status,401);
  const create={action:'create',clientRequestId:'product-1',name:'New bottled water',category:'Ус',guestPrice:2500,staffPrice:2000};
  const pair=await Promise.all([f.request('/api/products','POST',create),f.request('/api/products','POST',create)]);
  assert.ok(pair.every(r=>r.status===200),JSON.stringify(pair));assert.equal(pair[0].data.sku,pair[1].data.sku);
  const sku=pair[0].data.sku;
  assert.equal((await f.records('Inventory_Catalogue')).filter(r=>r['SKU (Барааны код)']===sku).length,1);
  assert.equal((await f.request('/api/products','POST',{...create,clientRequestId:'product-2'})).status,400);
  assert.equal((await f.request('/api/products','POST',{...create,name:'Changed'})).status,400);
  const receive={action:'receive',clientRequestId:'stock-1',sku,kind:'opening',quantity:12,reason:'Physical opening count'};
  assert.equal((await f.request('/api/products','POST',receive)).status,200);
  assert.equal((await f.request('/api/products','POST',receive)).status,200);
  let list=await f.request('/api/products');assert.equal(list.data.products.find(p=>p.sku===sku).stock,12);
  assert.equal((await f.request('/api/products','POST',{...receive,clientRequestId:'stock-2'})).status,400);
  assert.equal((await f.request('/api/products','POST',{...receive,clientRequestId:'stock-3',kind:'delivery',quantity:3})).status,200);
  list=await f.request('/api/products');assert.equal(list.data.products.find(p=>p.sku===sku).stock,15);
  assert.equal((await f.request('/api/products','POST',{...receive,clientRequestId:'invalid-1',sku:'INV-NOT-FOUND'})).status,400);
  assert.equal((await f.request('/api/products','POST',{...receive,clientRequestId:'invalid-2',quantity:-2})).status,400);
  assert.equal((await f.records('Day_Sessions')).length,0);
 }finally{await f.db.close();}
});
test('season generation rejects old screens without writes and accepts the refreshed client',async()=>{
 const f=await fixture();try {
  process.env.POS_DATA_GENERATION='new-season';
  const payload={action:'create',name:'Season product',category:'Ус',guestPrice:1000,staffPrice:900,clientRequestId:'season-client'};
  const before=(await f.records('Inventory_Catalogue')).length;
  assert.equal((await f.request('/api/products','POST',payload)).status,409);
  assert.equal((await f.request('/api/products','POST',payload,'owner',{'x-pos-generation':'old-season'})).status,409);
  assert.equal((await f.records('Inventory_Catalogue')).length,before);
  assert.equal((await f.request('/api/products')).status,200);
  assert.equal((await f.request('/api/products','POST',payload,'owner',{'x-pos-generation':'new-season'})).status,200);
 }finally{delete process.env.POS_DATA_GENERATION;await f.db.close();}
});


test('hotel task claims, idempotency, conflicts, audit and room readiness remain atomic',async()=>{
 const f=await fixture();try {
  const hotel=f.load(path.join(root,'lib/server/hotel.ts'));
  const now=new Date().toISOString(), today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar'}).format(new Date());
  await f.tx.withPosTransaction(async()=>{const doc=f.storage.createPosDocument();await doc.loadInfo();const sheet=await doc.addSheet({title:'Hotel_Feed',headerValues:['key','data','updated_at']});await sheet.addRows([{key:'current',data:JSON.stringify({date:today,through:today,checkedAt:now,rooms:[{id:'room1',name:'1',type:'Cabin',blocked:false}],reservations:[]}),updated_at:now}]);});
  const a={username:'cleaner-a',displayName:'Cleaner A',role:'housekeeping'},b={username:'cleaner-b',displayName:'Cleaner B',role:'housekeeping'};
  const save=(input,actor=a)=>f.tx.withPosTransaction(()=>hotel.saveHotel(input,actor));
  const create={action:'create-task',requestId:'task-create',roomId:'room1',kind:'cleaning',title:'Clean room'};
  const task=await save(create);assert.equal((await save(create)).id,task.id);assert.equal((await f.records('Hotel_Tasks')).length,1);
  await assert.rejects(save({...create,title:'Different task'}),/давхардсан/);
  await assert.rejects(save({action:'task',requestId:'early-done',id:task.id,version:1,change:'done'},b),/Эхлээд/);
  const claimed=await save({action:'task',requestId:'claim-a',id:task.id,version:1,change:'claim'});assert.equal(claimed.assignee,a.username);
  await assert.rejects(save({action:'task',requestId:'claim-b',id:task.id,version:1,change:'claim'},b),/өөр ажилтан/);
  await assert.rejects(save({action:'task',requestId:'done-b',id:task.id,version:2,change:'done'},b),/Эхлээд/);
  const done=await save({action:'task',requestId:'done-a',id:task.id,version:2,change:'done'});assert.equal(done.status,'done');
  const ready={action:'readiness',requestId:'ready',roomId:'room1',version:0,status:'ready',note:'Inspected'};
  const state=await save(ready);assert.equal(state.version,1);assert.equal((await save(ready)).version,1);
  await assert.rejects(save({...ready,requestId:'stale',status:'dirty'}),/Өөр ажилтан/);
  const before=(await f.records('Hotel_Operations')).length;f.fail();await assert.rejects(save({action:'task',requestId:'failed',id:task.id,version:3,change:'note',note:'Should roll back'}));
  assert.equal((await f.records('Hotel_Operations')).length,before);
  assert.equal(JSON.parse((await f.records('Hotel_Tasks'))[0].data).notes.length,0);
 }finally{await f.db.close();}
});

test('hotel source failure retains the last feed, redacts housekeeping data and blocks stale ready confirmations',async()=>{
 const f=await fixture();const oldFetch=globalThis.fetch,oldURL=process.env.HOTEL_FEED_URL,oldToken=process.env.HOTEL_FEED_TOKEN;
 try {
  const hotel=f.load(path.join(root,'lib/server/hotel.ts'));const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar'}).format(new Date());
  const feed={date:today,through:today,checkedAt:'2020-01-01T00:00:00Z',rooms:[{id:'r',name:'1'}],reservations:[{id:'s',propertyId:'private-property',guestName:'Private Guest',status:'confirmed',rooms:[]}]};
  await f.tx.withPosTransaction(async()=>{const doc=f.storage.createPosDocument();await doc.loadInfo();const sheet=await doc.addSheet({title:'Hotel_Feed',headerValues:['key','data','updated_at']});await sheet.addRows([{key:'current',data:JSON.stringify(feed),updated_at:feed.checkedAt}]);});
  process.env.HOTEL_FEED_URL='https://hotel.invalid';process.env.HOTEL_FEED_TOKEN='test-token';globalThis.fetch=async()=>{throw Error('Simulated upstream outage');};
  const session={username:'cleaner',displayName:'Cleaner',role:'housekeeping'};
  const board=await hotel.hotelBoard(session);assert.equal(board.stale,true);assert.equal(board.feed.rooms.length,1);assert.equal(board.feed.reservations[0].guestName,'');assert.equal(board.feed.reservations[0].propertyId,'');assert.ok(board.error);
  await assert.rejects(f.tx.withPosTransaction(()=>hotel.saveHotel({requestId:'stale-ready',action:'readiness',roomId:'r',version:0,status:'ready',note:''},session)),/Cloudbeds/);
  assert.equal((await f.records('Hotel_Rooms')).length,0);
 }finally{globalThis.fetch=oldFetch;if(oldURL===undefined)delete process.env.HOTEL_FEED_URL;else process.env.HOTEL_FEED_URL=oldURL;if(oldToken===undefined)delete process.env.HOTEL_FEED_TOKEN;else process.env.HOTEL_FEED_TOKEN=oldToken;await f.db.close();}
});

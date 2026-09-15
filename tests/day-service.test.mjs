import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const nativeRequire=createRequire(import.meta.url);
function loader(mocks) {
  const cache=new Map();
  function load(path) {
    if(cache.has(path))return cache.get(path);
    const compiled=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const module={exports:{}}; cache.set(path,module.exports);
    new Function('require','module','exports',compiled)(name=>{
      if(name==='server-only')return {};
      if(name in mocks)return mocks[name];
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      return nativeRequire(name);
    },module,module.exports);
    cache.set(path,module.exports);return module.exports;
  }
  return load;
}
class JsonResponse extends Response {static json(value,options){return new JsonResponse(JSON.stringify(value),options);}}
function fixture() {
  const rows=[],payments=[];
  const row=value=>({value,rowNumber:rows.length+2,get:key=>value[key],set:(key,next)=>{value[key]=next;},save:async()=>{}});
  const sheet={headerValues:[],columnCount:100,loadHeaderRow:async()=>{},setHeaderRow:async()=>{},getRows:async()=>rows,addRows:async values=>values.map(value=>{const r=row(value);rows.push(r);return r;})};
  const empty={...sheet,getRows:async()=>[]};
  const doc={loadInfo:async()=>{},sheetsByTitle:{Day_Sessions:sheet,Sales_Log:empty,Payments_Log:{...empty,getRows:async()=>payments}}};
  let held=false, unavailable=false;
  const lock={acquireDayWriteLock:async()=>{if(unavailable)throw Error('offline');if(held)return null;held=true;return {assertOwned:async()=>{},release:async()=>{held=false;}};}};
  const auth={requireApiSession(request,minimum){const role=request.headers.get('test-role');const rank={kitchen:0,waiter:0,cashier:1,manager:2,owner:3};return role && rank[role]>=rank[minimum]?{role,displayName:`Name ${role}`,username:`id-${role}`} : JsonResponse.json({error:'forbidden'},{status:role?403:401});}};
  const load=loader({
    'google-spreadsheet':{GoogleSpreadsheet:class{constructor(){return doc;}}},
    'google-auth-library':{JWT:class{}},
    'next/server':{NextResponse:JsonResponse,after:()=>{}},
    '@/lib/server/auth':auth,
    '@/lib/server/day-write-lock':lock,
    '@/lib/server/read-cache':{clearCachedReads:()=>{},getCachedRead:(_k,_t,fn)=>fn()},
    '@/lib/server/business-day-guard':{staleBusinessDayResponse:()=>null},
    '@/lib/server/management-board':{mergeManagementBoardSectionSafely:async()=>{}},
    '@/lib/server/order-items':{ORDER_ITEMS_SHEET_TITLES:['Order_Items']},
  });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL='test@example.invalid';
  process.env.GOOGLE_PRIVATE_KEY='-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----';
  process.env.GOOGLE_SHEET_ID='isolated-test';
  const {POST}=load('app/api/day/route.ts');let requestNumber=0;
  const send=async(role,action,extra={})=>{const response=await POST(new Request('http://localhost/api/day',{method:'POST',headers:{'test-role':role,'content-type':'application/json'},body:JSON.stringify({action,clientRequestId:`request-${++requestNumber}`,...extra})}));return {status:response.status,data:await response.json()};};
  return {rows,send,addPayment:value=>payments.push(row(value)),setUnavailable:()=>{unavailable=true;},addRow:value=>rows.push(row(value))};
}
test('service opens without cash confirmation; cashier confirms separately without resetting orders or service attribution',async()=>{
  const f=fixture();
  const start=await f.send('waiter','start-service',{staffName:'Forged owner'});
  assert.equal(start.status,200);assert.equal(start.data.session.cashOpened,false);assert.equal(start.data.session.startingCash,0);
  assert.equal(f.rows[0].value.opened_by,'Name waiter');assert.equal(f.rows[0].value.opened_by_username,'id-waiter');
  assert.equal((await f.send('manager','close',{countedCash:0})).status,409);
  f.addPayment({business_date:start.data.businessDate,payment_method:'Бэлэн',amount:12000,staff:'Name waiter',transaction_id:'ORDER-1'});
  const cash=await f.send('cashier','open',{startingCash:50000});
  assert.equal(cash.status,200);assert.equal(cash.data.session.cashOpened,true);assert.equal(cash.data.totals.expectedCash,62000);assert.equal(cash.data.totals.cashPaymentTotal,12000);
  assert.equal(f.rows.length,1);assert.equal(cash.data.session.sessionId,start.data.session.sessionId);
  assert.equal(f.rows[0].value.opened_by,'Name waiter');assert.equal(f.rows[0].value.cash_opened_by_username,'id-cashier');
  assert.equal((await f.send('cashier','open',{startingCash:70000})).status,409);
  assert.equal((await f.send('cashier','open',{startingCash:50000})).status,200);
  assert.equal((await f.send('manager','close',{countedCash:62000})).status,200);
  assert.equal((await f.send('waiter','start-service')).status,409);
});
test('permissions and cash injection are enforced by the API',async()=>{
  const f=fixture();
  for(const action of ['open','close'])assert.equal((await f.send('waiter',action,{startingCash:100})).status,403);
  assert.equal((await f.send('kitchen','start-service')).status,403);
  assert.equal((await f.send('waiter','start-service',{startingCash:100})).status,400);
  assert.equal((await f.send('cashier','open')).status,400);
  assert.equal(f.rows.length,0);
});
test('simultaneous service starts and retries cannot create two sessions',async()=>{
  const f=fixture();
  const results=await Promise.all([f.send('waiter','start-service'),f.send('waiter','start-service')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.send('waiter','start-service')).status,200);
  assert.equal(f.rows.length,1);
});
test('coordination outage fails closed before writing a day',async()=>{
  const f=fixture();f.setUnavailable();assert.equal((await f.send('waiter','start-service')).status,503);assert.equal(f.rows.length,0);
});
test('existing cashier workflow still opens with cash and closes; legacy rows remain cash-confirmed',async()=>{
  const f=fixture();const result=await f.send('cashier','open',{startingCash:0});
  assert.equal(result.status,200);assert.equal(result.data.session.cashOpened,true);
  delete f.rows[0].value.opening_mode;delete f.rows[0].value.cash_opened_at;
  assert.equal((await f.send('waiter','start-service')).data.session.cashOpened,true);
  assert.equal((await f.send('manager','close',{countedCash:0})).status,200);
});

test('distributed lock rejects concurrent holders and old owners cannot release a newer lock',async()=>{
  let value;
  const redis={set:async(_k,next)=>{if(value)return null;value=next;return 'OK';},get:async()=>value,eval:async(_script,_keys,[token])=>{if(value===token)value=undefined;}};
  const load=loader({'@upstash/redis':{Redis:{fromEnv:()=>redis}}});
  const {acquireDayWriteLock}=load('lib/server/day-write-lock.ts');
  const first=await acquireDayWriteLock();assert.ok(first);assert.equal(await acquireDayWriteLock(),null);
  value=undefined;const second=await acquireDayWriteLock();assert.ok(second);
  await assert.rejects(first.assertOwned(),/expired/);await first.release();
  await second.assertOwned();await second.release();assert.ok(await acquireDayWriteLock());
});

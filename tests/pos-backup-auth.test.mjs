import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {timingSafeEqual} from 'node:crypto';
import {NextRequest,NextResponse} from 'next/server.js';
import ts from 'typescript';
function load(file,mocks){const mod={exports:{}};const js=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',js)(name=>{if(name in mocks)return mocks[name];throw Error('Unexpected '+name);},mod,mod.exports);return mod.exports;}
test('scheduled backup uses bearer authentication without opening other POS routes',async()=>{
 const previous=process.env.CRON_SECRET;let backups=0;
 const {proxy}=load('proxy.ts',{'next/server':{NextResponse}});
 const {GET}=load('app/api/cron/pos-backup/route.ts',{'node:crypto':{timingSafeEqual},'@/lib/server/pos-storage/transaction':{posBackend:()=> 'postgres'},'@/lib/server/pos-storage/backup':{archivePosDatabase:async()=>{backups++;return {records:1};}}});
 try {
  const request=token=>new NextRequest('https://ops.dalaieej.mn/api/cron/pos-backup',{headers:token?{authorization:'Bearer '+token}:{}});
  assert.equal(proxy(request()).headers.get('x-middleware-next'),'1');
  assert.equal(proxy(new NextRequest('https://ops.dalaieej.mn/api/sales')).status,401);
  assert.equal(proxy(new NextRequest('https://ops.dalaieej.mn/api/cron/anything-else')).status,401);
  delete process.env.CRON_SECRET;assert.equal((await GET(request('undefined'))).status,401);
  process.env.CRON_SECRET='test-only-backup-secret';
  assert.equal((await GET(request())).status,401);assert.equal((await GET(request('wrong'))).status,401);assert.equal(backups,0);
  assert.equal((await GET(request(process.env.CRON_SECRET))).status,200);assert.equal(backups,1);
 }finally{if(previous===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=previous;}
});

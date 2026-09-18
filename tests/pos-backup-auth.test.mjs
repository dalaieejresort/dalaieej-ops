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

test('deployed backup checksum survives JSON serialization of database timestamps',async()=>{
 const {createHash}=await import('node:crypto');const {hash}=await import('../scripts/pos-storage.mjs');
 const oldUrl=process.env.POS_DATABASE_URL,oldToken=process.env.POS_BACKUP_BLOB_TOKEN;
 let stored='';
 const sql={query:()=>({}),transaction:async()=>[[{id:1}],[{updated_at:new Date('2026-09-18T00:00:00Z')}],[],[]]};
 const {archivePosDatabase}=load('lib/server/pos-storage/backup.ts',{
  'server-only':{},'node:crypto':{createHash},'@neondatabase/serverless':{neon:()=>sql},'./transaction':{posSchema:()=> '"pos"'},
  '@vercel/blob':{put:async(_name,body)=>{stored=body;return {url:'private-test',pathname:'pos/test.json'};},get:async()=>({stream:new Response(stored).body})},
 });
 try {
  process.env.POS_DATABASE_URL='test-only';process.env.POS_BACKUP_BLOB_TOKEN='test-only';
  await archivePosDatabase();const {sha256,...data}=JSON.parse(stored);assert.equal(sha256,hash(data));
  assert.equal(data.tables.records[0].updated_at,'2026-09-18T00:00:00.000Z');
 }finally{for(const [k,v] of [['POS_DATABASE_URL',oldUrl],['POS_BACKUP_BLOB_TOKEN',oldToken]]){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
});

test('CLI backup checksum has the same meaning before and after saving a file',async()=>{
 const {hash}=await import('../scripts/pos-storage.mjs');
 const record={updated_at:new Date('2026-09-18T00:00:00.123Z'),version:'1',cells:['example',1]};
 assert.equal(hash(record),hash(JSON.parse(JSON.stringify(record))));
});

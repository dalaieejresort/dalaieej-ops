import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { dateValue, seasonFor, planArchive, resetLive, verifyOffline } from '../scripts/pos-season-archive.mjs';
import { backup, hash } from '../scripts/pos-storage.mjs';
test('season boundaries match receipts and dates preserve undated evidence',()=>{
 assert.equal(seasonFor('2026-08-31'),'2026');assert.equal(seasonFor('2026-09-01'),'2027');assert.equal(seasonFor(''),'undated');
 assert.equal(dateValue('2026.07.23'),'2026-07-23');assert.equal(dateValue('7/23/2026, 1:00:00 PM'),'2026-07-23');assert.equal(dateValue(46218),'2026-07-15');assert.equal(dateValue('2026-02-30'),'');
});
test('archive preserves recovery data and counters, empties activity, and refuses a changed source',async()=>{
 const pg=new PGlite();const sql={query:(text,values=[])=>({text,values,then:(resolve,reject)=>pg.query(text,values).then(r=>r.rows).then(resolve,reject)}),transaction:jobs=>pg.transaction(async tx=>{const out=[];for(const job of jobs){if(job.text.includes('pg_advisory_xact_lock')){out.push([]);continue;}out.push((await tx.query(job.text,job.values)).rows);}return out;})};
 try {
  await pg.exec(await readFile(new URL('../lib/server/pos-storage/schema.sql',import.meta.url),'utf8'));
  await pg.query(`INSERT INTO pos.datasets(id,title,headers,next_row) VALUES(1,'Inventory_Catalogue','["SKU (Барааны код)","Current Stock (Үлдэгдэл)"]',50),(2,'Inventory_Log','["Business Date","Quantity (Тоо)"]',80),(3,'Sales_Log','["business_date","transaction_id"]',102)`);
  await pg.query(`INSERT INTO pos.records(dataset_id,row_number,cells,raw_cells) VALUES(1,2,'["INV-0001",9]','["INV-0001",9]'),(2,2,'["2026.08.31",9]','["2026.08.31",9]'),(2,3,'["",2]','["",2]'),(3,101,'["2026.09.01","ORD-20260901-000100"]','["2026.09.01","ORD-20260901-000100"]')`);
  const snap=await backup(sql);const plan=planArchive(snap);assert.equal(plan['2026'].records.length,1);assert.equal(plan['2027'].records.length,1);assert.equal(plan.undated.records.length,1);
  assert.equal((await verifyOffline(snap)).verified,true);
  const hosted=JSON.parse(JSON.stringify(snap));for(const row of hosted.tables.records)row.version=String(row.version);
  delete hosted.sha256;hosted.sha256=hash(hosted);
  assert.equal((await verifyOffline(hosted)).verified,true);
  await pg.query(`UPDATE pos.records SET updated_at='2026-09-18 08:25:18.597391+00'`);
  const precise=await backup(sql,'pos',{preserveTimestamps:true});
  assert.equal(precise.tables.records[0].updated_at,'2026-09-18T08:25:18.597391Z');
  assert.equal((await verifyOffline(precise)).verified,true);
  // Restore the earlier fixture timestamps before its unchanged-source checks.
  for(const row of snap.tables.records)await pg.query('UPDATE pos.records SET updated_at=$3 WHERE dataset_id=$1 AND row_number=$2',[row.dataset_id,row.row_number,row.updated_at]);
  await pg.query(`UPDATE pos.datasets SET next_row=103 WHERE id=3`);
  await assert.rejects(resetLive(sql,snap,[]));assert.equal((await pg.query('SELECT count(*)::int n FROM pos.records')).rows[0].n,4);
  await pg.query(`UPDATE pos.datasets SET next_row=102 WHERE id=3`);
  const result=await resetLive(sql,snap,[{record_id:'test',label:'Season 2026',season_year:'2026',record_count:1,counts_json:'{}'}]);assert.equal(result.preservedCatalogue,1);
  const after=await backup(sql);assert.equal(after.tables.records.length,2);assert.equal(after.tables.records.find(r=>r.dataset_id===1).raw_cells[1],0);
  assert.equal(after.tables.datasets.find(d=>d.id===3).next_row,102);assert.equal(snap.tables.records.length,4);
 }finally{await pg.close();}
});

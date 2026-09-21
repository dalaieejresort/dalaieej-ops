import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { neon } from '@neondatabase/serverless';
import { put, get } from '@vercel/blob';
import { PGlite } from '@electric-sql/pglite';
import { backup, hash, restore } from './pos-storage.mjs';

export const archiveHeaders=['record_id','label','season_year','start_date','end_date','created_at','record_count','counts_json','blob_url','sha256','kind'];
const activity=new Set(['Inventory_Log','Sales_Log','Payments_Log','Receipts_Log','Day_Sessions','Voids_Log','Order_Items','Merged_Sales_Data','Product_Operations']);
export function dateValue(value) {
 if(typeof value==='number'&&value>20000&&value<100000)return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
 const s=String(value??'').trim();let m=s.match(/^(\d{4})[.\/-](\d{2})[.\/-](\d{2})/);let date=m?`${m[1]}-${m[2]}-${m[3]}`:'';
 if(!date){m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,|\s|$)/);if(m)date=`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;}
 return date&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date?date:'';
}
export function seasonFor(date) {if(!date)return 'undated';return String(Number(date.slice(0,4))+(Number(date.slice(5,7))>=9?1:0));}
export function planArchive(snapshot) {
 const datasets=new Map(snapshot.tables.datasets.map(d=>[d.id,d]));const rows=snapshot.tables.records.map(row=>({row,table:datasets.get(row.dataset_id),fields:Object.fromEntries(datasets.get(row.dataset_id).headers.map((h,i)=>[h,row.raw_cells[i]??'']))}));
 const rowDate=r=>dateValue(r.fields.business_date)||dateValue(r.fields['Business Date'])||dateValue(r.fields.timestamp)||dateValue(r.fields.Timestamp)||dateValue(r.fields.opened_at)||dateValue(r.fields.created_at);
 const parentDates=new Map(rows.filter(r=>r.table.title==='Sales_Log').map(r=>[String(r.fields.transaction_id),rowDate(r)]));
 const seasons={};
 for(const r of rows){if(!activity.has(r.table.title))continue;const date=rowDate(r)||parentDates.get(String(r.fields.transaction_id||r.fields['Transaction ID']))||'';const year=seasonFor(date);const bucket=seasons[year]??={counts:{},records:[]};bucket.counts[r.table.title]=(bucket.counts[r.table.title]||0)+1;bucket.records.push(r.row);}
 const unknown=snapshot.tables.datasets.filter(d=>!activity.has(d.title)&&!['Inventory_Catalogue','Inventory_Catalog','POS_Archives'].includes(d.title));if(unknown.length)throw Error('Unclassified POS datasets: '+unknown.map(d=>d.title).join(', '));
 return seasons;
}
export async function resetLive(sql,snapshot,manifests,schema='pos') {
 if(!/^pos(?:_[a-z0-9_]+)?$/.test(schema))throw Error('Invalid schema');
 const cat=snapshot.tables.datasets.find(d=>['Inventory_Catalogue','Inventory_Catalog'].includes(d.title));if(!cat)throw Error('Missing catalogue');
 const stockIndex=cat.headers.indexOf('Current Stock (Үлдэгдэл)');if(stockIndex<0)throw Error('Missing stock column');
 const existingArchive=snapshot.tables.datasets.find(d=>d.title==='POS_Archives');const archiveId=existingArchive?.id??Math.max(...snapshot.tables.datasets.map(d=>d.id))+1;const first=existingArchive?.next_row??2;
 const archiveRows=manifests.map((m,i)=>({dataset_id:archiveId,row_number:first+i,cells:archiveHeaders.map(h=>m[h]??'')}));
 const queries=[sql.query('SELECT pg_advisory_xact_lock(hashtext($1))',['dalaieej:'+JSON.stringify(schema)])];
 // Abort the entire transaction if anything changed since the verified backup.
 for(const table of ['datasets','records','imports','audit'])queries.push(sql.query(`SELECT 1 / CASE WHEN NOT EXISTS ((SELECT * FROM "${schema}".${table} EXCEPT SELECT * FROM jsonb_populate_recordset(NULL::"${schema}".${table},$1::jsonb)) UNION ALL (SELECT * FROM jsonb_populate_recordset(NULL::"${schema}".${table},$1::jsonb) EXCEPT SELECT * FROM "${schema}".${table})) THEN 1 ELSE 0 END AS snapshot_unchanged`,[JSON.stringify(snapshot.tables[table])]));
 queries.push(sql.query(`INSERT INTO "${schema}".datasets(id,title,headers,next_row) VALUES($1,'POS_Archives',$2::jsonb,$3) ON CONFLICT(title) DO UPDATE SET next_row=$3`,[archiveId,JSON.stringify(archiveHeaders),first+archiveRows.length]));
 queries.push(sql.query(`DELETE FROM "${schema}".records WHERE dataset_id NOT IN ($1,$2)`,[cat.id,archiveId]));
 queries.push(sql.query(`UPDATE "${schema}".records SET cells=jsonb_set(cells,ARRAY[$2::text],'0'::jsonb),raw_cells=jsonb_set(raw_cells,ARRAY[$2::text],'0'::jsonb),version=version+1,updated_at=now() WHERE dataset_id=$1`,[cat.id,String(stockIndex)]));
 queries.push(sql.query(`DELETE FROM "${schema}".audit`));
 queries.push(sql.query(`INSERT INTO "${schema}".records(dataset_id,row_number,cells,raw_cells) SELECT dataset_id,row_number,cells,cells FROM jsonb_to_recordset($1::jsonb) AS x(dataset_id int,row_number int,cells jsonb)`,[JSON.stringify(archiveRows)]));
 queries.push(sql.query(`INSERT INTO "${schema}".audit(dataset_id,row_number,action,after_cells) SELECT dataset_id,row_number,'season_archive',cells FROM "${schema}".records WHERE dataset_id=$1 AND row_number >= $2`,[archiveId,first]));
 await sql.transaction(queries);
 return {archiveId,manifests:archiveRows.length,preservedCatalogue:snapshot.tables.records.filter(r=>r.dataset_id===cat.id).length};
}
export async function verifyOffline(snapshot) {
 // Match Neon's lossless bigint strings; local fixtures use PGlite numbers.
 const stringBigints=snapshot.tables.records.some(row=>typeof row.version==='string');
 const db=new PGlite(stringBigints?{parsers:{20:value=>value}}:{});
 const sql={query:(text,values=[])=>({text,values,then:(resolve,reject)=>db.query(text,values).then(r=>r.rows).then(resolve,reject)}),transaction:jobs=>db.transaction(async tx=>{const out=[];for(const job of jobs)out.push((await tx.query(job.text,job.values)).rows);return out;})};
 try{return await restore(sql,snapshot,'pos_restore_season');}finally{await db.close();}
}
async function main(){
 const [command,directory,adminFile,backupFile]=process.argv.slice(2);if(!['preview','apply'].includes(command)||!directory||!adminFile)throw Error('Usage: preview|apply output-directory admin-env backup-env');
 const env=parseEnv(await readFile(adminFile,'utf8'));const sql=neon(env.RECEIPT_PAYMENTS_DATABASE_URL||env.POS_DATABASE_URL);const snapshot=await backup(sql,'pos',{preserveTimestamps:true});const seasons=planArchive(snapshot);
 await mkdir(directory,{recursive:true});await writeFile(`${directory}/snapshot.json`,JSON.stringify(snapshot),{mode:0o600,flag:'wx'});
 const summary={snapshotHash:snapshot.sha256,createdAt:snapshot.createdAt,seasons:Object.fromEntries(Object.entries(seasons).map(([year,b])=>[year,{counts:b.counts,records:b.records.length}])),catalogue:snapshot.tables.records.filter(r=>snapshot.tables.datasets.find(d=>d.id===r.dataset_id)?.title==='Inventory_Catalogue').length};
 await writeFile(`${directory}/plan.json`,JSON.stringify(summary,null,2),{mode:0o600});console.log(JSON.stringify(summary));if(command==='preview')return;
 if(!backupFile)throw Error('Backup-store credentials required');const tokens=parseEnv(await readFile(backupFile,'utf8'));const token=tokens.POS_BACKUP_BLOB_TOKEN||tokens.FINANCE_BACKUP_READ_WRITE_TOKEN;if(!token)throw Error('No backup token');
 const manifests=[];const upload=async(body,metadata)=>{
  const bytes=JSON.stringify(body),sha256=createHash('sha256').update(bytes).digest('hex');const id=randomUUID();
  const blob=await put(`pos/season-archives/${snapshot.createdAt.replaceAll(':','-')}/${metadata.kind}-${metadata.season_year||'all'}.json`,bytes,{token,access:'private',contentType:'application/json',addRandomSuffix:true});
  const fetched=await get(blob.url,{token,access:'private',useCache:false});if(!fetched?.stream||await new Response(fetched.stream).text()!==bytes)throw Error('Archive download verification failed');
  manifests.push({...metadata,record_id:id,created_at:snapshot.createdAt,blob_url:blob.url,sha256});
 };
 await upload(snapshot,{kind:'full',label:'Complete pre-reset recovery backup',season_year:'',start_date:'',end_date:'',record_count:snapshot.tables.records.length,counts_json:JSON.stringify(Object.fromEntries(snapshot.tables.datasets.map(d=>[d.title,snapshot.tables.records.filter(r=>r.dataset_id===d.id).length])))});
 for(const [year,b]of Object.entries(seasons)){
  const dated=year!=='undated';const metadata={kind:'season',label:dated?`Season ${year}`:'Undated historical records',season_year:year,start_date:dated?`${Number(year)-1}-09-01`:'',end_date:dated?`${year}-08-31`:'',record_count:b.records.length,counts_json:JSON.stringify(b.counts)};
  const keys=new Set(b.records.map(r=>`${r.dataset_id}:${r.row_number}`));const body={format:'dalaieej-pos-season-v1',...metadata,created_at:snapshot.createdAt,sourceSnapshotHash:snapshot.sha256,datasets:snapshot.tables.datasets,records:b.records,audit:snapshot.tables.audit.filter(a=>keys.has(`${a.dataset_id}:${a.row_number}`))};await upload(body,metadata);
 }
 await writeFile(`${directory}/manifests.json`,JSON.stringify(manifests,null,2),{mode:0o600});
 const recovery=await verifyOffline(snapshot);await writeFile(`${directory}/recovery.json`,JSON.stringify(recovery),{mode:0o600});
 const result=await resetLive(sql,snapshot,manifests);const after=await backup(sql,'pos',{preserveTimestamps:true});
 const remaining=after.tables.records.filter(r=>{const title=after.tables.datasets.find(d=>d.id===r.dataset_id)?.title;return !['Inventory_Catalogue','Inventory_Catalog','POS_Archives'].includes(title);});if(remaining.length)throw Error('Activity remains after reset');
 const catalogue=after.tables.datasets.find(d=>['Inventory_Catalogue','Inventory_Catalog'].includes(d.title));const stockIndex=catalogue.headers.indexOf('Current Stock (Үлдэгдэл)');
 if(after.tables.records.some(r=>r.dataset_id===catalogue.id&&(Number(r.cells[stockIndex])!==0||Number(r.raw_cells[stockIndex])!==0)))throw Error('Catalogue stock is not zero');
 for(const d of snapshot.tables.datasets){if(d.title==='POS_Archives')continue;const newD=after.tables.datasets.find(x=>x.id===d.id);if(newD.next_row!==d.next_row)throw Error('Serial counter changed');}
 const {sha256,...content}=snapshot;if(hash(content)!==sha256)throw Error('Local snapshot checksum mismatch');
 await writeFile(`${directory}/after.json`,JSON.stringify(after),{mode:0o600});await writeFile(`${directory}/result.json`,JSON.stringify({...result,verified:true,serialCountersPreserved:true},null,2),{mode:0o600});console.log(JSON.stringify({...result,verified:true,serialCountersPreserved:true}));
}
if(process.argv[1]===new URL(import.meta.url).pathname)main().catch(e=>{console.error(e.message);process.exitCode=1;});

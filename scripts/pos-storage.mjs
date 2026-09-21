import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {neon} from '@neondatabase/serverless';

export function canonical(value) {
  if(value instanceof Date)return JSON.stringify(value.toJSON());
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
function value(cell) {const v=cell.effectiveValue??{};return v.stringValue??v.numberValue??v.boolValue??cell.formattedValue??'';}
export async function prepare(directory) {
  const datasets=new Map(),source=[];
  for(const file of readdirSync(directory).filter(x=>x.endsWith('.json')).sort()) {
    const data=JSON.parse(await readFile(path.join(directory,file),'utf8'));source.push(data);
    for(const sheet of data.sheets) {
      const props=sheet.properties;
      if(!datasets.has(props.sheetId))datasets.set(props.sheetId,{id:props.sheetId,title:props.title,headers:[],row_count:props.gridProperties.rowCount,column_count:props.gridProperties.columnCount,records:[]});
      const table=datasets.get(props.sheetId);
      for(const block of sheet.data??[])for(let i=0;i<(block.rowData??[]).length;i++) {
        const rowNumber=(block.startRow??0)+i+1,cells=block.rowData[i].values??[];
        if(rowNumber===1){table.headers=cells.map(c=>String(value(c)).trim());continue;}
        if(!cells.some(c=>c.effectiveValue||c.userEnteredValue))continue;
        table.records.push({row_number:rowNumber,cells:cells.map(c=>c.formattedValue??value(c)),raw_cells:cells.map(value)});
      }
    }
  }
  const tables=[...datasets.values()].sort((a,b)=>a.id-b.id);
  for(const table of tables) {
    if(!table.headers.length)throw Error(`Missing headers: ${table.title}`);
    const nonblank=table.headers.filter(Boolean);if(new Set(nonblank).size!==nonblank.length)throw Error(`Duplicate headers: ${table.title}`);
    table.records.sort((a,b)=>a.row_number-b.row_number);
    table.next_row=Math.max(1,...table.records.map(r=>r.row_number))+1;
  }
  const stock=new Map();
  const inv=tables.find(t=>t.title==='Inventory_Log');
  for(const row of inv.records) {
    const fields=Object.fromEntries(inv.headers.map((h,i)=>[h,row.raw_cells[i]??'']));
    const type=fields['Type (Хөдөлгөөн)'],sku=String(fields['SKU (Барааны код)']);
    const qty=Number(fields['Quantity (Тоо)'])||0;
    stock.set(sku,(stock.get(sku)??0)+(type==='Зарлага'?-qty:['Орлого','Буцаалт'].includes(type)?qty:0));
  }
  const catalog=tables.find(t=>t.title==='Inventory_Catalogue');
  const stockIndex=catalog.headers.indexOf('Current Stock (Үлдэгдэл)'),skuIndex=catalog.headers.indexOf('SKU (Барааны код)');
  const stockDifferences=catalog.records.flatMap(r=>{const sku=String(r.raw_cells[skuIndex]??'');const actual=Number(r.raw_cells[stockIndex]??0),calculated=stock.get(sku)??0;return Math.abs(actual-calculated)>1e-8?[{sku,actual,calculated}]:[];});
  if(stockDifferences.length)throw Error('Stock does not reconcile: '+JSON.stringify(stockDifferences));
  const totals={};
  for(const table of tables) {
    const numeric={};
    for(const key of ['total','subtotal','amount','refund_amount','starting_cash','counted_cash','expected_cash','Quantity (Тоо)']) {
      const index=table.headers.indexOf(key);if(index<0)continue;
      numeric[key]=table.records.reduce((sum,r)=>sum+(Number(String(r.raw_cells[index]??'').replace(/[,\s]/g,''))||0),0);
    }
    totals[table.title]={rows:table.records.length,lastRow:table.next_row-1,totals:numeric,sha256:hash(table.records)};
  }
  return {format:'dalaieej-pos-source-v1',sourceId:source[0].spreadsheetId,sourceSha256:hash(source),source,tables,totals,stockVerified:catalog.records.length};
}
function schemaName() {const s=process.env.POS_DATABASE_SCHEMA||'pos';if(!/^pos(?:_[a-z0-9_]+)?$/.test(s))throw Error('Invalid schema');return s;}
export async function database() {if(!process.env.POS_DATABASE_URL)throw Error('POS_DATABASE_URL required');return neon(process.env.POS_DATABASE_URL);}
export async function install(sql,schema=schemaName()) {
 const ddl=(await readFile(new URL('../lib/server/pos-storage/schema.sql',import.meta.url),'utf8')).replaceAll('pos.',`"${schema}".`).replace('CREATE SCHEMA IF NOT EXISTS pos;',`CREATE SCHEMA IF NOT EXISTS "${schema}";`);
 await sql.transaction(ddl.split(';').map(s=>s.trim()).filter(Boolean).map(s=>sql.query(s)));
}
export async function importSnapshot(sql,snapshot,schema=schemaName()) {
 if(snapshot.format!=='dalaieej-pos-source-v1'||hash(snapshot.source)!==snapshot.sourceSha256)throw Error('Invalid source snapshot/checksum');
 await install(sql,schema);
 const [existing]=await sql.query(`SELECT count(*)::int AS n FROM "${schema}".datasets`);
 if(existing.n)throw Error('Refusing import into a nonempty POS schema');
 const datasets=snapshot.tables.map(t=>Object.fromEntries(Object.entries(t).filter(([key])=>key!=='records')));
 const records=snapshot.tables.flatMap(t=>t.records.map(r=>({...r,dataset_id:t.id})));
 await sql.transaction([
 sql.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,['dalaieej:'+JSON.stringify(schema)]),
 sql.query(`INSERT INTO "${schema}".datasets(id,title,headers,row_count,column_count,next_row) SELECT id,title,headers,row_count,column_count,next_row FROM jsonb_to_recordset($1::jsonb) AS x(id integer,title text,headers jsonb,row_count integer,column_count integer,next_row integer)`,[JSON.stringify(datasets)]),
 sql.query(`INSERT INTO "${schema}".records(dataset_id,row_number,cells,raw_cells) SELECT dataset_id,row_number,cells,raw_cells FROM jsonb_to_recordset($1::jsonb) AS x(dataset_id integer,row_number integer,cells jsonb,raw_cells jsonb)`,[JSON.stringify(records)]),
 sql.query(`INSERT INTO "${schema}".imports(source_sha256,source_id,manifest) VALUES($1,$2,$3::jsonb)`,[snapshot.sourceSha256,snapshot.sourceId,JSON.stringify({totals:snapshot.totals,stockVerified:snapshot.stockVerified})]),
 ]);
 return verifySnapshot(sql,snapshot,schema);
}
export async function verifySnapshot(sql,snapshot,schema=schemaName()) {
 const datasets=await sql.query(`SELECT * FROM "${schema}".datasets ORDER BY id`);
 if(datasets.length!==snapshot.tables.length)throw Error('Dataset count differs');
 for(const source of snapshot.tables) {
  const actual=datasets.find(d=>d.id===source.id);
  if(!actual||hash(actual.headers)!==hash(source.headers)||actual.next_row!==source.next_row)throw Error(`Metadata differs: ${source.title}`);
  const records=await sql.query(`SELECT row_number,cells,raw_cells FROM "${schema}".records WHERE dataset_id=$1 ORDER BY row_number`,[source.id]);
  if(hash(records)!==hash(source.records))throw Error(`Records differ: ${source.title}`);
 }
 const stocks=await sql.query(`SELECT sku,quantity::text FROM "${schema}".stock_balances`);
 const catalog=snapshot.tables.find(t=>t.title==='Inventory_Catalogue'),skuI=catalog.headers.indexOf('SKU (Барааны код)'),stockI=catalog.headers.indexOf('Current Stock (Үлдэгдэл)');
 const m=new Map(stocks.map(r=>[r.sku,Number(r.quantity)]));
 for(const r of catalog.records)if(Math.abs((m.get(String(r.raw_cells[skuI]))??0)-Number(r.raw_cells[stockI]??0))>1e-8)throw Error('SQL stock differs');
 return {verified:true,datasets:datasets.length,records:snapshot.tables.reduce((n,t)=>n+t.records.length,0),stockVerified:snapshot.stockVerified,sourceSha256:snapshot.sourceSha256,totals:snapshot.totals};
}
export async function backup(sql,schema=schemaName(),{preserveTimestamps=false}={}) {
 // One database transaction captures all tables at one consistent snapshot.
 const timestamps={records:'updated_at',imports:'imported_at',audit:'recorded_at'};
 // JavaScript Date truncates PostgreSQL microseconds. Cutover snapshots must
 // preserve them to support an exact source comparison before clearing data.
 const result=await sql.transaction(['datasets','records','imports','audit'].map(table=>sql.query(`SELECT *${preserveTimestamps&&timestamps[table]?`,to_char(${timestamps[table]} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS ${timestamps[table]}`:''} FROM "${schema}".${table} ORDER BY ${table==='records'?'dataset_id,row_number':table==='imports'?'source_sha256':'id'}`)),{isolationLevel:'RepeatableRead',readOnly:true});
 const data={format:'dalaieej-pos-backup-v1',createdAt:new Date().toISOString(),schema,tables:Object.fromEntries(['datasets','records','imports','audit'].map((name,i)=>[name,result[i]]))};
 return {...data,sha256:hash(data)};
}
export async function restore(sql,archive,schema=schemaName()) {
 const {sha256,...data}=archive;if(data.format!=='dalaieej-pos-backup-v1'||hash(data)!==sha256)throw Error('Backup checksum mismatch');
 if(!schema.startsWith('pos_restore_')&&!schema.startsWith('pos_test_'))throw Error('Restore requires a new pos_restore_ or pos_test_ schema');
 const exists=await sql.query('SELECT 1 FROM information_schema.schemata WHERE schema_name=$1',[schema]);if(exists.length)throw Error('Restore schema already exists');
 await install(sql,schema);
 const queries=[];
 for(const [table,rows] of Object.entries(data.tables)) {
  // jsonb_populate_recordset preserves PostgreSQL timestamps, numeric strings and JSON.
  queries.push(sql.query(`INSERT INTO "${schema}".${table} ${table==='audit'?'OVERRIDING SYSTEM VALUE ':''}SELECT * FROM jsonb_populate_recordset(NULL::"${schema}".${table},$1::jsonb)`,[JSON.stringify(rows)]));
 }
 queries.push(sql.query(`SELECT setval(pg_get_serial_sequence('"${schema}".audit','id'),GREATEST(COALESCE((SELECT max(id) FROM "${schema}".audit),0),1),EXISTS(SELECT 1 FROM "${schema}".audit))`));
 await sql.transaction(queries);
 const preserveTimestamps=Object.entries({records:'updated_at',imports:'imported_at',audit:'recorded_at'}).some(([table,key])=>data.tables[table].some(row=>typeof row[key]==='string'&&/\.\d{6}Z$/.test(row[key])));
 const copy=await backup(sql,schema,{preserveTimestamps});
 for(const table of Object.keys(data.tables))if(hash(data.tables[table])!==hash(copy.tables[table]))throw Error('Restore comparison failed: '+table);
 return {verified:true,schema,sha256};
}
async function main() {
 const [command,input,output]=process.argv.slice(2);
 let result;
 if(command==='prepare')result=await prepare(input);
 else {
  const sql=await database();
  if(command==='backup')result=await backup(sql);
  else {const data=JSON.parse(await readFile(input,'utf8'));if(command==='import')result=await importSnapshot(sql,data);else if(command==='verify')result=await verifySnapshot(sql,data);else if(command==='restore')result=await restore(sql,data);else throw Error('Unknown command');}
 }
 if(output){await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result),{flag:'wx',mode:0o600});console.log('Saved',output);}
 else console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]===new URL(import.meta.url).pathname) main().catch(e=>{console.error(e.message);process.exitCode=1;});

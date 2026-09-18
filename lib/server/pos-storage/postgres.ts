import type { ApiOptions, PosDocument, PosRow, PosWorksheet, Query } from './types';

type Dataset={id:number; title:string; headers:string[]; row_count:number; column_count:number};
type StoredRow={row_number:number; cells:unknown[]; raw_cells:unknown[]; version:string|number};
type Cell={userEnteredValue?:{numberValue?:number;boolValue?:boolean;stringValue?:string}};
type BatchRequest={appendCells?:{sheetId:number;rows:{values:Cell[]}[]};updateCells?:{range:{sheetId:number;startRowIndex:number;startColumnIndex:number};rows:{values:Cell[]}[]}};
const cellValue=(cell:Cell)=>cell.userEnteredValue?.numberValue ?? cell.userEnteredValue?.boolValue ?? cell.userEnteredValue?.stringValue ?? '';
const encoded=(value:unknown)=>JSON.stringify(value);

export class PostgresDocument implements PosDocument {
  sheetsByTitle:Record<string,PostgresWorksheet>={};
  constructor(readonly query:Query, readonly schema:string) {}
  async loadInfo() {
    const result=await this.query(`SELECT * FROM ${this.schema}.datasets ORDER BY id`);
    this.sheetsByTitle={};
    for(const row of result.rows) { const sheet=new PostgresWorksheet(this,row as unknown as Dataset);this.sheetsByTitle[sheet.title]=sheet; }
  }
  async addSheet(options:{title:string;headerValues:readonly string[]}) {
    const result=await this.query(`INSERT INTO ${this.schema}.datasets(id,title,headers)
      SELECT COALESCE(MAX(id),0)+1,$1,$2::jsonb FROM ${this.schema}.datasets
      ON CONFLICT(title) DO UPDATE SET title=EXCLUDED.title RETURNING *`,[options.title,encoded(options.headerValues)]);
    const sheet=new PostgresWorksheet(this,result.rows[0] as unknown as Dataset);
    this.sheetsByTitle[sheet.title]=sheet;return sheet;
  }
  private byId(id:number) {
    const sheet=Object.values(this.sheetsByTitle).find(s=>s.sheetId===id);
    if(!sheet) throw new Error('Unknown POS dataset');return sheet;
  }
  sheetsApi={
    get:async(path:string,options?:ApiOptions)=>{
      if(!path.startsWith('values:batchGet?')) throw new Error('Unsupported POS read');
      const ranges=new URLSearchParams(path.split('?')[1]).getAll('ranges');
      const valueRanges: {values: unknown[][]}[]=[];
      for(const range of ranges) {
        const title=range.slice(0,range.lastIndexOf('!')).replace(/^'|'$/g,'').replaceAll("''", "'");
        const sheet=this.sheetsByTitle[title];if(!sheet) throw new Error('Unknown POS dataset');
        valueRanges.push({values:await sheet.values(options?.searchParams?.valueRenderOption==='UNFORMATTED_VALUE')});
      }
      return {json:async()=>({valueRanges})};
    },
    post:async(path:string,options?:ApiOptions)=>{
      if(path===':batchUpdate') {
        const {requests} = options?.json as {requests:BatchRequest[]};
        for(const request of requests) {
          if(request.appendCells) {
            const sheet=this.byId(request.appendCells.sheetId);
            await sheet.addRows(request.appendCells.rows.map(row=>row.values.map(cellValue)));
          } else if(request.updateCells) {
            const {range,rows}=request.updateCells;
            if(range.startColumnIndex!==0||rows.length!==1) throw new Error('Unsupported POS partial update');
            await this.byId(range.sheetId).writeRow(range.startRowIndex+1,rows[0].values.map(cellValue));
          } else throw new Error('Unsupported POS batch mutation');
        }
        return {json:async()=>({})};
      }
      if(path.startsWith('values/')&&path.endsWith('!A1:append')) {
        const title=decodeURIComponent(path.slice(7,-10)).replace(/^'|'$/g,'').replaceAll("''", "'");
        const sheet=this.sheetsByTitle[title];if(!sheet) throw new Error('Unknown POS claim dataset');
        const rows=await sheet.addRows((options?.json as {values:unknown[][]}).values);
        return {json:async()=>({updates:{updatedRange:`${sheet.a1SheetName}!A${rows[0].rowNumber}:Z${rows[0].rowNumber}`}})};
      }
      throw new Error('Unsupported POS mutation');
    },
  };
}
class PostgresWorksheet implements PosWorksheet {
  constructor(readonly doc:PostgresDocument, private data:Dataset) {}
  get sheetId(){return this.data.id;} get title(){return this.data.title;}
  get headerValues(){return this.data.headers;} get rowCount(){return this.data.row_count;}
  get columnCount(){return this.data.column_count;}
  get a1SheetName(){return "'"+this.title.replaceAll("'","''")+"'";}
  get encodedA1SheetName(){return encodeURIComponent(this.a1SheetName);}
  async loadHeaderRow() {
    const r=await this.doc.query(`SELECT * FROM ${this.doc.schema}.datasets WHERE id=$1`,[this.sheetId]);
    if(!r.rows[0])throw new Error('Missing POS dataset');this.data=r.rows[0] as unknown as Dataset;
  }
  async setHeaderRow(headers:readonly string[]) {
    // Existing column positions cannot be changed silently during a live migration.
    if(this.headerValues.some((h,i)=>headers[i]!==h))throw new Error('POS headers may only be extended');
    await this.doc.query(`UPDATE ${this.doc.schema}.datasets SET headers=$2::jsonb,column_count=GREATEST(column_count,$3) WHERE id=$1`,[this.sheetId,encoded(headers),headers.length]);
    this.data.headers=[...headers];
  }
  async resize(size:{rowCount:number;columnCount:number}) {
    await this.doc.query(`UPDATE ${this.doc.schema}.datasets SET row_count=GREATEST(row_count,$2),column_count=GREATEST(column_count,$3) WHERE id=$1`,[this.sheetId,size.rowCount,size.columnCount]);
    this.data.row_count=Math.max(this.rowCount,size.rowCount);this.data.column_count=Math.max(this.columnCount,size.columnCount);
  }
  private async storedRows() {
    const result=await this.doc.query(`SELECT row_number,cells,raw_cells,version FROM ${this.doc.schema}.records WHERE dataset_id=$1 ORDER BY row_number`,[this.sheetId]);
    const rows=result.rows as unknown as StoredRow[];
    if(['Inventory_Catalogue','Inventory_Catalog','inventory_catalogue','inventory_catalog'].includes(this.title)) {
      const stocks=await this.doc.query(`SELECT sku,quantity::text FROM ${this.doc.schema}.stock_balances`);
      const bySku=new Map(stocks.rows.map(r=>[String(r.sku),Number(r.quantity)]));
      const skuIndex=this.headerValues.indexOf('SKU (Барааны код)'),stockIndex=this.headerValues.indexOf('Current Stock (Үлдэгдэл)');
      if(skuIndex<0||stockIndex<0)throw new Error('Unsupported POS catalog stock columns');
      for(const row of rows) {const stock=bySku.get(String(row.raw_cells[skuIndex]))??0;row.cells[stockIndex]=stock;row.raw_cells[stockIndex]=stock;}
    }
    return rows;
  }
  async values(raw=false) {
    const rows=await this.storedRows();const values:unknown[][]=[[...this.headerValues]];
    for(const row of rows) {while(values.length<row.row_number)values.push([]);values[row.row_number-1]=raw?row.raw_cells:row.cells;}
    return values;
  }
  async getRows() { return (await this.storedRows()).map(row=>this.row(row)); }
  private row(stored:StoredRow):PosRow {
    const cells=[...stored.cells];const changes=new Map<number,unknown>();
    return {rowNumber:stored.row_number,
      get:column=>cells[this.headerValues.indexOf(column)],
      set:(column,value)=>{const i=this.headerValues.indexOf(column);if(i<0)throw new Error('Unknown POS field');cells[i]=value;changes.set(i,value);},
      save:async()=>{
        const raw=[...stored.raw_cells];for(const [i,v] of changes)raw[i]=v;
        await this.writeRow(stored.row_number,cells,stored.version,raw);
        stored.version=Number(stored.version)+1;stored.raw_cells=raw;changes.clear();
      }};
  }
  async addRows(rows:(Record<string,unknown>|unknown[])[]) {
    if(!rows.length)return [];
    const allocation=await this.doc.query(`UPDATE ${this.doc.schema}.datasets SET next_row=next_row+$2,row_count=GREATEST(row_count,next_row+$2-1) WHERE id=$1 RETURNING next_row-$2 AS first`,[this.sheetId,rows.length]);
    const first=Number(allocation.rows[0].first);const created:PosRow[]=[];
    for(let i=0;i<rows.length;i++) {
      const input=rows[i];const cells=Array.isArray(input)?input:this.headerValues.map(h=>input[h]??'');
      const rowNumber=first+i;
      await this.doc.query(`INSERT INTO ${this.doc.schema}.records(dataset_id,row_number,cells,raw_cells) VALUES($1,$2,$3::jsonb,$3::jsonb)`,[this.sheetId,rowNumber,encoded(cells)]);
      await this.doc.query(`INSERT INTO ${this.doc.schema}.audit(dataset_id,row_number,action,after_cells) VALUES($1,$2,'insert',$3::jsonb)`,[this.sheetId,rowNumber,encoded(cells)]);
      created.push(this.row({row_number:rowNumber,cells,raw_cells:cells,version:1}));
    }
    return created;
  }
  async writeRow(rowNumber:number,cells:unknown[],version?:string|number,raw=cells) {
    const previous=await this.doc.query(`SELECT raw_cells,version FROM ${this.doc.schema}.records WHERE dataset_id=$1 AND row_number=$2 FOR UPDATE`,[this.sheetId,rowNumber]);
    if(!previous.rows.length) throw new Error('POS row does not exist');
    if(version!==undefined && String(previous.rows[0].version)!==String(version)) throw new Error('POS row changed; refresh before retrying');
    await this.doc.query(`UPDATE ${this.doc.schema}.records SET cells=$3::jsonb,raw_cells=$4::jsonb,version=version+1,updated_at=now() WHERE dataset_id=$1 AND row_number=$2`,[this.sheetId,rowNumber,encoded(cells),encoded(raw)]);
    await this.doc.query(`INSERT INTO ${this.doc.schema}.audit(dataset_id,row_number,action,before_cells,after_cells) VALUES($1,$2,'update',$3::jsonb,$4::jsonb)`,[this.sheetId,rowNumber,encoded(previous.rows[0].raw_cells),encoded(raw)]);
  }
}

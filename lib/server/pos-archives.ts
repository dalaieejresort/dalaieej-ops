import 'server-only';
import { createPosDocument } from './pos-storage';
export const ARCHIVE_HEADERS=['record_id','label','season_year','start_date','end_date','created_at','record_count','counts_json','blob_url','sha256','kind'];
export async function listPosArchives() {
 const doc=createPosDocument();await doc.loadInfo();const sheet=doc.sheetsByTitle.POS_Archives;if(!sheet)return [];
 return (await sheet.getRows()).map(r=>({id:String(r.get('record_id')),label:String(r.get('label')),season:String(r.get('season_year')),start:String(r.get('start_date')),end:String(r.get('end_date')),createdAt:String(r.get('created_at')),records:Number(r.get('record_count')),counts:JSON.parse(String(r.get('counts_json')||'{}')) as Record<string,number>,blobUrl:String(r.get('blob_url')),sha256:String(r.get('sha256')),kind:String(r.get('kind'))}));
}

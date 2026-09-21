import 'server-only';
import { createPosDocument } from './pos-storage';
import { withPosTransaction } from './pos-storage/transaction';
import type { OpsSession } from './auth';
import { operationFingerprint } from './operation-controls';
import { hotelToday, visibleFeed } from '@/lib/hotel/model';
import type { HotelBoard, HotelFeed, HotelTask, RoomState, Readiness } from '@/lib/hotel/types';
const HEADERS=['key','data','updated_at'];
export class HotelInputError extends Error { constructor(message:string,public status=400){super(message);} }
async function table(title:string,create=false) { const doc=createPosDocument();await doc.loadInfo();return doc.sheetsByTitle[title] || (create?await doc.addSheet({title,headerValues:HEADERS}):null); }
async function records<T>(title:string):Promise<T[]> {const sheet=await table(title);return sheet?(await sheet.getRows()).map(row=>JSON.parse(String(row.get('data'))) as T):[];}
async function put(title:string,key:string,data:unknown) {const sheet=(await table(title,true))!;const row=(await sheet.getRows()).find(r=>String(r.get('key'))===key);if(row){row.set('data',JSON.stringify(data));row.set('updated_at',new Date().toISOString());await row.save();}else await sheet.addRows([{key,data:JSON.stringify(data),updated_at:new Date().toISOString()}]);}
export function hotelCanSeeGuests(role:string){return role!=='housekeeping';}
export async function readHotelSource(path:string) {
 const base=process.env.HOTEL_FEED_URL, token=process.env.HOTEL_FEED_TOKEN;
 if(!base||!token)throw Error('Hotel feed is not configured');
 const url=new URL(path,base);
 if(url.protocol!=='https:' && url.hostname!=='localhost')throw Error('Invalid hotel feed URL');
 const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw Error('Hotel feed unavailable');return response.json();
}
let refreshing:Promise<HotelFeed>|undefined;
async function feed():Promise<{feed:HotelFeed|null;stale:boolean;error:string}> {
 const cached=(await records<HotelFeed>('Hotel_Feed'))[0]||null;
 if(cached&&cached.date===hotelToday()&&Date.now()-Date.parse(cached.checkedAt)<120000)return {feed:cached,stale:false,error:''};
 try {
  if(!refreshing)refreshing=(async()=>{
   const incoming=await readHotelSource('/hotel/feed') as HotelFeed;
   if(!Array.isArray(incoming.rooms)||!Array.isArray(incoming.reservations)||incoming.date!==hotelToday()||!Number.isFinite(Date.parse(incoming.checkedAt)))throw Error('Invalid hotel feed');
   await withPosTransaction(()=>put('Hotel_Feed','current',incoming));return incoming;
  })().finally(()=>{refreshing=undefined;});
  return {feed:await refreshing,stale:false,error:''};
 }catch{return {feed:cached,stale:true,error:'Cloudbeds мэдээлэл шинэчлэгдсэнгүй. Сүүлд хадгалсан мэдээллийг харуулж байна.'};}
}
export async function hotelBoard(session:OpsSession):Promise<HotelBoard> {
 const [source,rooms,tasks]=await Promise.all([feed(),records<RoomState>('Hotel_Rooms'),records<HotelTask>('Hotel_Tasks')]);
 const canSeeGuests=hotelCanSeeGuests(session.role);
 return {...source,feed:source.feed?visibleFeed(source.feed,canSeeGuests):null,rooms,tasks:tasks.filter(t=>t.status!=='done'||Date.now()-Date.parse(t.updatedAt)<7*86400000),today:hotelToday(),canSeeGuests,username:session.username};
}
function text(value:unknown,max:number,required=true) {if(typeof value!=='string'||value.length>max||(required&&!value.trim()))throw new HotelInputError('Мэдээллээ шалгана уу.');return value.trim();}
export async function saveHotel(input:Record<string,unknown>,session:OpsSession) {
 const requestId=text(input.requestId,100);const fingerprint=operationFingerprint({input,username:session.username});
 const prior=(await records<{id:string;fingerprint:string;result:unknown}>('Hotel_Operations')).find(r=>r.id===requestId);
 if(prior){if(prior.fingerprint!==fingerprint)throw new HotelInputError('Хүсэлтийн дугаар давхардсан.',409);return prior.result;}
 const action=input.action;const now=new Date().toISOString();const actor=session.displayName;
 const feed=(await records<HotelFeed>('Hotel_Feed'))[0];
 const validateRoom=(value:unknown,required=true)=>{const id=text(value,100,required);if(id&&!feed?.rooms.some(r=>r.id===id))throw new HotelInputError('Байшин олдсонгүй. Шинэчилнэ үү.');return id;};
 let result:unknown;
 if(action==='readiness') {
  const roomId=validateRoom(input.roomId);const states=await records<RoomState>('Hotel_Rooms');const previous=states.find(r=>r.roomId===roomId);
  if(Number(input.version)!==(previous?.version||0))throw new HotelInputError('Өөр ажилтан шинэчилсэн байна. Мэдээллээ шинэчилнэ үү.',409);
  const status=text(input.status,30) as Readiness;if(!['unknown','dirty','cleaning','ready','maintenance'].includes(status))throw new HotelInputError('Төлөв буруу байна.');
  if(status==='ready'&&feed?.rooms.find(r=>r.id===roomId)?.blocked)throw new HotelInputError('Байшин Cloudbeds-д хаалттай байна.',409);
  if(status==='ready' && (!feed || Date.now()-Date.parse(feed.checkedAt)>5*60000 || feed.date!==hotelToday()))throw new HotelInputError('Бэлэн болгохын өмнө Cloudbeds мэдээллээ шинэчилнэ үү.',409);
  const state:RoomState={roomId,status,note:text(input.note,500,false),version:(previous?.version||0)+1,actor,updatedAt:now,clearedDepartures:feed?.reservations.filter(r=>r.rooms.some(room=>room.id===roomId&&(room.status==='checked_out'||r.status==='checked_out'))).map(r=>r.id)||[]};
  await put('Hotel_Rooms',roomId,state);result=state;
 } else if(action==='create-task') {
  const roomId=validateRoom(input.roomId,false);const kind=text(input.kind,30) as HotelTask['kind'];
  if(!['cleaning','supplies','maintenance','handover'].includes(kind))throw new HotelInputError('Ажлын төрөл буруу байна.');
  const task:HotelTask={id:crypto.randomUUID(),roomId,kind,title:text(input.title,200),status:'open',assignee:'',assigneeName:'',notes:[],version:1,createdAt:now,updatedAt:now};
  await put('Hotel_Tasks',task.id,task);result=task;
 } else if(action==='task') {
  const id=text(input.id,100),change=text(input.change,20);const task=(await records<HotelTask>('Hotel_Tasks')).find(t=>t.id===id);
  if(!task)throw new HotelInputError('Ажил олдсонгүй.',404);
  if(Number(input.version)!==task.version)throw new HotelInputError('Ажлыг өөр ажилтан шинэчилсэн. Дахин ачаална уу.',409);
  const supervisor=['manager','owner','reception'].includes(session.role);
  if(change==='claim') {if(task.status!=='open')throw new HotelInputError('Ажил аль хэдийн хуваарилагдсан.',409);task.status='claimed';task.assignee=session.username;task.assigneeName=actor;}
  else if(change==='done') {if(task.status==='done')throw new HotelInputError('Ажил дууссан.',409);if(task.assignee!==session.username&&!supervisor)throw new HotelInputError('Эхлээд ажлаа авна уу.',403);task.status='done';}
  else if(change==='reopen') {if(!supervisor)throw new HotelInputError('Эрх хүрэлцэхгүй.',403);task.status='open';task.assignee='';task.assigneeName='';}
  else if(change==='note') {if(task.notes.length>=100)throw new HotelInputError('Тэмдэглэлийн хязгаарт хүрсэн.');task.notes.push({text:text(input.note,500),actor,at:now});}
  else throw new HotelInputError('Үйлдэл буруу байна.');
  task.version++;task.updatedAt=now;await put('Hotel_Tasks',id,task);result=task;
 }else throw new HotelInputError('Үйлдэл буруу байна.');
 await put('Hotel_Operations',requestId,{id:requestId,fingerprint,action,result,actor,username:session.username,at:now});
 return result;
}

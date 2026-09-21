export type HotelRoom = { id:string; name:string; type:string; blocked:boolean; virtual:boolean };
export type HotelStay = { id:string; propertyId:string; guestName:string; status:string; arrival:string; departure:string; adults:number; children:number; unassigned:boolean; rooms:{id:string;name:string;arrival:string;departure:string;status:string}[] };
export type HotelFeed = { date:string; through:string; checkedAt:string; rooms:HotelRoom[]; reservations:HotelStay[] };
export type Readiness = 'unknown'|'dirty'|'cleaning'|'ready'|'maintenance';
export type RoomState = { roomId:string; status:Readiness; note:string; version:number; actor:string; updatedAt:string; clearedDepartures:string[] };
export type HotelTask = { id:string; roomId:string; kind:'cleaning'|'supplies'|'maintenance'|'handover'; title:string; status:'open'|'claimed'|'done'; assignee:string; assigneeName:string; notes:{text:string;actor:string;at:string}[]; version:number; createdAt:string; updatedAt:string };
export type HotelBoard = { feed:HotelFeed|null; stale:boolean; error:string; rooms:RoomState[]; tasks:HotelTask[]; today:string; canSeeGuests:boolean; username:string };

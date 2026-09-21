import type { HotelStay, HotelFeed, HotelRoom, RoomState, Readiness } from './types';
export const readinessLabels:Record<Readiness,string> = {unknown:'Шалгаагүй',dirty:'Цэвэрлэх',cleaning:'Цэвэрлэж байна',ready:'Бэлэн',maintenance:'Засвартай'};
export const statusLabels:Record<string,string> = {confirmed:'Баталгаажсан',not_confirmed:'Баталгаажаагүй',checked_in:'Байрлаж байна',checked_out:'Гарсан',canceled:'Цуцлагдсан',no_show:'Ирээгүй'};
export function hotelToday(now=new Date()) { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ulaanbaatar',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function activeStay(stay:HotelStay) { return ['confirmed','not_confirmed','checked_in'].includes(stay.status); }
export function todayGroups(stays:HotelStay[],date:string) {
 return { arrivals:stays.filter(s=>s.arrival===date && activeStay(s)), departures:stays.filter(s=>s.departure===date && (activeStay(s)||s.status==='checked_out')), staying:stays.filter(s=>s.status==='checked_in'), overdue:stays.filter(s=>s.status==='checked_in'&&s.departure<date) };
}
export function roomStays(feed:HotelFeed,roomId:string,today:string) {
 const linked=feed.reservations.filter(s=>activeStay(s)&&s.rooms.some(r=>r.id===roomId));
 const current=linked.filter(s=>s.rooms.some(r=>r.id===roomId && (r.status==='checked_in'||(!r.status&&s.status==='checked_in')) && r.arrival<=today));
 const next=linked.filter(s=>!current.includes(s)&&s.rooms.some(r=>r.id===roomId&&r.departure>today)).sort((a,b)=>a.arrival.localeCompare(b.arrival))[0];
 return {current,next};
}
export function effectiveReadiness(state:RoomState|undefined,feed:HotelFeed,roomId:string):Readiness {
 if(!state)return 'unknown';
 // Readiness is a daily inspection; a new checkout needs another check.
 if(state.status==='ready' && (hotelToday(new Date(state.updatedAt))!==hotelToday() || feed.reservations.some(s=>s.rooms.some(r=>r.id===roomId&&(r.status==='checked_out'||s.status==='checked_out'))&&!state.clearedDepartures?.includes(s.id)))) return 'unknown';
 return state.status;
}
export function attention(stay:HotelStay,feed:HotelFeed,states:RoomState[],today:string) {
 const reasons:string[]=[];
 if(stay.status==='checked_in'&&stay.departure<today)reasons.push('Гарах өдөр өнгөрсөн');
 if(stay.arrival===today && activeStay(stay)) {
  if(stay.unassigned)reasons.push('Байшин оноогоогүй');
  if(stay.rooms.some(r=>feed.rooms.find(room=>room.id===r.id)?.blocked))reasons.push('Байшин Cloudbeds-д хаалттай');
  if(stay.status!=='checked_in'&&stay.rooms.some(r=>effectiveReadiness(states.find(s=>s.roomId===r.id),feed,r.id)!=='ready'))reasons.push('Байшингийн бэлэн байдлыг шалгах');
 }
 return reasons;
}
export function visibleFeed(feed:HotelFeed,canSeeGuests:boolean):HotelFeed {
 return canSeeGuests?feed:{...feed,reservations:feed.reservations.map(r=>({...r,guestName:'',propertyId:''}))};
}
export function roomName(rooms:HotelRoom[],id:string) {return rooms.find(r=>r.id===id)?.name||'Байшин сонгоогүй';}

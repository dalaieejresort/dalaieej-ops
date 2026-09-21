'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OpsRole } from '@/lib/auth-types';
import { OperationsChrome } from '@/components/navigation/OperationsChrome';
import { canRefreshInBackground, fetchWithTimeout } from '@/lib/client/network';
import { attention, effectiveReadiness, readinessLabels, roomName, roomStays, statusLabels, todayGroups } from '@/lib/hotel/model';
import type { HotelBoard, HotelRoom, HotelStay, HotelTask, Readiness, RoomState } from '@/lib/hotel/types';
import styles from './HotelWorkspace.module.css';

type Save = (payload:Record<string,unknown>)=>Promise<boolean>;
const kinds:Record<HotelTask['kind'],string>={cleaning:'Цэвэрлэгээ',supplies:'Хангамж',maintenance:'Засвар',handover:'Ээлжийн тэмдэглэл'};
const dateLabel=(value:string)=>value.replaceAll('-','.');
const timeLabel=(value:string)=>new Date(value).toLocaleString('mn-MN',{timeZone:'Asia/Ulaanbaatar',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

export function HotelWorkspace({role}:{role:OpsRole}) {
 const [board,setBoard]=useState<HotelBoard|null>(null),[tab,setTab]=useState<'today'|'rooms'|'tasks'>('today');
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const [search,setSearch]=useState(''),[showDone,setShowDone]=useState(false);
 const refreshFlight=useRef(false),saving=useRef(false),mounted=useRef(false),pending=useRef(new Map<string,string>());
 const refresh=useCallback(async()=>{
  if(refreshFlight.current)return;
  refreshFlight.current=true;setLoading(true);
  try {const response=await fetchWithTimeout('/api/hotel',{cache:'no-store'},55000);const body=await response.json();if(!response.ok)throw Error(body.error||'Ачаалж чадсангүй.');if(mounted.current){setBoard(body);setError('');}}
  catch(failure){if(mounted.current)setError(failure instanceof Error?failure.message:'Мэдээлэл шинэчлэгдсэнгүй.');throw failure;}
  finally {refreshFlight.current=false;if(mounted.current)setLoading(false);}
 },[]);
 useEffect(()=>{
  mounted.current=true;const check=()=>{if(canRefreshInBackground())void refresh().catch(()=>{});};
  const initial=setTimeout(check,0),timer=setInterval(check,60000);window.addEventListener('online',check);document.addEventListener('visibilitychange',check);
  return()=>{mounted.current=false;clearTimeout(initial);clearInterval(timer);window.removeEventListener('online',check);document.removeEventListener('visibilitychange',check);};
 },[refresh]);
 useEffect(()=>{window.scrollTo({top:0});},[tab]);
 const save:Save=async payload=>{
  if(saving.current)return false;saving.current=true;setBusy(true);setError('');setMessage('');
  const fingerprint=JSON.stringify(payload);if(!pending.current.has(fingerprint))pending.current.set(fingerprint,crypto.randomUUID());
  try {
   const res=await fetchWithTimeout('/api/hotel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:pending.current.get(fingerprint)})},30000);
   const body=await res.json();if(!res.ok)throw Error(body.error||'Хадгалж чадсангүй.');
   pending.current.delete(fingerprint);setMessage('Хадгалагдлаа.');
   try{await refresh();}catch{setError('Хадгалагдсан боловч дэлгэц шинэчлэгдсэнгүй. Дахин хадгалах шаардлагагүй.');}
   return true;
  }catch(failure){setError(failure instanceof Error?failure.message:'Хадгалж чадсангүй.');return false;}
  finally{saving.current=false;setBusy(false);}
 };
 const rooms=[...(board?.feed?.rooms||[])].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})),stays=board?.feed?.reservations||[];
 const groups=todayGroups(stays,board?.today||''),needsAttention=board?.feed?stays.filter(s=>attention(s,board.feed!,board.rooms,board.today).length):[];
 const matches=(s:HotelStay)=>`${s.guestName} ${s.id} ${s.rooms.map(r=>r.name).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
 const openTasks=board?.tasks.filter(t=>t.status!=='done')||[];
 const stayCards=(items:HotelStay[])=>items.filter(matches).map(stay=><StayCard key={stay.id} stay={stay} board={board!}/>);
 return <div className={styles.workspace}>
  <OperationsChrome role={role} active="hotel" compact/>
  <main className={styles.main}>
   <header className={styles.header}><div><h1>Буудал</h1><p>{board?dateLabel(board.today):'Улаанбаатарын цагаар'} · {role==='housekeeping'?'Үйлчилгээ':'Хүлээн авах'}</p></div><button type="button" disabled={loading||busy} onClick={()=>void refresh().catch(()=>{})}>{loading?'Шинэчилж байна…':'Шинэчлэх'}</button></header>
   <div className={styles.sync}>{board?.feed?`Cloudbeds · ${timeLabel(board.feed.checkedAt)} шинэчилсэн`:'Cloudbeds мэдээлэл хүлээж байна…'}</div>
   {(error||board?.stale)&&<p className={styles.error} role="alert">{error||board?.error} {board?.feed&&'Мэдээлэл хуучирсан байж болно.'}</p>}
   {message&&<p className={styles.feedback} role="status">{message}</p>}
   {!board&&<p className={styles.empty}>{loading?'Буудлын мэдээллийг ачаалж байна…':'Мэдээлэл ачаалагдаагүй. Шинэчлэх товчийг дарна уу.'}</p>}
   {board&&<>
    {tab!=='tasks'&&<label className={styles.search}>Хайх<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder={board.canSeeGuests?'Байшин, зочин, захиалгын дугаар':'Байшингийн нэр, дугаар'}/></label>}
    {tab==='today'&&<>
     <div className={styles.counts}><div><strong>{board.feed?groups.arrivals.length:'—'}</strong><span>Ирэх</span></div><div><strong>{board.feed?groups.departures.length:'—'}</strong><span>Гарах</span></div><div><strong>{board.feed?groups.staying.length:'—'}</strong><span>Байрлаж буй</span></div></div>
     {!board.feed?<p className={styles.empty}>Захиалгын мэдээлэл одоогоор алга.</p>:<>
      {needsAttention.length>0&&<section className={styles.section}><h2>Анхаарах · {needsAttention.length}</h2>{stayCards(needsAttention)}</section>}
      <section className={styles.section}><h2>Өнөөдөр ирэх · {groups.arrivals.length}</h2>{stayCards(groups.arrivals)}{!groups.arrivals.filter(matches).length&&<p className={styles.empty}>Ирэх зочин алга.</p>}</section>
      <section className={styles.section}><h2>Өнөөдөр гарах · {groups.departures.length}</h2>{stayCards(groups.departures)}{!groups.departures.filter(matches).length&&<p className={styles.empty}>Гарах зочин алга.</p>}</section>
      <section className={styles.section}><h2>Байрлаж буй · {groups.staying.length}</h2>{stayCards(groups.staying)}{!groups.staying.filter(matches).length&&<p className={styles.empty}>Бүртгэгдсэн байрлаж буй зочин алга.</p>}</section>
     </>}
    </>}
    {tab==='rooms'&&<section className={styles.section}><h2>Байшин · {rooms.length}</h2><p className={styles.muted}>Бэлэн байдлыг өдөр бүр шалгана. Байрлаж буй эсэх нь цэвэрлэгээний төлөвөөс тусдаа.</p>
     {rooms.filter(r=>`${r.name} ${r.type}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(room=>{
      const state=board.rooms.find(r=>r.roomId===room.id),occupancy=roomStays(board.feed!,room.id,board.today),ready=effectiveReadiness(state,board.feed!,room.id);
      return <details className={styles.card} key={room.id}><summary><div><strong>{room.name}</strong><span className={styles.muted}>{room.type}</span></div><div className={styles.badges}><span>{occupancy.current.length?'Байрлаж буй':'Байрлаж буй бүртгэлгүй'}</span><span className={ready==='ready'?styles.ready:styles.warn}>{room.blocked?'Cloudbeds: хаалттай':readinessLabels[ready]}</span></div></summary>
       <div className={styles.detail}>{occupancy.current.map(s=><StayCard key={s.id} stay={s} board={board}/>)}
        {occupancy.next?<><p className={styles.muted}>Дараагийн ирэлт · {dateLabel(occupancy.next.arrival)}</p><StayCard stay={occupancy.next} board={board}/></>:<p className={styles.muted}>{dateLabel(board.feed!.through)} хүртэл дараагийн захиалга харагдахгүй байна. Энэ нь борлуулах боломжтой гэсэн баталгаа биш.</p>}
        <RoomEditor key={`${room.id}-${state?.version||0}`} room={room} state={state} readiness={ready} busy={busy} save={save}/>
       </div></details>;
     })}{!rooms.length&&<p className={styles.empty}>Байшингийн мэдээлэл алга.</p>}
    </section>}
    {tab==='tasks'&&<section className={styles.section}><h2>Ажил · {openTasks.length} дуусаагүй</h2><TaskCreator rooms={rooms} save={save} busy={busy}/>
     <label className={styles.check}><input type="checkbox" checked={showDone} onChange={e=>setShowDone(e.target.checked)}/>Дууссан ажлыг харах · сүүлийн 7 хоног</label>
     {board.tasks.filter(t=>showDone?t.status==='done':t.status!=='done').sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).map(task=><TaskCard key={task.id} task={task} rooms={rooms} save={save} busy={busy} username={board.username} supervisor={role!=='housekeeping'}/>)}
     {!board.tasks.some(t=>showDone?t.status==='done':t.status!=='done')&&<p className={styles.empty}>Ажил алга.</p>}
    </section>}
   </>}
  </main>
  <nav className={styles.tabs} aria-label="Буудлын хэсгүүд">{([['today','Өнөөдөр'],['rooms','Байшин'],['tasks',`Ажил${openTasks.length?` · ${openTasks.length}`:''}`]] as const).map(([id,label])=><button key={id} type="button" aria-current={tab===id?'page':undefined} onClick={()=>{setTab(id);setSearch('');}}>{label}</button>)}</nav>
 </div>;
}

function StayCard({stay,board}:{stay:HotelStay;board:HotelBoard}) {
 const [contact,setContact]=useState<{phone:string;cloudbedsUrl:string}|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 const flags=board.feed?attention(stay,board.feed,board.rooms,board.today):[];
 return <details className={styles.card}><summary><div><strong>{stay.rooms.map(r=>r.name).join(', ')||'Байшин оноогоогүй'}</strong><span>{board.canSeeGuests?stay.guestName:`${stay.adults} том · ${stay.children} хүүхэд`}</span>{flags.length>0&&<span className={styles.flag}>{flags.join(' · ')}</span>}</div><span className={styles.muted}>{statusLabels[stay.status]||'Төлөв шалгах'}</span></summary>
  <div className={styles.detail}><p>{dateLabel(stay.arrival)} → {dateLabel(stay.departure)}</p><p>{stay.adults} том хүн · {stay.children} хүүхэд</p>{board.canSeeGuests&&<><p className={styles.muted}>Захиалга · {stay.id}</p><button disabled={loading} type="button" onClick={async()=>{setLoading(true);setError('');try{const res=await fetchWithTimeout(`/api/hotel/reservation?id=${encodeURIComponent(stay.id)}`,{cache:'no-store'},20000);const data=await res.json();if(!res.ok)throw Error(data.error);setContact(data);}catch{setError('Холбоо барих мэдээлэл ачаалагдсангүй.');}finally{setLoading(false);}}}>{loading?'Ачаалж байна…':'Холбоо барих / Cloudbeds'}</button>{contact&&<div className={styles.contact}>{contact.phone?<a href={`tel:${contact.phone.replace(/[^+\d]/g,'')}`}>Утас · {contact.phone}</a>:<p>Утас бүртгэгдээгүй.</p>}<a href={contact.cloudbedsUrl} target="_blank" rel="noreferrer">Cloudbeds нээх ↗</a><p className={styles.muted}>Ирсэн, гарсан бүртгэл болон захиалгын өөрчлөлтийг Cloudbeds-д хийнэ.</p></div>}{error&&<p role="alert">{error}</p>}</>}</div>
 </details>;
}
function RoomEditor({room,state,readiness,busy,save}:{room:HotelRoom;state:RoomState|undefined;readiness:Readiness;busy:boolean;save:Save}) {
 const [status,setStatus]=useState<Readiness>(readiness),[note,setNote]=useState(state?.note||'');
 return <form onSubmit={e=>{e.preventDefault();void save({action:'readiness',roomId:room.id,status,note,version:state?.version||0});}}><fieldset disabled={busy}><legend>Бэлэн байдал</legend><label>Төлөв<select value={status} onChange={e=>setStatus(e.target.value as Readiness)}>{Object.entries(readinessLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>Байшингийн тэмдэглэл<textarea maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Зочны хувийн мэдээлэл бүү оруулна уу"/></label><button className={styles.primary} type="submit">Төлөв хадгалах</button>{state&&<p className={styles.muted}>{state.actor} · {timeLabel(state.updatedAt)}</p>}</fieldset></form>;
}
function TaskCreator({rooms,busy,save}:{rooms:HotelRoom[];busy:boolean;save:Save}) {
 const [roomId,setRoom]=useState(''),[kind,setKind]=useState('cleaning'),[title,setTitle]=useState('');
 return <details className={styles.card}><summary>+ Ажил нэмэх</summary><form className={styles.detail} onSubmit={async e=>{e.preventDefault();if(await save({action:'create-task',roomId,kind,title}))setTitle('');}}><fieldset disabled={busy}><label>Байшин<select value={roomId} onChange={e=>setRoom(e.target.value)}><option value="">Нийтийн / тодорхой байшингүй</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>Төрөл<select value={kind} onChange={e=>setKind(e.target.value)}>{Object.entries(kinds).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label><label>Хийх ажил<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)} placeholder="Жишээ: алчуур нөхөх"/></label><button className={styles.primary} type="submit">Ажил нэмэх</button></fieldset></form></details>;
}
function TaskCard({task,rooms,busy,save,username,supervisor}:{task:HotelTask;rooms:HotelRoom[];busy:boolean;save:Save;username:string;supervisor:boolean}) {
 const [note,setNote]=useState('');const change=(change:string,extra:Record<string,unknown>={})=>save({action:'task',id:task.id,version:task.version,change,...extra});
 return <article className={styles.task}><p className={styles.muted}>{task.roomId?roomName(rooms,task.roomId):'Нийтийн'} · {kinds[task.kind]}</p><h3>{task.title}</h3><p>{task.status==='done'?'Дууссан':task.status==='claimed'?`Хариуцсан: ${task.assigneeName}`:'Ажилтан аваагүй'}</p><div className={styles.actions}>
  {task.status==='open'&&<button disabled={busy} onClick={()=>void change('claim')}>Ажил авах</button>}
  {task.status!=='done'&&(task.assignee===username||supervisor)&&<button disabled={busy} onClick={()=>void change('done')}>Дуусгах</button>}
  {task.status==='done'&&supervisor&&<button disabled={busy} onClick={()=>void change('reopen')}>Дахин нээх</button>}
 </div><details><summary>Тэмдэглэл · {task.notes.length}</summary>{task.notes.map((n,i)=><div className={styles.note} key={i}><p>{n.text}</p><p className={styles.muted}>{n.actor} · {timeLabel(n.at)}</p></div>)}<form onSubmit={async e=>{e.preventDefault();if(await change('note',{note}))setNote('');}}><label>Тэмдэглэл нэмэх<textarea required maxLength={500} value={note} onChange={e=>setNote(e.target.value)}/></label><button disabled={busy} type="submit">Тэмдэглэл хадгалах</button></form></details></article>;
}

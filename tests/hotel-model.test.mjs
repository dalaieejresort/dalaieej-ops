import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync(new URL('../lib/hotel/model.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const loaded={exports:{}};new Function('exports',compiled)(loaded.exports);const m=loaded.exports;
const base={id:'stay1',propertyId:'property',guestName:'Private Guest',status:'confirmed',arrival:'2026-09-21',departure:'2026-09-22',adults:2,children:1,rooms:[{id:'room1',name:'1',arrival:'2026-09-21',departure:'2026-09-22',status:'confirmed'}],unassigned:false};
test('confirmed arrivals are not occupants; canceled stays do not appear; overdue checkouts need attention',()=>{
 const feed={rooms:[],reservations:[base,{...base,id:'in',status:'checked_in',rooms:[{...base.rooms[0],status:'checked_in'}]},{...base,id:'cancel',status:'canceled'}]};
 const g=m.todayGroups(feed.reservations,'2026-09-21');assert.equal(g.arrivals.length,2);assert.equal(g.staying.length,1);
 assert.equal(m.roomStays(feed,'room1','2026-09-21').current.length,1);
 assert.deepEqual(m.attention({...base,status:'checked_in'},feed,[],'2026-09-23'),['Гарах өдөр өнгөрсөн']);
 assert.deepEqual(m.attention({...base,unassigned:true,rooms:[]},feed,[],'2026-09-21'),['Байшин оноогоогүй']);
});
test('readiness is independent of occupancy and invalidates on an unacknowledged checkout',()=>{
 const date=m.hotelToday(),state={status:'ready',updatedAt:new Date().toISOString(),clearedDepartures:[]};
 const feed={reservations:[{...base,status:'checked_in'}]};assert.equal(m.effectiveReadiness(state,feed,'room1'),'ready');
 feed.reservations=[{...base,status:'checked_out',departure:date}];assert.equal(m.effectiveReadiness(state,feed,'room1'),'unknown');
 assert.equal(m.effectiveReadiness({...state,clearedDepartures:['stay1']},feed,'room1'),'ready');
 assert.equal(m.effectiveReadiness({...state,updatedAt:'2020-01-01T00:00:00Z'},feed,'room1'),'unknown');
 assert.equal(m.effectiveReadiness(undefined,feed,'room1'),'unknown');
});
test('housekeeping projection does not include guest names or property links',()=>{
 const feed={reservations:[base]};const safe=m.visibleFeed(feed,false);assert.equal(safe.reservations[0].guestName,'');assert.equal(safe.reservations[0].propertyId,'');assert.equal(feed.reservations[0].guestName,'Private Guest');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const source=fs.readFileSync(new URL('../supabase/functions/scheduling-route/index.ts',import.meta.url),'utf8');
const ctx=vm.createContext({
 createClient:()=>{throw Error('No network');},parseGoogleRouteMetrics:()=>{throw Error('No route request');},
 selectPendingRouteBatch:()=>{throw Error('No cache build');},
 Deno:{env:{get:()=>''},serve:()=>{}},fetch:()=>{throw Error('No network');}
});
vm.runInContext(stripTypeScriptTypes(source.replace(/^import .*\n/gm,'').replace(/^export /gm,''))+
 '\nthis.helpers={attendanceDestinationAddress,genericAttendanceLocation,isRemotePayrollActivity,loadPayrollMonthPairs};',ctx);
const h=ctx.helpers;
const base={id:'legacy',emp_id:1,report_date:'2026-11-02',start_time:'10:00',activity_type:'הכשרה',activity_name_snapshot:'Program',training_mode:'physical',school_id:null,training_schedule_id:null,authority_name_snapshot:'legacy venue'};
test('legacy ordinary physical training reads the original venue; explicit destination wins',()=>{
 assert.equal(h.attendanceDestinationAddress(base),'legacy venue');
 assert.equal(h.genericAttendanceLocation(base).address,'legacy venue');
 assert.match(h.genericAttendanceLocation(base).entity_key,/legacy venue$/);
 assert.equal(h.attendanceDestinationAddress({...base,destination_address_snapshot:'new venue'}),'new venue');
 for(const change of [{training_mode:'online'},{training_mode:null},{activity_type:'תפעול'},{school_id:10},{training_schedule_id:'schedule'},{authority_name_snapshot:''}])
  assert.equal(h.attendanceDestinationAddress({...base,...change}),'');
});
test('route completion recognizes explicit online modes without the word Zoom',()=>{
 assert.equal(h.isRemotePayrollActivity({...base,training_mode:'online'}),true);
 assert.equal(h.isRemotePayrollActivity({...base,activity_type:'תפעול',operation_meeting_mode:'online'}),true);
 assert.equal(h.isRemotePayrollActivity(base),false);
 assert.equal(h.isRemotePayrollActivity({activity_name:'זום אישי'}),true);
});
test('November route collection reads modes and legacy venue without false missing-destination exceptions',async()=>{
 const data={
  attendance_records:[base,{...base,id:'online-training',training_mode:'online',authority_name_snapshot:null},
   {...base,id:'online-operation',activity_type:'תפעול',operation_meeting_mode:'online',authority_name_snapshot:null}],
  activities:[],course_meeting_cancellations:[],schools:[],contacts_schools:[],
  contacts_instructors:[{emp_id:1,full_name:'Guide',address:'home'}]
 };
 const db={from:table=>{
  let rows=data[table]||[],columns=null;
  const q={select:c=>{columns=c.split(',').map(x=>x.trim());return q;},gte:()=>q,lte:()=>q,eq:()=>q,
   in:(k,values)=>{rows=rows.filter(r=>values.includes(r[k]));return q;},
   range:(a,b)=>{rows=rows.slice(a,b+1);return q;},
   then:(resolve,reject)=>Promise.resolve({data:rows.map(r=>columns&&columns[0]!=='*'?Object.fromEntries(columns.map(k=>[k,r[k]])):r),error:null}).then(resolve,reject)};
  return q;
 }};
 const result=await h.loadPayrollMonthPairs(db,'2026-11',[1]);
 assert.equal(result.error,null);
 assert.ok(result.pairs.some(x=>x.destination_address==='legacy venue'));
 assert.equal(result.extras.exceptions.length,0);
});

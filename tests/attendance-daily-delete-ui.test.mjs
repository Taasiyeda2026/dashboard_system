import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {confirmedMutation} from '../attendance/src/services/confirmed-mutation.js';
import {isZoomLocationReport} from '../attendance/src/services/attendance-location-policy.js';

const source=readFileSync(new URL('../attendance/src/screens/my-reports-screen.js',import.meta.url),'utf8');
const deletion=source.slice(source.indexOf('function buildDeletedTravelNotice('),source.indexOf('// ── Edit modal'));
const date='2026-11-05';
const record={id:'deleted',report_date:date,activity_type:'קורס'};
function setup({confirmResult=true,deleteImpl=async()=>{}}={}){
 const dom=new JSDOM('<body><div id="row"></div></body>');
 const warnings=[],alerts=[],refreshes=[],deletions=[],navigation=[];
 const context={document:dom.window.document,isZoomLocationReport,
  formatDateHeb:()=> '05.11.2026',console,
  confirmSystemMessage:async (message,options)=>{warnings.push({message,options});return confirmResult;},
  showSystemMessage:async message=>{alerts.push(message);},
  deleteRecord:async(...args)=>{deletions.push(args);return deleteImpl();},
  deleteAttachment:async()=>{},deleteAttachmentRecord:async()=>{},
 };
 runInNewContext(deletion+'\nthis.api={buildDeletedTravelNotice,handleDelete};',context);
 const row=dom.window.document.querySelector('#row');
 const remove=(extra={})=>context.api.handleDelete({record,instructor:{empId:1},row,
  hasDailyTravel:true,onRefresh:notice=>refreshes.push(notice),...extra});
 return {dom,row,warnings,alerts,refreshes,deletions,navigation,remove,
  notice:options=>context.api.buildDeletedTravelNotice({date,records:[],editable:true,
    onTravelReport:day=>navigation.push(day),...options})};
}
test('deleting attendance asks only yes or no; no means nothing is deleted',async()=>{
 const s=setup({confirmResult:false});try{
  await s.remove();assert.equal(s.deletions.length,0);assert.equal(s.refreshes.length,0);
  assert.equal(s.warnings.length,1);
  assert.equal(s.warnings[0].message,'האם אתה בטוח?');
  assert.equal(s.warnings[0].options.confirmLabel,'כן');
  assert.equal(s.warnings[0].options.cancelLabel,'לא');
 }finally{s.dom.window.close();}
});
test('successful deletion carries relevant date to refreshed reports and prevents duplicate clicks',async()=>{
 let release;const s=setup({deleteImpl:()=>new Promise(resolve=>{release=resolve;})});try{
  const pending=s.remove();await s.remove();assert.equal(s.deletions.length,1);
  release();await pending;
  assert.equal(s.refreshes[0].deletedTravelDate,date);assert.deepEqual(s.alerts,[]);
 }finally{s.dom.window.close();}
});
test('remaining physical attendance shows exact message and one direct existing-travel action',()=>{
 const s=setup();try{
  const notice=s.notice({records:[{id:'remaining',report_date:date,activity_type:'קורס'}]});
  assert.equal(notice.querySelector('p').textContent,'בעקבות מחיקת רשומת הנוכחות, גם דיווח הנסיעות של יום זה נמחק. יש למלא מחדש את נסיעות היום.');
  assert.equal(notice.getAttribute('role'),'status');notice.querySelector('button').click();
  assert.deepEqual(s.navigation,[date]);
 }finally{s.dom.window.close();}
});
test('no refill request after last physical activity, including online-only or other-day records',()=>{
 const s=setup();try{
  for(const records of [[],[{report_date:date,activity_type:'זום'}],
   [{report_date:date,activity_type:'הכשרה',training_mode:'online'}],
   [{report_date:date,activity_type:'ביטול זמן'}],
   [{report_date:'2026-11-06',activity_type:'קורס'}]]){
   const notice=s.notice({records});assert.equal(notice.querySelector('button'),null);
   assert.doesNotMatch(notice.textContent,/יש למלא מחדש/);
  }
 }finally{s.dom.window.close();}
});
test('failed deletion restores controls without a success notice or navigation',async()=>{
 const s=setup({deleteImpl:async()=>{throw new Error('server failed');}});try{
  await s.remove();assert.equal(s.refreshes.length,0);assert.equal(s.row.dataset.deleting,undefined);
  assert.equal(s.row.style.opacity,'1');assert.match(s.alerts[0],/server failed/);
 }finally{s.dom.window.close();}
});
test('no deleted-travel notice for an online source, pre-cutover record or day without saved trip',async()=>{
 const s=setup();try{
  for(const extra of [{hasDailyTravel:false},{record:{...record,activity_type:'זום'}},
   {record:{...record,report_date:'2026-10-05'}}]){
   delete s.row.dataset.deleting;await s.remove(extra);
   assert.equal(s.refreshes.at(-1).deletedTravelDate,null);
  }
 }finally{s.dom.window.close();}
});

const service=readFileSync(new URL('../attendance/src/services/attendance.service.js',import.meta.url),'utf8');
const deleteSource=service.slice(service.indexOf('export async function deleteRecord('),service.indexOf('// ─── Month Approvals'))
 .replace('export async function','async function');
test('delete service requires server confirmation, rejects zero-row and server-error deletions',async()=>{
 for(const [response,success] of [[{data:[{id:'deleted'}],error:null},true],
  [{data:[{id:'other'}],error:null},false],
  [{data:[],error:null},false],[{data:null,error:{message:'denied'}},false]]){
  let invalidations=0;
  const query={delete(){return this;},eq(){return this;},select(){return this;},abortSignal(){return Promise.resolve(response);},maybeSingle(){return this;}};
  const context={confirmedMutation,isAdminPreviewRequested:()=>false,supabase:{from:()=>query},
   instructorAttendanceError:error=>error.message,invalidateAttendanceCache:()=>invalidations++};
  runInNewContext(deleteSource+'\nthis.remove=deleteRecord;',context);
  if(success){await context.remove('deleted',1);assert.equal(invalidations,1);}
  else {await assert.rejects(context.remove('deleted',1));assert.equal(invalidations,0);}
 }
});

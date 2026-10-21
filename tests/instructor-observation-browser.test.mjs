import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {JSDOM} from 'jsdom';

const runtime=readFileSync(new URL('../frontend/src/instructor-observation-runtime.js',import.meta.url),'utf8')
 .replace(/^import .*?;\s*$/gm,'')
 .replace(/export function /g,'function ');
const tick=()=>new Promise(r=>setTimeout(r,20));

test('manager completes, reopens read-only data, and downloads only the archived PDF',async()=>{
 const dom=new JSDOM('<table class="manager-workspace-tracking-table"><tbody><tr><td data-label="תצפית 1"><span>27.11.26</span><button data-io-open="1550" data-io-slot="1" data-io-name="מדריך בדיקה">פתיחת משוב</button></td><td data-label="תצפית 2"><button data-io-open="1550" data-io-slot="2" data-io-name="מדריך בדיקה">פתיחת משוב</button></td></tr></tbody></table>',{url:'https://test.invalid'});
 const w=dom.window,records=[],authId='11111111-1111-4111-8111-111111111111';
 const linkedActivity={row_id:'activity-test-1',activity_name:'ביומימיקרי',school:'בית ספר לבדיקות',grade:'ו׳',
   class_group:'קבוצה 2',date_1:'2026-11-27',date_2:'2026-12-04',date_3:'2026-12-11'};
 w.print=()=>{throw new Error('Viewing an archived observation must not print a regenerated PDF');};
 const sharepointUploads=[];
 const supabase={
  auth:{getUser:async()=>({data:{user:{id:authId}}})},
  functions:{invoke:async(name,{body})=>{
    assert.equal(name,'instructor-observation-sharepoint');
    if(body.action==='status')return {data:sharepointUploads.length?sharepointUploads.at(-1):{saved:false},error:null};
    assert.equal(body.action,'save');
    const receipt={saved:true,file_name:'מדריך בדיקה - תצפית 1 - 11.12.2026 - test.pdf',
      observation_slot:1,url:'https://think365orgil.sharepoint.com/sites/taasiyeda2027/example.pdf'};
    sharepointUploads.push(receipt);
    return {data:receipt,error:null};
  }},
  from(table){
   let op='',payload=null,filters=[];
   return {
    select(){return this},
    eq(key,value){filters.push([key,value]);return this},
    or(){return this},
    order(){return this},
    limit(){return Promise.resolve({data:table==='activities'?[linkedActivity]:records.filter(x=>x.emp_id===1550),error:null})},
    insert(row){op='insert';payload=row;return this},
    update(row){op='update';payload=row;return this},
    async single(){
     if(op==='insert'){
      const record={...payload,id:'test-record',created_by:authId};
      records.push(record);return {data:{...record},error:null};
     }
     if(op==='update'){
      const record=records.find(x=>x.id==='test-record');
      if(!record||record.status!=='draft'||filters.some(([k,v])=>record[k]!==v))
       return {data:null,error:{message:'immutable'}};
      Object.assign(record,payload);
      return {data:{id:record.id,status:record.status},error:null};
     }
     throw new Error('unexpected builder call');
    }
   };
  }
 };
 const context=vm.createContext({
  document:w.document,window:w,MutationObserver:w.MutationObserver,
  requestAnimationFrame:fn=>Promise.resolve().then(fn),
  setTimeout,clearTimeout,supabase,
  waitForSupabaseAuthSession:async()=>null,console,
  URL:w.URL,Date,Promise
 });
 try{
  vm.runInContext(runtime+'; installInstructorObservationRuntime({getUser:()=>({role:"operation_manager",is_active:true,full_name:"צופה"})});',context);
  await tick();
  const click=async selector=>{
   const el=w.document.querySelector(selector);
   assert.ok(el,'Missing UI control '+selector);
   el.click();await tick();
  };
  await click('[data-io-open="1550"]');
  assert.ok(w.document.querySelector('.io-home-head'),'Home dialog has compact grouped heading and action');
  assert.equal(w.document.querySelectorAll('.io-home-head [data-io-action="new"]').length,1);
  assert.equal(w.document.querySelectorAll('.io-home .io-lead').length,0,
    'Oversized introductory banner removed from the observation launcher');
  await click('[data-io-action="new"]');
  assert.equal(records.length,1);
  assert.equal(records[0].details.observation_slot,1);
  await click('[data-io-action="next"]');
  const fill=(sel,value)=>{
   const el=w.document.querySelector(sel);
   assert.ok(el,'Missing field '+sel);
   el.value=value;el.dispatchEvent(new w.Event('input',{bubbles:true}));
  };
  // Regression for the reported case: new observation defaults to 20 Oct,
  // but the selected course starts later. Propose its actual first planned date.
  vm.runInContext("selected.observation_date='2026-10-20'",context);
  w.document.querySelector('[data-io-detail="date"]').value='2026-10-20';
  const activityPicker=w.document.querySelector('[data-io-pick-activity]');
  assert.ok(activityPicker,'Expected linked activity list');
  activityPicker.value='0';
  activityPicker.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(w.document.querySelector('[data-io-detail="course"]').value,'ביומימיקרי');
  assert.equal(w.document.querySelector('[data-io-detail="school"]').value,'בית ספר לבדיקות');
  assert.equal(w.document.querySelector('[data-io-detail="class"]').value,'ו׳ · קבוצה 2');
  assert.equal(w.document.querySelector('[data-io-detail="meeting"]').value,'1');
  assert.equal(w.document.querySelector('[data-io-detail="date"]').value,'2026-11-27');
  assert.match(w.document.querySelector('[data-io-activity-info]').textContent,/מועד מתוכנן/);
  assert.equal(vm.runInContext('selected.details.activity_row_id',context),'activity-test-1');
  const meetingPicker=w.document.querySelector('[data-io-pick-meeting]');
  assert.ok(meetingPicker,'Scheduled meeting picker must appear after activity selection');
  assert.equal(meetingPicker.querySelectorAll('option').length,4);
  meetingPicker.value='2';
  meetingPicker.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(w.document.querySelector('[data-io-detail="date"]').value,'2026-12-04');
  assert.equal(w.document.querySelector('[data-io-detail="meeting"]').value,'2');
  fill('[data-io-detail="date"]','2026-12-04');
  assert.equal(w.document.querySelector('[data-io-detail="meeting"]').value,'2');
  fill('[data-io-detail="date"]','2026-12-25');
  assert.equal(w.document.querySelector('[data-io-detail="meeting"]').value,'');
  assert.match(w.document.querySelector('[data-io-activity-info]').textContent,/התאריך אינו תואם למפגש מתוכנן/);
  fill('[data-io-detail="meeting"]','3');
  fill('[data-io-detail="date"]','2026-12-11');
  assert.equal(w.document.querySelector('[data-io-detail="meeting"]').value,'3',
    'Manual meeting correction must not be overwritten by changing the date');
  fill('[data-io-detail="course"]','קורס הדגמה');
  fill('[data-io-detail="school"]','בית ספר ניסוי');
  fill('[data-io-detail="class"]','ט');
  fill('[data-io-detail="meeting"]','2');
  fill('[data-io-detail="students"]','24');
  fill('[data-io-detail="school_staff"]','כן');
  await click('[data-io-action="next"]');
  const scoreRow=w.document.querySelector('.io-question--rating');
  assert.ok(scoreRow,'The domain contains a graded question');
  assert.deepEqual(
    [...scoreRow.querySelectorAll('[data-io-answer]')].map(el=>el.value),
    ['5','4','3','2','1'],'All graded questions have five numbered options');
  assert.deepEqual(
    [...scoreRow.querySelectorAll('.io-option span')].map(el=>el.textContent),
    ['5 – מצוין','4 – טוב מאוד','3 – טוב','2 – טעון שיפור','1 – חלש']);
  // Deliberately skip the fourth observation section to test direct review navigation.
  for(let section=0;section<6;section++){
   const groups=new Set([...w.document.querySelectorAll('[data-io-answer]')].map(x=>x.name));
   if(section!==3) for(const name of groups){
    const first=[...w.document.querySelectorAll('[data-io-answer]')].find(x=>x.name===name);
    first.click();
   }
   await click('[data-io-action="next"]');
  }
  assert.ok(w.document.querySelector('[data-io-overall]'));
  await click('[data-io-overall][value="4"]');
  fill('[data-io-text="strengths"]','חוזקות מקצועיות');
  fill('[data-io-text="improvements"]','המלצה לשיפור');
  fill('[data-io-text="summary"]','דוח תצפית מלא');
  await click('[data-io-action="next"]');
  // Final review must show precisely the skipped step as an actionable row.
  const incomplete=w.document.querySelectorAll('[data-io-action="jump"].is-incomplete');
  assert.equal(incomplete.length,1);
  assert.equal(incomplete[0].dataset.ioJump,'5');
  assert.match(incomplete[0].textContent,/דורש השלמה/);
  assert.ok(w.document.querySelector('[data-io-action="jump"][data-io-jump="1"]'),
    'Details should also be independently accessible from review');
  await click('[data-io-action="finish"]');
  assert.equal(records[0].status,'draft','Incomplete observation cannot be finalized');
  assert.match(w.document.querySelector('[data-io-status]').textContent,/נדרש להשלים/);
  await click('[data-io-action="jump"][data-io-jump="5"]');
  assert.match(w.document.querySelector('.io-progress-header').textContent,/שלב 6 מתוך 10/);
  assert.ok(w.document.querySelector('[data-io-action="review"]'),'Direct return to review should be available');
  for(const name of new Set([...w.document.querySelectorAll('[data-io-answer]')].map(x=>x.name))){
    const first=[...w.document.querySelectorAll('[data-io-answer]')].find(x=>x.name===name);
    first.click();
  }
  await click('[data-io-action="review"]');
  assert.equal(w.document.querySelectorAll('[data-io-action="jump"].is-incomplete').length,0);
  assert.equal(w.document.querySelectorAll('[data-io-action="jump"].is-complete').length,8);
  assert.equal(records[0].details.students,'24','Details filled earlier remain saved');
  assert.equal(records[0].strengths,'חוזקות מקצועיות','Summary remains saved');
  await click('[data-io-action="finish"]');
  assert.equal(records[0].status,'completed');
  assert.equal(sharepointUploads.length,1,'Completion uploads exactly one finalized PDF');
  assert.equal(w.document.querySelectorAll('[data-io-action="sharepoint"]').length,0,
    'Upload confirmation replaces retry button');
  assert.match(w.document.querySelector('.io-sp-saved').textContent,/מדריך בדיקה - תצפית 1/);
  assert.equal(w.document.querySelector('.io-sp-saved a').href,
    'https://think365orgil.sharepoint.com/sites/taasiyeda2027/example.pdf');
  assert.equal(Object.keys(records[0].responses).length,15);
  assert.equal(records[0].responses['0-1'],'5','Numeric score must persist, not the old text label');
  const printable=w.document.querySelector('.io-print');
  assert.ok(printable.textContent.includes('דוח תצפית מלא'));
  assert.equal(printable.querySelectorAll('.io-report-question').length,15);
  assert.equal(printable.querySelectorAll('.io-report-choice.is-selected').length,15);
  const gradedPrinted=printable.querySelector('.io-report-choices--rating');
  assert.ok(gradedPrinted);
  assert.equal(gradedPrinted.querySelectorAll('.io-report-choice').length,5);
  assert.match(gradedPrinted.querySelector('.io-report-choice.is-selected').textContent,/5 – מצוין/);
  assert.match(printable.querySelector('.io-report-rating-key').textContent,/2 – טעון שיפור/);
  assert.match(printable.querySelector('.io-report-section:last-of-type').textContent,/4 – טוב מאוד/);
  assert.equal(w.document.querySelector('[data-io-action="print"]'),null,'No regenerating or printing a new PDF');
  assert.equal(w.document.querySelector('.io-original-download').href,
    'https://think365orgil.sharepoint.com/sites/taasiyeda2027/example.pdf?download=1');
  assert.ok(w.document.querySelector('.io-archived-viewer .io-report').textContent.includes('חוזקות מקצועיות'));
  await click('[data-io-action="home"]');
  sharepointUploads.length=0; // Simulate an existing completed report whose PDF is missing.
  await click('[data-io-resume="test-record"]');
  await tick();
  assert.equal(sharepointUploads.length,1,'Reopening a previously completed report archives its missing PDF');
  assert.match(w.document.querySelector('.io-sp-saved').textContent,/תצפית 1/);
  assert.ok(w.document.querySelector('.io-original-download'),'Recovered original PDF has a download link');
  assert.equal(w.document.querySelector('[data-io-action="finish"]'),null);
  await click('[data-io-action="close"]');
  await click('[data-io-open="1550"][data-io-slot="2"]');
  assert.match(w.document.querySelector('.io-dialog').textContent, /תצפית 2/);
  assert.match(w.document.querySelector('.io-history').textContent, /עדיין לא נערכו תצפיות/);
  await click('[data-io-action="new"]');
  assert.equal(records[1].details.observation_slot,2);
 }finally{dom.window.close();}
});

test('tracking eye opens saved observation data and downloads the original SharePoint file only on demand',async()=>{
 const dom=new JSDOM('<table><tbody><tr><td class="is-done"><button data-io-open="1550" data-io-slot="1" data-io-name="מדריכה">עין 1</button></td><td><button data-io-open="1550" data-io-slot="2" data-io-name="מדריכה">עין 2</button></td></tr></tbody></table>',{url:'https://test.invalid'});
 const w=dom.window;
 const pdfUrl='https://think365orgil.sharepoint.com/sites/taasiyeda2027/report.pdf';
 const saved={saved:true,url:pdfUrl,file_name:'תצפית 1.pdf',observation_slot:1};
 const record={id:'saved-observation-1',emp_id:1550,status:'completed',
   details:{observation_slot:1,school:'בית ספר',course:'ביומימיקרי',students:'25'},
   instructor_name:'מדריכה',observer_name:'מנהל',observation_date:'2026-10-13',
   responses:{'0-0':'כן','0-1':'4'},comments:{'0':'הערת הצופה'},
   overall_rating:4,strengths:'חוזקה מקורית',improvements:'המלצה',summary:'סיכום שנשמר'};
 let statusCalls=0, openedTabs=0, saves=0;
 w.open=()=>{openedTabs++;return null;};
 const supabase={
   auth:{getUser:async()=>({data:{user:{id:'11111111-1111-4111-8111-111111111111'}}})},
   functions:{invoke:async(slug,{body})=>{
     assert.equal(slug,'instructor-observation-sharepoint');
     if(body.action==='save'){saves++;return {data:saved,error:null};}
     assert.equal(body.action,'status');assert.equal(body.observation_id,record.id);
     statusCalls++;
     return {data:saved,error:null};
   }},
   from(table){
     return {select(){return this},eq(){return this},order(){return this},or(){return this},
       limit(){return Promise.resolve({data:table==='activities'?[]:[record],error:null})}};
   }
 };
 const context=vm.createContext({
   document:w.document,window:w,MutationObserver:w.MutationObserver,
   setTimeout,clearTimeout,supabase,waitForSupabaseAuthSession:async()=>null,
   URL:w.URL,console,Date,Promise
 });
 const click=async selector=>{
   const node=w.document.querySelector(selector);assert.ok(node,selector);node.click();await tick();await tick();
 };
 try{
   vm.runInContext(runtime+'; installInstructorObservationRuntime({getUser:()=>({role:"admin",is_active:true})});',context);
   await click('[data-io-slot="1"]');
   assert.equal(openedTabs,0,'Eye click must not open a new tab or download');
   assert.equal(saves,0,'A saved original is never regenerated');
   assert.equal(statusCalls,1,'Read the existing verified SharePoint receipt');
   const viewer=w.document.querySelector('.io-archived-viewer');
   assert.ok(viewer,'A completed observation opens inside the dashboard');
   assert.match(viewer.textContent,/בית ספר/);
   assert.match(viewer.textContent,/סיכום שנשמר/);
   assert.match(viewer.textContent,/חוזקה מקורית/);
   assert.match(viewer.textContent,/הערת הצופה/);
   assert.equal(viewer.querySelectorAll('.io-report-question').length,15,'All saved answers are displayed');
   assert.equal(w.document.querySelectorAll('[data-io-action="new"]').length,0);
   assert.equal(w.document.querySelectorAll('[data-io-action="print"]').length,0);
   assert.equal(w.document.querySelectorAll('[data-io-action="finish"]').length,0);
   const button=w.document.querySelector('.io-original-download');
   assert.ok(button,'Download is an explicit second action');
   assert.equal(button.href,pdfUrl+'?download=1');
   assert.equal(button.getAttribute('target'),'_blank');
   assert.equal(button.getAttribute('rel'),'noopener noreferrer');
   assert.equal(w.document.querySelector('.io-sp-saved a').href,pdfUrl,
     'The document reference points to the original SharePoint item');
   await click('[data-io-action="home"]');
   await click('[data-io-resume="saved-observation-1"]');
   assert.ok(w.document.querySelector('.io-archived-viewer'),'History also opens read-only values');
   await click('[data-io-action="close"]');
   await click('[data-io-slot="2"]');
   assert.ok(w.document.querySelector('.io-home-head'),'Incomplete second slot offers new observation');
   assert.equal(openedTabs,0,'No popup even on incomplete slot');
 }finally{dom.window.close();}
});

test('archived original link accepts only the correct HTTPS SharePoint location',()=>{
 const context=vm.createContext({URL});
 vm.runInContext(runtime,context);
 const safe=vm.runInContext("archivedOriginalDownloadUrl('https://think365orgil.sharepoint.com/sites/taasiyeda2027/docs/p.pdf?web=1&x=2')",context);
 assert.equal(safe,'https://think365orgil.sharepoint.com/sites/taasiyeda2027/docs/p.pdf?x=2&download=1');
 const blocked=vm.runInContext("archivedOriginalDownloadUrl('https://evil.example.com/sites/taasiyeda2027/report.pdf')",context);
 assert.equal(blocked,'');
});

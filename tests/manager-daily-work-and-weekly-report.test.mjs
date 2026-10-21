import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const source=await readFile(new URL('../frontend/src/manager-weekly-manual-tracking.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20261020115000_manager_ongoing_tasks_weekly_snapshots.sql',import.meta.url),'utf8');
const isolated=source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
const {taskSummary,frozenTaskSnapshot,taskMarkup,validateWeeklyReport}=runInNewContext(
  isolated+'\n({taskSummary,frozenTaskSnapshot,taskMarkup,validateWeeklyReport})',{Date}
);
const sample=[
 {id:'t-1',subject:'להכין ערכת ביומימיקרי',manager_user_id:'1500',status:'open',owner_label:'הילה',due_date:'2026-10-20',updated_at:'2026-10-18T10:00:00Z',activity_label:'קציר',category:'kit',notes:''},
 {id:'t-2',subject:'לתאם הכשרה',manager_user_id:'1500',status:'done',owner_label:'הילה',due_date:'2026-10-21',updated_at:'2026-10-19T11:00:00Z',activity_label:'קציר',category:'training',notes:'בוצע'}
];
test('ongoing tasks retain active items across week boundary',()=>{
 const ctx={week:'2026-10-25',tasks:sample};
 const snapshot=frozenTaskSnapshot(ctx);
 assert.equal(snapshot.length,1);
 assert.equal(snapshot[0].id,'t-1');
 assert.notEqual(snapshot[0],sample[0],'snapshot must be detached');
 sample[0].notes='changed later';
 assert.equal(snapshot[0].notes,'');
});
test('weekly submission takes separate completed task snapshot',()=>{
 const snap=frozenTaskSnapshot({week:'2026-10-18',tasks:sample});
 assert.equal(snap.length,2);
 assert.equal(snap[1].status,'done');
});
test('tasks remain editable for manager even when weekly report already submitted',()=>{
 const html=taskMarkup({canEdit:true,tasks:sample,year:'2027',managerId:'1500'});
 assert.match(html,/data-mw-task-save="t-1"/);
 assert.match(html,/data-mw-task-add/);
 assert.match(html,/data-mw-task-field="status"/);
 const readonly=taskMarkup({canEdit:false,tasks:sample});
 assert.doesNotMatch(readonly,/data-mw-task-save/);
 assert.doesNotMatch(readonly,/data-mw-task-add/);
});
test('task category, state, owner and deadline are visible to manager',()=>{
 const s=taskSummary(sample);
 assert.equal(s.pending,1);
 assert.equal(s.done,1);
 assert.match(taskMarkup({canEdit:true,tasks:sample}),/להכין ערכת ביומימיקרי/);
});
test('report submission validates five metrics only, without repeating issue details',()=>{
 const report={week_start:'2026-10-18',metrics:{activities:2,schools:1,unassigned:0,planned:1,started:0},openings:[],highlights:'',next_steps:''};
 assert.equal(validateWeeklyReport(report),'');
 delete report.metrics.activities;
 assert.match(validateWeeklyReport(report),/פעילויות/);
});
test('issue statuses are only open or closed and both appear in the dropdown',()=>{
 const html=taskMarkup({canEdit:true,tasks:sample,year:'2027',managerId:'1500'});
 assert.match(html,/value="open"/);
 assert.match(html,/value="closed"/);
 assert.doesNotMatch(html,/<option value="in_progress"/);
 assert.doesNotMatch(html,/<option value="waiting"/);
});
test('database enforces owned task writes, read-only admin and permanent submitted report snapshot',()=>{
 assert.match(migration,/enable row level security/);
 assert.match(migration,/manager_ongoing_tasks_update_self/);
 assert.match(migration,/manager_weekly_self_user_id/);
 assert.match(migration,/tasks_snapshot jsonb/);
 assert.doesNotMatch(migration,/for (delete|truncate) to authenticated/i);
 assert.doesNotMatch(source,/\.update\(.+\)\.from\('activities'\)/);
});


function multipleIssueHarness() {
  const dom=new JSDOM('<div id="host"><section data-mw-tasks-root></section></div>',{url:'https://example.test'});
  const writes=[];
  let failNext=false;
  const supabase={from(table){
    assert.equal(table,'manager_ongoing_tasks');
    return {insert(payloads){
      assert.ok(Array.isArray(payloads),'New problems must be inserted as multiple independent rows');
      writes.push(payloads);
      return {async select() {
        if(failNext){failNext=false;return {data:null,error:{message:'temporary failure'}};}
        return {data:payloads.map((payload,i)=>({...payload,id:'saved-'+writes.length+'-'+i})),error:null};
      }};
    }};
  }};
  const api=runInNewContext(isolated+'\n({refreshTaskSection,taskMarkup,taskSummary,addTask,__setActive:(ctx)=>{active=ctx;}})',
    {Date,console,supabase,document:dom.window.document,window:dom.window});
  const ctx={host:dom.window.document.getElementById('host'),managerId:'1500',year:'2027',
    tasks:[],canEdit:true,taskBusy:false,managerName:'הילה רוזן'};
  api.__setActive(ctx);
  api.refreshTaskSection(ctx);
  const fill=(index,key,value)=>{
    const row=ctx.host.querySelectorAll('[data-mw-task-draft]')[index];
    assert.ok(row,'Expected draft row '+index);
    const field=row.querySelector('[data-mw-task-new="'+key+'"]');
    assert.ok(field,'Missing '+key);
    field.value=value;field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  };
  const click=(selector)=>{const button=ctx.host.querySelector(selector);assert.ok(button,selector);button.click();};
  const save=async()=>{await api.addTask(ctx);};
  return {api,ctx,dom,writes,fill,click,save,failOnce:()=>{failNext=true;}};
}
test('section 2 plus control adds as many independent issue lines as needed',()=>{
 const {ctx,click,fill}=multipleIssueHarness();
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,1);
 const first=ctx.host.querySelector('[data-mw-task-new="subject"]');
 fill(0,'subject','חוסר במדריכים');
 click('[data-mw-task-new-row-add]');
 click('[data-mw-task-new-row-add]');
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,3);
 assert.equal(first.value,'חוסר במדריכים','Adding more rows must not wipe previously typed information');
 fill(1,'subject','קורס ללא ערכות');
 fill(2,'subject','בעיה בתיאום');
 click('[data-mw-task-draft]:nth-child(2) [data-mw-task-draft-remove]');
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,2);
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-new="subject"]')[1].value,'בעיה בתיאום');
 click('[data-mw-task-new-row-add]');
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,3);
});
test('saving multiple problems creates separate persisted rows and resets to one empty line',async()=>{
 const {ctx,fill,click,save,writes}=multipleIssueHarness();
 fill(0,'subject','אין מדריך');
 fill(0,'activity_label','קציר');
 fill(0,'category','instructor_shortage');
 click('[data-mw-task-new-row-add]');
 fill(1,'subject','אין ערכות');
 fill(1,'category','kit');
 fill(1,'due_date','2026-11-02');
 await save();
 assert.equal(writes.length,1,'Single batch write');
 assert.equal(writes[0].length,2);
 assert.deepEqual(writes[0].map(x=>x.subject),['אין מדריך','אין ערכות']);
 assert.deepEqual(writes[0].map(x=>x.category),['instructor_shortage','kit']);
 assert.equal(writes[0][0].manager_user_id,'1500');
 assert.equal(writes[0][1].school_year,'2027');
 assert.equal(ctx.tasks.length,2,'Both tasks added as distinct persistent entries');
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-row]').length,2);
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,1);
 assert.equal(ctx.host.querySelector('[data-mw-task-new="subject"]').value,'');
 assert.match(ctx.host.querySelector('[data-mw-task-notice]').textContent,/נשמרו 2 בעיות/);
});
test('invalid row and server failure keep all typed issue rows for correction',async()=>{
 const {ctx,fill,click,save,writes,failOnce}=multipleIssueHarness();
 fill(0,'subject','מדריך לא הגיע');
 click('[data-mw-task-new-row-add]');
 fill(1,'notes','דרוש בירור');
 await save();
 assert.equal(writes.length,0,'A partially populated row without subject cannot be saved');
 assert.match(ctx.host.querySelector('[data-mw-task-notice]').textContent,/שורה 2/);
 fill(1,'subject','ביטול מפגש');
 failOnce();
 await save();
 assert.equal(writes.length,1);
 assert.equal(ctx.tasks.length,0);
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-draft]').length,2);
 assert.equal(ctx.host.querySelectorAll('[data-mw-task-new="subject"]')[1].value,'ביטול מפגש');
 await save();
 assert.equal(writes.length,2);
 assert.equal(ctx.tasks.length,2);
});
test('admin viewing section 2 cannot add or edit problem rows',()=>{
 const {api,ctx}=multipleIssueHarness();
 const readOnly=api.taskMarkup({...ctx,canEdit:false});
 assert.doesNotMatch(readOnly,/data-mw-task-new-row-add/);
 assert.doesNotMatch(readOnly,/data-mw-task-add/);
 assert.doesNotMatch(readOnly,/data-mw-task-draft/);
});

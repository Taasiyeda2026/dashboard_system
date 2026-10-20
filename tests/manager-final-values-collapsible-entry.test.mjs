import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { JSDOM } from 'jsdom';

const source=await readFile(new URL('../frontend/src/manager-weekly-manual-tracking.js',import.meta.url),'utf8');
const migration=await readFile(new URL('../supabase/migrations/20261021100000_manager_final_values_no_drafts.sql',import.meta.url),'utf8');
const isolated=source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');

function setup() {
  const dom=new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>',{url:'https://example.test'});
  const writes=[];
  const supabase={from(table){
    assert.equal(table,'manager_weekly_reports');
    return {upsert(payload){
      return {select(){return {async single(){
        const row={...payload,id:'row1',updated_at:'2026-10-21T12:00:00Z'};
        writes.push(JSON.parse(JSON.stringify(row)));
        return {data:row,error:null};
      }}}};
    }};
  }};
  const sandbox={
    Date,console,setTimeout,clearTimeout,document:dom.window.document,window:dom.window,
    state:{user:{role:'activities_manager',user_id:'1500'}},supabase
  };
  const api=runInNewContext(isolated+'\n({formMarkup,tableMarkup,render,toggleEntry,changeWeek,saveWeekly,__setActive:(ctx)=>{active=ctx;}})',sandbox);
  const ctx={
    host:dom.window.document.getElementById('host'),managerName:'הילה רוזן',year:'2027',ym:'2026-10',
    week:'2026-10-18',managerId:'1500',canEdit:true,loading:false,taskBusy:false,busy:false,
    dirty:false,notice:null,tasks:[],programs:[],reports:[],savedReports:[],entryExpanded:false,
    autoSaveTimer:null,saveInFlight:null,changeSeq:0,editingReport:null
  };
  api.__setActive(ctx);
  api.render(ctx);
  return {api,ctx,dom,writes};
}
function fill(el,value) {
  assert.ok(el,'Expected form input');
  el.value=value;
  el.dispatchEvent(new el.ownerDocument.defaultView.Event('input',{bubbles:true}));
}

test('all fields are hidden by default while the weekly summary remains visible',()=>{
  const {ctx}=setup();
  assert.equal(ctx.host.querySelector('[data-mw-report-fields]').hidden,true);
  assert.ok(ctx.host.querySelector('[data-mw-weekly-table]'));
  assert.match(ctx.host.querySelector('[data-mw-toggle]').textContent,/פתח מילוי מדדים/);
  assert.doesNotMatch(ctx.host.textContent,/טיוטה/);
});
test('opening, entering a final value and closing persist before the form is hidden',async()=>{
  const {api,ctx,writes}=setup();
  await api.toggleEntry(ctx);
  assert.equal(ctx.host.querySelector('[data-mw-report-fields]').hidden,false);
  fill(ctx.host.querySelector('[data-mw-metric="activities"]'),'108');
  assert.equal(ctx.dirty,true);
  assert.equal(await api.toggleEntry(ctx),true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].metrics.activities,108);
  assert.equal(writes[0].status,'current');
  assert.equal(ctx.host.querySelector('[data-mw-report-fields]').hidden,true);
  assert.match(ctx.host.querySelector('[data-mw-weekly-table]').textContent,/108/);
  await api.toggleEntry(ctx);
  assert.equal(ctx.host.querySelector('[data-mw-metric="activities"]').value,'108');
});
test('week switching saves the current entries, without submitting any board report',async()=>{
  const {api,ctx,writes}=setup();
  await api.toggleEntry(ctx);
  fill(ctx.host.querySelector('[data-mw-metric="schools"]'),'49');
  await api.changeWeek(ctx,'2026-10-25');
  assert.equal(writes.at(-1).status,'current');
  assert.equal(writes.at(-1).metrics.schools,49);
  assert.equal(ctx.week,'2026-10-25');
  assert.equal(ctx.entryExpanded,false);
});
test('submit remains a separate validated, immutable weekly management snapshot',async()=>{
  const {api,ctx,writes}=setup();
  await api.toggleEntry(ctx);
  for(const key of ['activities','schools','unassigned','planned','started']){
    fill(ctx.host.querySelector('[data-mw-metric="'+key+'"]'),'0');
  }
  assert.equal(await api.saveWeekly(ctx,true),true);
  assert.equal(writes.at(-1).status,'submitted');
  assert.ok(writes.at(-1).submitted_at);
  assert.equal(ctx.host.querySelector('[data-mw-report-fields]').hidden,true);
  await api.toggleEntry(ctx);
  assert.equal(ctx.host.querySelector('[data-mw-metric="activities"]').disabled,true);
});
test('migration changes persisted draft states without erasing numbers or submitted snapshots',()=>{
  assert.match(migration,/set status = 'current'/);
  assert.match(migration,/where status = 'draft'/);
  assert.match(migration,/status in \('current','submitted'\)/);
  assert.match(migration,/status = 'current'/);
  assert.doesNotMatch(migration,/delete from public\.manager_weekly_reports/i);
});


test('workspace hides requested instructional copy and summary counters without removing task controls',()=>{
  const {ctx,api}=setup();
  ctx.tasks=[{
    id:'task-1',subject:'הכשרת מדריך',activity_label:'בית ספר',
    category:'training',owner_label:'הילה',due_date:'2026-10-25',
    status:'open',notes:'נדרש תיאום'
  }];
  api.render(ctx);
  const screen=ctx.host.textContent;
  for(const unwanted of [
    'כל נתון שמנהל הפעילות מזין הוא נתון סופי',
    'אזור המילוי נפתח בלחיצה',
    'עדכון לאורך השבוע. משימות ממשיכות',
    'שבועות שהוגשו בשנת הפעילות',
    'פתוחות: 1',
    'באיחור: 0',
    'הושלמו: 0'
  ])assert.doesNotMatch(screen,new RegExp(unwanted));
  assert.ok(ctx.host.querySelector('[data-mw-task-row="task-1"]'));
  assert.ok(ctx.host.querySelector('[data-mw-task-add]'));
  assert.ok(ctx.host.querySelector('[data-mw-toggle]'));
  assert.deepEqual([...ctx.host.querySelectorAll('.mw-tracker > .mw-section-head > h3')].map(e=>e.textContent),['1. מדדים שבועיים','2. בעיות ומעקב']);
  assert.ok(ctx.host.querySelector('[data-mw-weekly-table]'));
});


test('all five metric entry fields fit a single desktop grid row, with right-aligned metric labels', async()=>{
  const {ctx,api}=setup();
  await api.toggleEntry(ctx);
  const table=ctx.host.querySelector('.mw-table');
  assert.ok(table,'Weekly metrics table must remain available');
  assert.equal(table.querySelector('thead th:first-child').textContent.trim(),'מדדים');
  assert.equal(table.querySelectorAll('tbody tr').length,5);
  for(const row of table.querySelectorAll('tbody tr')){
    assert.ok(row.querySelector('td:first-child').textContent.trim(),
      'Each metrics label remains visible in the first column');
  }
  assert.match(source,/\.mw-table th:first-child,\.mw-table td:first-child\{[^}]*text-align:right/);
  assert.match(source,/\.mw-fields\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\);gap:10px\}/);
  assert.match(source,/\.mw-fields \.mw-field input\{width:100%;min-width:0;box-sizing:border-box/);
  assert.equal(ctx.host.querySelectorAll('[data-mw-metric]').length,5,
    'All metric inputs remain available after resizing');
});

test('only five numeric metrics and the issue ledger are displayed, with no repeated narrative forms', async()=>{
  const {api,ctx}=setup();
  await api.toggleEntry(ctx);
  const metrics=[...ctx.host.querySelectorAll('[data-mw-metric]')];
  assert.deepEqual(metrics.map(m=>m.dataset.mwMetric),['activities','schools','unassigned','planned','started']);
  assert.equal(ctx.host.querySelectorAll('[data-mw-input],[data-mw-opening],[data-mw-program]').length,0);
  assert.equal(ctx.host.querySelector('[data-mw-task-new="category"] option').textContent,'פעילות שלא שובצה');
  const statuses=[...ctx.host.querySelectorAll('[data-mw-task-new="status"] option')].map(n=>n.textContent);
  assert.deepEqual(statuses,['פתוח','סגור']);
});

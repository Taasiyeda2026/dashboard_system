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
  const api=runInNewContext(isolated+'\n({formMarkup,tableMarkup,render,toggleEntry,changeWeek,saveWeekly,timelineCurrentWeek,timelineWeeks,visibleWeeks,labelWeek,REPORT_START,REPORT_END,__setActive:(ctx)=>{active=ctx;}})',sandbox);
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
    assert.ok(row.querySelector('th[scope="row"]').textContent.trim(),
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


test('five date columns stay in RTL order with the current week highlighted at the centre',()=>{
  const {api,ctx}=setup();
  ctx.today='2026-10-21';
  api.render(ctx);
  const header=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(header.length,6,'Metrics + five week columns');
  assert.deepEqual(header.slice(1).map(h=>h.querySelector('[data-mw-week]').dataset.mwWeek),
    ['2026-10-04','2026-10-11','2026-10-18','2026-10-25','2026-11-01']);
  assert.match(header[1].textContent,/לפני שבועיים/);
  assert.match(header[2].textContent,/השבוע שחלף/);
  assert.match(header[3].textContent,/השבוע הנוכחי/);
  assert.match(header[4].textContent,/השבוע הבא/);
  assert.match(header[5].textContent,/בעוד שבועיים/);
  assert.ok(header[3].classList.contains('mw-current'),'Centre week is highlighted');
  assert.equal(ctx.host.querySelectorAll('.mw-table .mw-current').length,6);
  assert.equal(ctx.host.querySelectorAll('.mw-table tbody tr').length,5);
  for(const row of ctx.host.querySelectorAll('.mw-table tbody tr'))
    assert.equal(row.children.length,6,'Exactly five week values per metric');
});
test('reporting calendar is 04 Oct 2026 to 30 Jun 2027; only distant weeks appear in pickers',()=>{
  const {api,ctx}=setup();
  ctx.today='2026-11-11';
  api.render(ctx);
  assert.equal(api.REPORT_START,'2026-10-04');
  assert.equal(api.REPORT_END,'2027-06-30');
  const weeks=api.timelineWeeks(ctx);
  assert.equal(weeks.at(0),'2026-10-04');
  assert.equal(weeks.at(-1),'2027-06-27');
  assert.equal(weeks.length,39);
  assert.equal(api.labelWeek('2027-06-27'),'27.06–30.06');
  const past=ctx.host.querySelector('[data-mw-picker="past"]');
  const future=ctx.host.querySelector('[data-mw-picker="future"]');
  assert.ok(past&&!past.open);
  assert.ok(future&&!future.open);
  assert.ok(past.querySelector('[data-mw-week="2026-10-04"]'));
  assert.ok(future.querySelector('[data-mw-week="2027-06-27"]'));
  for(const week of api.visibleWeeks(ctx)){
    assert.equal(ctx.host.querySelector('.mw-week-picker [data-mw-week="'+week+'"]'),null,
      'Already-visible weeks must not be duplicated in dropdowns');
  }
  assert.equal(ctx.host.querySelector('[data-mw-week="2026-09-27"]'),null);
  assert.equal(ctx.host.querySelector('[data-mw-week="2027-07-04"]'),null);
  assert.doesNotMatch(source,/\.mw-table-scroll\{[^}]*overflow:auto/);
  assert.match(source,/\.mw-table\{width:100%;min-width:0/);
});
test('distant selected weeks appear below but never add a sixth week column',async()=>{
  const {api,ctx}=setup();
  ctx.today='2026-10-21';
  api.render(ctx);
  await api.changeWeek(ctx,'2027-01-10');
  let columns=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(columns.length,6);
  assert.deepEqual(columns.slice(1).map(n=>n.querySelector('[data-mw-week]').dataset.mwWeek),
    ['2026-10-04','2026-10-11','2026-10-18','2026-10-25','2026-11-01']);
  assert.match(ctx.host.querySelector('.mw-extra-panel').textContent,/שבוע נוסף: 10.01–16.01/);
  assert.ok(ctx.host.querySelector('[data-mw-collapse]'));
  await api.changeWeek(ctx,'2026-12-06');
  columns=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(columns.length,6);
  assert.match(ctx.host.querySelector('.mw-extra-panel').textContent,/06.12–12.12/);
  ctx.host.querySelector('[data-mw-collapse]').click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ctx.host.querySelectorAll('.mw-table thead th').length,6);
  assert.equal(ctx.host.querySelector('.mw-extra-panel'),null);
  assert.equal(ctx.week,'2026-10-18');
});
test('five positions remain at year boundaries, with out-of-range weeks disabled',async()=>{
  const {api,ctx}=setup();
  ctx.today='2026-10-04';
  ctx.week='2026-10-04';
  api.render(ctx);
  let headers=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(headers.length,6);
  assert.equal(headers[1].querySelector('[data-mw-week]'),null);
  assert.equal(headers[2].querySelector('[data-mw-week]'),null);
  assert.match(headers[1].textContent,/מחוץ לתקופת המעקב/);
  assert.match(headers[2].textContent,/מחוץ לתקופת המעקב/);
  assert.equal(headers[3].querySelector('[data-mw-week]').dataset.mwWeek,'2026-10-04');
  assert.equal(headers[4].querySelector('[data-mw-week]').dataset.mwWeek,'2026-10-11');
  assert.equal(headers[5].querySelector('[data-mw-week]').dataset.mwWeek,'2026-10-18');
  assert.equal(ctx.host.querySelector('[data-mw-prev]').disabled,true);
  assert.equal(await api.changeWeek(ctx,'2026-09-27'),false);
  ctx.today='2027-06-30';
  ctx.week='2027-06-27';
  api.render(ctx);
  headers=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(headers.length,6);
  assert.equal(headers[1].querySelector('[data-mw-week]').dataset.mwWeek,'2027-06-13');
  assert.equal(headers[2].querySelector('[data-mw-week]').dataset.mwWeek,'2027-06-20');
  assert.equal(headers[3].querySelector('[data-mw-week]').dataset.mwWeek,'2027-06-27');
  assert.match(headers[3].textContent,/27.06–30.06/);
  assert.equal(headers[4].querySelector('[data-mw-week]'),null);
  assert.equal(headers[5].querySelector('[data-mw-week]'),null);
  assert.equal(ctx.host.querySelector('[data-mw-next]').disabled,true);
  assert.equal(await api.changeWeek(ctx,'2027-07-04'),false);
});
test('switching to a distant week saves the active metrics and preserves five columns',async()=>{
  const {api,ctx,writes}=setup();
  ctx.today='2026-10-21';
  api.render(ctx);
  await api.toggleEntry(ctx);
  fill(ctx.host.querySelector('[data-mw-metric="activities"]'),'25');
  assert.equal(await api.changeWeek(ctx,'2026-12-06'),true);
  assert.equal(writes.length,1);
  assert.equal(writes[0].metrics.activities,25);
  assert.equal(writes[0].week_start,'2026-10-18');
  assert.equal(ctx.entryExpanded,false);
  assert.equal(ctx.host.querySelectorAll('.mw-table thead th').length,6);
  assert.ok(ctx.host.querySelector('.mw-extra-panel'));
  await api.changeWeek(ctx,'2026-10-18');
  assert.equal(ctx.host.querySelector('.mw-extra-panel'),null);
  assert.match(ctx.host.querySelector('.mw-table').textContent,/25/);
});
test('five date columns use a centred, balanced 1020px table and remain legible on mobile',()=>{
  const {ctx}=setup();
  assert.match(source,/\.mw-table-scroll\{[^}]*width:100%;max-width:1020px/);
  assert.match(source,/\.mw-table th:first-child,\.mw-table td:first-child\{[^}]*width:35%/);
  assert.match(source,/\.mw-week-range\{font-size:10px;display:flex;flex-direction:column/);
  assert.match(source,/\.mw-week-divider\{display:none\}/);
  assert.equal(ctx.host.querySelectorAll('.mw-table thead th').length,6);
  assert.equal(ctx.host.querySelectorAll('.mw-table tbody tr').length,5);
  assert.ok(ctx.host.querySelector('.mw-table-scroll'));
  assert.doesNotMatch(source,/\.mw-table-scroll\{[^}]*overflow:auto/);
});
test('admin sees why issues are read-only; activity manager can enter and save an issue',()=>{
  const {api,ctx}=setup();
  ctx.canEdit=false;
  api.render(ctx);
  assert.match(ctx.host.querySelector('.mw-task-empty').textContent,/חשבון מנהל מערכת מיועד כאן לצפייה בלבד/);
  assert.equal(ctx.host.querySelector('[data-mw-task-add]'),null);
  ctx.canEdit=true;
  api.render(ctx);
  assert.ok(ctx.host.querySelector('[data-mw-task-new="subject"]'));
  assert.ok(ctx.host.querySelector('[data-mw-task-new="category"]'));
  assert.deepEqual([...ctx.host.querySelectorAll('[data-mw-task-new="status"] option')].map(x=>x.textContent),
    ['פתוח','סגור']);
  assert.ok(ctx.host.querySelector('[data-mw-task-add]'));
});


test('five-week table and its controls share a centred visual column without altering the data',()=>{
  const {api,ctx}=setup();
  ctx.today='2026-10-21';
  api.render(ctx);
  assert.match(source,/\.mw-tracker>\.mw-section-head,\.mw-tracker>\.mw-toolbar,\.mw-tracker>\[data-mw-weekly-table\]/);
  assert.match(source,/\.mw-table-scroll\{margin:0 auto 7px/);
  assert.match(source,/\.mw-week-range\{display:inline-flex;[^}]*direction:ltr;unicode-bidi:isolate/);
  assert.match(source,/\.mw-week-start,\.mw-week-end\{direction:ltr;unicode-bidi:isolate\}/);
  assert.match(source,/\.mw-table thead \.mw-current\{background:#bfe5f3/);
  assert.match(source,/\.mw-tracker>\.mw-report-entry\{border:1px solid #e0eaf1/);
  assert.match(source,/\.mw-task-empty\{padding:14px 16px;border:1px dashed #dce7ed/);
  assert.match(source,/\.mw-tracker>\[data-mw-notice\] \.mw-notice\{display:inline-flex/);
  assert.match(source,/\.mw-week-range\{display:flex;flex-direction:column/);
  assert.match(source,/el\.textContent = styles \+ visualPolish/);
  const header=[...ctx.host.querySelectorAll('.mw-table thead th')];
  assert.equal(header.length,6);
  assert.equal(header[3].querySelector('.mw-week-start').textContent,'18.10');
  assert.equal(header[3].querySelector('.mw-week-end').textContent,'24.10');
  assert.ok(header[3].classList.contains('mw-current'));
  assert.ok(ctx.host.querySelector('[data-mw-report-entry]'));
  assert.ok(ctx.host.querySelector('[data-mw-tasks-root]'));
});

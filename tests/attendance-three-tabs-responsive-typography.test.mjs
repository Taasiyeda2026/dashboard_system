import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const file=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('shared typography stylesheet is last and cache versions are consistent',async()=>{
  const [html,sw,css]=await Promise.all([
    file('attendance/index.html'),
    file('attendance/sw.js'),
    file('attendance/src/styles/report-tabs-responsive-typography.css'),
  ]);
  const links=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(links.at(-1),'./src/styles/report-tabs-responsive-typography.css?v=141');
  assert.match(sw,/const CACHE_VERSION = 141/);
  assert.ok(links.every(s=>s.endsWith('?v=141')));
  assert.match(css,/font-family:var\(--av2-font,inherit\)/);
  assert.match(css,/font-size:14\.5px!important/);
  assert.match(css,/font-size:17px!important/);
  assert.match(css,/font-size:13\.5px!important/);
});

test('all three report tabs have a bounded, readable responsive layout',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const screen=await file('attendance/src/screens/new-report-screen.js');
 const travel=await file('attendance/src/screens/daily-travel-tab.js');
 const expense=await file('attendance/src/screens/expenses-tab.js');
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/);
 assert.match(css,/\.av2-report \.av2-report__tabs>\.av2-btn/);
 assert.match(css,/max-width:480px!important/);
 assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,330px\)\)!important/);
 assert.match(css,/@media\(min-width:768px\)/);
 assert.match(css,/@media\(max-width:767px\)/);
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(css,/@media\(max-width:340px\)/);
 assert.match(css,/font-size:16px!important;min-height:44px!important/);
 assert.match(css,/overflow-wrap:anywhere/);
 assert.match(css,/\[hidden\]\{display:none!important\}/);
 assert.match(css,/focus-visible/);
 assert.match(screen,/tabs\.append\(attendanceTab, travelTab, expenseTab\)/);
 assert.match(travel,/reportCard\.className='av2-daily-travel__report-card'/);
 assert.match(expense,/form\.className='av2-expenses-tab__form'/);
});

test('typography contract is visual only and does not alter pay or attendance data',async()=>{
 const html=await file('attendance/index.html');
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 assert.doesNotMatch(css,/position:fixed|transform:scale\(/);
 assert.doesNotMatch(html,/supabase\/migrations/);
 assert.doesNotMatch(css,/\.av2-report__form-area \{[^}]*display:none/);
});

test('time inputs are two readable hour/minute selectors, never squeezed into half-width cells',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 assert.match(css,/\.av2-report \.av2-report__form \.av2-report__times-grid\{[\s\S]*?grid-template-columns:minmax\(0,1fr\)!important/);
 assert.match(css,/\.av2-report \.av2-report__form \.av2-time-picker\{[\s\S]*?width:196px!important/);
 assert.match(css,/\.av2-report \.av2-report__form \.av2-time-picker__part\{[\s\S]*?flex:1 1 0!important/);
 assert.match(css,/\.av2-report \.av2-report__form \.av2-time-picker__part \.av2-csel__trigger\{[\s\S]*?font-size:16px!important/);
});

test('desktop viewport-fit is compact without hiding overflow, and mobile stays scrollable',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const desktop=css.slice(css.indexOf('/*\n * Desktop viewport-fit density'));
 assert.match(desktop,/@media \(min-width: 768px\)/);
 assert.match(desktop,/@media \(min-width: 768px\) and \(max-height: 800px\)/);
 assert.match(desktop,/\.av2-report \.av2-report__tabs\{[\s\S]*?margin:4px auto 10px!important/);
 assert.match(desktop,/\.av2-report \.av2-report__form \.av2-report__times-grid\{[\s\S]*?gap:8px!important/);
 assert.match(desktop,/\.av2-report \.av2-report__form>\.av2-report__actions\{[\s\S]*?margin:5px auto 0!important/);
 assert.match(desktop,/height:auto!important;overflow:visible!important/);
 assert.doesNotMatch(desktop,/overflow:hidden|height:100vh|position:fixed/);
});

test('unselected dropdown hints are subtle, while selected values retain their appearance',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const select=await file('attendance/src/components/searchable-select.js');
 const compact=await file('attendance/src/components/compact-select.js');
 const last=css.slice(css.indexOf('/* Unselected values are hints'));
 assert.match(last,/\.av2-ssel__trigger-text\[data-empty="true"\]/);
 assert.match(last,/\.av2-csel__trigger-text\[data-empty="true"\]/);
 assert.match(last,/color:#718096!important/);
 assert.match(last,/font-size:13\.5px!important/);
 assert.match(select,/triggerText\.dataset\.empty = selectedLabel \? 'false' : 'true'/);
 assert.match(compact,/triggerText\.dataset\.empty = lbl \? 'false' : 'true'/);
});
test('notes field is labeled הערות, without altering its storage identifier',async()=>{
 const screen=await file('attendance/src/screens/new-report-screen.js');
 assert.match(screen,/id: 'av2-notes',[\s\S]*?label: 'הערות'/);
 assert.match(screen,/placeholder: 'הערות \(אופציונלי\)'/);
 assert.doesNotMatch(screen,/label: 'הערות נוספות'/);
});

test('attendance heading is accessible but not duplicated visually, and month chooser is compact',async()=>{
 const screen=await file('attendance/src/screens/new-report-screen.js');
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const contract=css.slice(css.indexOf('/*\n * Calm visual hierarchy'));
 assert.match(screen,/title\.classList\.add\('av2-report__title--sr-only'\)/);
 assert.match(contract,/\.av2-report \.av2-report__title--sr-only\{/);
 assert.match(contract,/\.av2-report \.av2-report__attendance-month\{[\s\S]*?flex-direction:row!important/);
 assert.match(contract,/width:170px!important/);
 assert.match(contract,/font-size:12\.5px!important;font-weight:600!important/);
 assert.match(contract,/font-size:16px!important;font-weight:700!important/);
 assert.match(contract,/\.av2-report \.av2-report__form \.av2-time-picker__part \.av2-csel__trigger/);
});

test('save/cancel action buttons are compact and consistent in all three report tabs',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const last=css.slice(css.indexOf('/* Compact consistent save/cancel actions'));
 assert.match(last,/\.av2-report \.av2-report__form>\.av2-report__actions>\.av2-btn/);
 assert.match(last,/\.av2-report \.av2-expenses-tab__actions>\.av2-btn/);
 assert.match(last,/\.av2-report \.av2-daily-travel__report-card>\.av2-report__actions>\.av2-btn/);
 assert.match(last,/width:80px!important/);
 assert.match(last,/height:32px!important/);
 assert.match(last,/font-size:12px!important/);
 assert.match(last,/min-height:40px!important/);
});

test('hidden panels override forced desktop grid and flex in all three tabs',async()=>{
 const css=await file('attendance/src/styles/report-tabs-responsive-typography.css');
 const ui=await file('attendance/src/screens/new-report-screen.js');
 const last=css.slice(css.lastIndexOf('/* Highest-priority tab visibility contract.'));
 assert.match(last,/\.av2-report__form\[hidden\]/);
 assert.match(last,/\.av2-report__history\[hidden\]/);
 assert.match(last,/\.av2-daily-travel\[hidden\]/);
 assert.match(last,/\.av2-expenses-tab\[hidden\]/);
 assert.match(last,/display:none!important/);
 assert.match(ui,/form\.hidden = !isAttendance/);
 assert.match(ui,/dailyTravel\.panel\.hidden = !isTravel/);
 assert.match(ui,/expensesPanel\.panel\.hidden = !isExpenses/);
});

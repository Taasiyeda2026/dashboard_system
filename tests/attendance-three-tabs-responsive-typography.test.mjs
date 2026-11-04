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
  assert.equal(links.at(-1),'./src/styles/report-tabs-responsive-typography.css?v=135');
  assert.match(sw,/const CACHE_VERSION = 135/);
  assert.ok(links.every(s=>s.endsWith('?v=135')));
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

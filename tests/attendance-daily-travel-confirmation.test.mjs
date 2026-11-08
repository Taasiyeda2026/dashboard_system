import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dailyTravelCancellationMinutes, summarizeDailyTravel} from '../attendance/src/services/daily-travel.js';

test('public transportation does not require actual travel duration or kilometres',()=>{
  const transit=[
    {kind:'outbound',mode:'public_transport',minutes:0,kilometers:0,transportCost:7},
    {kind:'return',mode:'public_transport',minutes:0,kilometers:0,transportCost:7}
  ];
  assert.deepEqual(summarizeDailyTravel(transit),{complete:true,kilometers:0,cancellationMinutes:0});
  const mixed=[
    {kind:'outbound',mode:'car',minutes:80,kilometers:50},
    {kind:'return',mode:'public_transport',minutes:0,kilometers:0,transportCost:7}
  ];
  assert.equal(dailyTravelCancellationMinutes(mixed),35);
});

test('instructor sees saved confirmation and independent manager review state',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const service=await readFile(new URL('../attendance/src/services/daily-travel.service.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  assert.match(ui,/savedCard\.className='av2-daily-travel__saved'/);
  assert.match(ui,/showSavedReport\(stored\)/);
  assert.match(ui,/showSavedReport\(\{\.\.\.saved,reported_at:/);
  assert.match(ui,/דיווח נסיעות נשמר בהצלחה|הדיווח נשמר בהצלחה/);
  assert.match(ui,/edit\.textContent='עריכת דיווח'/);
  assert.match(ui,/locked=!monthEditable;/);
  assert.doesNotMatch(ui,/\?'ממתין לאישור'/);
  assert.match(service,/לא התקבל אישור שמירה מהשרת/);
  assert.match(css,/av2-daily-travel__saved-details/);
});

test('travel time is selected as hours and minutes, with public transit hiding both',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  assert.match(ui,/\['hours',24\],\['minutes',59\]/);
  assert.match(ui,/select\.dataset\['duration'/);
  assert.match(ui,/const hour=legsArea\.querySelector/);
  assert.match(ui,/const minute=legsArea\.querySelector/);
  assert.match(ui,/if\(durationWrap\)durationWrap\.hidden=transit/);
  assert.match(ui,/if\(kmWrap\)kmWrap\.hidden=transit/);
  assert.match(ui,/leg\.minutes=leg\.kind==='between'\?leg\.gapMinutes:0/);
  assert.match(ui,/carDraft=\{minutes:leg\.minutes,kilometers:leg\.kilometers\}/);
});

test('server preserves payroll review separation and records timestamp',async()=>{
  const sql=await readFile(new URL('../supabase/migrations/20261108223000_instructor_travel_saved_state_and_transit.sql',import.meta.url),'utf8');
  assert.match(sql,/instructor_updated_report/);
  assert.match(sql,/generation_kind='daily_travel_cancellation'/);
  assert.match(sql,/review_status='pending_review'/);
  assert.match(sql,/'reported_at',v_row.reported_at/);
  assert.match(sql,/'reported_at',d.reported_at/);
  assert.match(sql,/v_kind in \('outbound','return'\) and v_minutes<>0/);
  assert.match(sql,/av2_can_write_month/);
});

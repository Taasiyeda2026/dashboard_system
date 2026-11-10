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
  assert.match(ui,/heading\.textContent=needsCorrection\?'נדרש תיקון':'✓'/);
  assert.match(ui,/heading\.setAttribute\('aria-label',heading\.title\)/);
  assert.match(ui,/savedCard\.append\(header,details,dayChoice\)/);
  assert.doesNotMatch(ui,/דיווח ליום /);
  assert.doesNotMatch(ui,/נשמר ב־/);
  assert.match(ui,/edit\.textContent='✎'/);
  assert.match(ui,/edit\.setAttribute\('aria-label','עריכת דיווח'\)/);
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
  assert.match(ui,/if\(durationWrap\)durationWrap\.hidden=!selected\|\|transit/);
  assert.match(ui,/if\(kmWrap\)kmWrap\.hidden=!selected\|\|transit/);
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

test('transport choice precedes and reveals only relevant fields',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  assert.match(ui,/fields\.prepend\(modeWrap\)/);
  assert.match(ui,/chooseMode\.value=''/);
  assert.match(ui,/mode\.value=\(leg\.kind==='return' && sharedReturnMode \? legs\[0\]\.mode : leg\.mode\)\|\|''/);
  assert.match(ui,/mode:same\?\(old\.mode\|\|'car'\):\(leg\.kind==='between'/);
  assert.match(ui,/const selected=nextMode==='car'\|\|transit/);
  assert.match(ui,/if\(durationWrap\)durationWrap\.hidden=!selected\|\|transit/);
  assert.match(ui,/if\(kmWrap\)kmWrap\.hidden=!selected\|\|transit/);
  assert.match(ui,/status\.textContent='יש לבחור אמצעי נסיעה בכל מקטע לפני מילוי ושמירה'/);
  assert.match(css,/av2-daily-travel__leg-fields>\.av2-daily-travel__mode/);
  assert.match(css,/av2-daily-travel__saved-header/);
  assert.match(css,/av2-daily-travel__saved-edit/);
});

test('saved travel report is compact without surplus form gaps or timestamp text',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  const form=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
  assert.match(ui,/reportCard\.classList\.add\('av2-daily-travel__report-card--saved'\)/);
  assert.match(ui,/reportCard\.classList\.remove\('av2-daily-travel__report-card--saved'\)/);
  assert.match(ui,/dayLabel\.textContent='יום פעילות'/);
  assert.match(css,/report-card--saved>\.av2-report__actions\{\s*display:none!important/);
  assert.match(css,/report-card--saved \.av2-daily-travel__saved-metric\{\s*display:inline-flex/);
  assert.match(css,/report-card--saved>\.av2-daily-travel__month-wrap\{/);
  assert.match(css,/\.av2-report__success\{\s*width:min\(100%,700px\)/);
  assert.match(form,/successBanner\.textContent = 'דיווח הנוכחות נשמר בהצלחה'/);
  assert.doesNotMatch(ui,/דיווח ליום /);
});

test('saved report uses one compact row with accessible edit and day switching',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  assert.match(ui,/dayChoice\.className='av2-daily-travel__saved-day'/);
  assert.match(ui,/dayChoice\.setAttribute\('aria-label','בחירת יום פעילות'\)/);
  assert.match(ui,/dayChoice\.addEventListener\('change',\(\)=>\{/);
  assert.match(ui,/setDate\(dayChoice\.value\)/);
  assert.match(ui,/dayChoice\.disabled=dayOptions\.length<2/);
  assert.match(css,/report-card--saved>\.av2-daily-travel__day-wrap\{\s*display:none!important/);
  assert.match(css,/report-card--saved>\.av2-daily-travel__saved\{[\s\S]*?flex-wrap:nowrap!important/);
  assert.match(css,/report-card--saved \.av2-daily-travel__saved-details\{[\s\S]*?border:0!important/);
  assert.match(css,/report-card--saved \.av2-daily-travel__saved-day\{/);
  assert.match(css,/@media\(max-width:420px\)/);
});

test('travel hours, minutes and kilometres align on one row, with transport choice above',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../attendance/src/styles/new-report-final-alignment.css',import.meta.url),'utf8');
  assert.match(ui,/fields\.prepend\(modeWrap\)/);
  assert.match(ui,/selects\.setAttribute\('aria-label','זמן נסיעה בפועל'\)/);
  assert.match(ui,/caption\.textContent=unit==='hours'\?'שעות נסיעה':'דקות נסיעה'/);
  assert.match(ui,/durationWrap\.append\(durationLabel,selects\)/);
  assert.match(ui,/km\.wrap\.classList\.add\('av2-daily-travel__km'\)/);
  assert.match(ui,/fare\.wrap\.classList\.add\('av2-daily-travel__fare'\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) minmax\(0,1\.2fr\)!important/);
  assert.match(css,/\.av2-daily-travel__duration:not\(\[hidden\]\)/);
  assert.match(css,/\.av2-daily-travel__duration\[hidden\]\{\s*display:none!important/);
  assert.match(css,/\.av2-daily-travel__duration-selects>label,/);
  assert.match(css,/grid-template-rows:18px 44px/);
  assert.match(css,/@media\(max-width:370px\)/);
});

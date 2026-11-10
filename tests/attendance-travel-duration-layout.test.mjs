import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');

test('both outbound and return display one HH:MM duration beside kilometers',async()=>{
  const ui=await read('attendance/src/screens/daily-travel-tab.js');
  const css=await read('attendance/src/styles/new-report-final-alignment.css');
  assert.match(ui,/durationLabel\.textContent='משך הנסיעה'/);
  assert.match(ui,/durationWrap\.append\(durationLabel,selects\)/);
  assert.match(ui,/\['hours',24\],\['minutes',59\]/);
  assert.match(ui,/separator\.textContent=':'/);
  assert.match(ui,/placeholder\.textContent=unit==='hours'\?'שעות':'דקות'/);
  assert.match(ui,/km\.wrap\.classList\.add\('av2-daily-travel__km'\)/);
  assert.match(css,/grid-template-columns:minmax\(0,1\.4fr\) minmax\(0,1fr\)!important/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) 10px minmax\(0,1fr\)/);
  assert.match(css,/\.av2-daily-travel__duration:not\(\[hidden\]\)/);
  assert.match(css,/\.av2-daily-travel__duration\[hidden\]\{display:none!important\}/);
});

test('single-activity outbound mode is reused on return without losing mixed-mode travel',async()=>{
  const ui=await read('attendance/src/screens/daily-travel-tab.js');
  assert.match(ui,/const sharedReturnMode=legs\.length===2/);
  assert.match(ui,/\(!legs\[1\]\?\.mode \|\| legs\[1\]\.mode===legs\[0\]\?\.mode\)/);
  assert.match(ui,/mode\.value=\(leg\.kind==='return' && sharedReturnMode \? legs\[0\]\.mode : leg\.mode\)/);
  assert.match(ui,/if\(leg\.kind==='outbound' && sharedReturnMode && syncReturnMode\)/);
  assert.match(ui,/syncReturnMode\(nextMode\)/);
  assert.match(ui,/if\(leg\.kind==='return' && sharedReturnMode\)/);
  assert.match(ui,/returnInheritsMode|sharedReturnMode/);
  assert.match(ui,/modeWrap\.hidden=true/);
});

test('travel calculation and saving still use total minutes and kilometers for every leg',async()=>{
  const ui=await read('attendance/src/screens/daily-travel-tab.js');
  const service=await read('attendance/src/services/daily-travel.service.js');
  assert.match(ui,/leg\.minutes=hour\.value!=='' && minute\.value!=='' \? Number\(hour\.value\)\*60\+Number\(minute\.value\) : null/);
  assert.match(ui,/summarizeDailyTravel\(legs\)/);
  assert.match(ui,/saveDailyTravel\(saveDate,saveLegs,saveNoTravel,\{signal\}\)/);
  assert.match(service,/supabase\.rpc\('av2_save_daily_travel'/);
});

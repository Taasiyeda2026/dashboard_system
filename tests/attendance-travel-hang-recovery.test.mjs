import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  TravelRequestTimeoutError, withTravelDeadline, savedTravelMatchesDraft
} from '../attendance/src/services/travel-request-guard.js';

const legs=[
  {kind:'outbound',from:'בית',to:'בית ספר',mode:'car',minutes:70,kilometers:20,transportCost:0},
  {kind:'return',from:'בית ספר',to:'בית',mode:'car',minutes:70,kilometers:20,transportCost:0}
];

test('stalled travel requests abort and release control instead of hanging forever',async()=>{
  let wasAborted=false;
  await assert.rejects(
    withTravelDeadline(signal=>new Promise(()=> {
      signal.addEventListener('abort',()=>{wasAborted=true;},{once:true});
    }),{timeoutMs:15,action:'טעינת הנסיעות'}),
    error=>error instanceof TravelRequestTimeoutError && error.message.includes('טעינת הנסיעות')
  );
  assert.equal(wasAborted,true);
  assert.equal(await withTravelDeadline(async()=>42,{timeoutMs:20}),42);
});

test('travel-save confirmation requires exact draft, not any historical saved row',()=>{
  const saved={travel_date:'2026-11-04',no_travel:false,legs:structuredClone(legs)};
  assert.equal(savedTravelMatchesDraft(saved,legs),true);
  assert.equal(savedTravelMatchesDraft({...saved,legs:[{...legs[0],minutes:65},legs[1]]},legs),false);
  assert.equal(savedTravelMatchesDraft({...saved,legs:[{...legs[0],kilometers:21},legs[1]]},legs),false);
  assert.equal(savedTravelMatchesDraft({...saved,legs:[{...legs[0],mode:'public_transport'},legs[1]]},legs),false);
  assert.equal(savedTravelMatchesDraft({...saved,legs:[legs[0]]},legs),false);
  assert.equal(savedTravelMatchesDraft(null,legs),false);
  assert.equal(savedTravelMatchesDraft({no_travel:true,legs:[]},[],true),true);
  assert.equal(savedTravelMatchesDraft({no_travel:false,legs:[]},[],true),false);
});

test('travel screen guards all live load stages and never blindly repeats a timed-out write',async()=>{
  const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
  const service=await readFile(new URL('../attendance/src/services/daily-travel.service.js',import.meta.url),'utf8');
  assert.match(ui,/reportCard\.append\(monthWrap,daysWrap,dateField\.wrap,status,reload,/);
  assert.match(ui,/reload\.hidden=false/);
  assert.match(ui,/withTravelDeadline\(\(\)=>refreshMonths\(token\)/);
  assert.match(ui,/withTravelDeadline\(signal=>refreshDays\(token,signal\)/);
  assert.match(ui,/getDailyTravelActivityLegs\(empId,date,\{signal\}\)/);
  assert.match(ui,/getDailyTravelReport\(empId,date,\{signal\}\)/);
  assert.match(ui,/withTravelDeadline\(\s*\(\)=>getMonthApproval/);
  assert.match(ui,/\+\+requestSequence;/);
  assert.match(ui,/await checkUncertainSave\(\)/);
  assert.match(ui,/savedTravelMatchesDraft\(stored,attempt\.legs,attempt\.noTravel\)/);
  assert.match(ui,/uncertainSave=\{date:saveDate,legs:saveLegs,noTravel:saveNoTravel\}/);
  assert.match(ui,/if\(loading \|\| saving \|\| locked \|\| uncertainSave\?\.date===loadedDate/);
  assert.match(service,/request\.abortSignal\(signal\)/);
  assert.match(service,/export async function saveDailyTravel\(date, legs, noTravel = false, \{signal=null\}=\{\}\)/);
});

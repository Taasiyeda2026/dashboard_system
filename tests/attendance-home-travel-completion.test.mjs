import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {JSDOM} from 'jsdom';
import {getMonthKey, formatMonthLabel, resolveMonthDisplayStatus}
  from '../attendance/src/services/month-gate.service.js';
import {isZoomLocationReport} from '../attendance/src/services/attendance-location-policy.js';

const source=await readFile(new URL('../attendance/src/screens/home-screen.js',import.meta.url),'utf8');
// Exercise the real action-strip click handler and submission guard together,
// with an isolated DOM and no browser auth client or production requests.
const actions=source.slice(source.indexOf('function buildActionStrip('),
  source.indexOf('// ── Builders'));

function setup({records,reports=[],readError=false}){
  const dom=new JSDOM('<!doctype html><body></body>');
  const errors=[],navigation=[],confirmations=[],submissions=[];
  dom.window.addEventListener('error',event=>{
    errors.push(event.error);
    event.preventDefault();
  });
  const context={
    document:dom.window.document,
    STATUS_MAP:{open:{label:'פתוח לדיווח',tone:'neutral'}},
    createIcon:()=>dom.window.document.createElement('span'),
    getMonthKey,formatMonthLabel,resolveMonthDisplayStatus,isZoomLocationReport,
    getDailyTravelReports:async()=>{
      if(readError)throw new Error('read failed');
      return reports;
    },
    openSubmitConfirmationDialog:async options=>{confirmations.push(options);},
    submitMonth:async(...args)=>{submissions.push(args);}
  };
  runInNewContext(actions+'\nthis.buildActionStrip=buildActionStrip;',context);
  const strip=context.buildActionStrip({
    year:2026,month:11,instructor:{empId:1502,name:'Test'},
    records,sourceRecords:records,expenseReports:[],editable:true,
    onNewReport:(...args)=>navigation.push(args)
  });
  dom.window.document.body.append(strip);
  return {dom,strip,errors,navigation,confirmations,submissions};
}

const physical=(date,extra={})=>({report_date:date,activity_type:'קורס',...extra});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('home completion click opens the earliest missing physical day in the travel tab',async()=>{
  const records=[physical('2026-11-09'),physical('2026-11-04'),
    physical('2026-11-02'),physical('2026-11-02'),
    physical('2026-11-01',{activity_type:'הכשרה',training_mode:'online'}),
    physical('2026-11-01',{activity_type:'ביטול זמן'}),physical('2026-11-06')];
  const reports=[{travel_date:'2026-11-04'},{travel_date:'2026-11-06',no_travel:true}];
  const before=JSON.stringify({records,reports});
  const s=setup({records,reports});
  try{
    s.strip.querySelector('.av2-home__month-submit').click();
    await settle();
    const warning=s.strip.querySelector('[data-travel-submit-warning]');
    assert.match(warning.textContent,/נותרו 2 ימים/);
    warning.querySelector('button').click();
    assert.deepEqual(s.errors,[]);
    assert.deepEqual(s.navigation,[['2026-11-02','travel']]);
    assert.equal(s.confirmations.length,0);
    assert.equal(s.submissions.length,0);
    assert.equal(JSON.stringify({records,reports}),before);
  }finally{s.dom.window.close();}
});

test('completed travel including no-travel declarations still allows month confirmation',async()=>{
  const s=setup({records:[physical('2026-11-02'),physical('2026-11-04')],
    reports:[{travel_date:'2026-11-02',no_travel:true},{travel_date:'2026-11-04'}]});
  try{
    s.strip.querySelector('.av2-home__month-submit').click();
    await settle();
    assert.equal(s.strip.querySelector('[data-travel-submit-warning]'),null);
    assert.equal(s.confirmations.length,1);
    assert.deepEqual(s.navigation,[]);
    await s.confirmations[0].onApprove();
    assert.deepEqual(s.submissions,[[1502,'2026-11','Test']]);
    assert.deepEqual(s.errors,[]);
  }finally{s.dom.window.close();}
});

test('failed travel lookup shows an error without navigating or submitting the month',async()=>{
  const s=setup({records:[physical('2026-11-02')],readError:true});
  try{
    s.strip.querySelector('.av2-home__month-submit').click();
    await settle();
    assert.match(s.strip.textContent,/לא ניתן לבדוק את דיווחי הנסיעות/);
    assert.deepEqual(s.navigation,[]);
    assert.equal(s.confirmations.length,0);
    assert.equal(s.submissions.length,0);
    assert.deepEqual(s.errors,[]);
  }finally{s.dom.window.close();}
});

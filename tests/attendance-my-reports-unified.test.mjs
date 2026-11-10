import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {buildDayDetailModel,createDayDetailRow,formatActivityHours,formatDecimalHours}
  from '../attendance/src/components/my-reports-day-detail.js';

const date='2026-11-03';
const twoActivities=[
  {id:'a',report_date:date,activity_type:'קורס',total_hours:2,roundtrip_km:0,meeting_no:3,expenses:0},
  {id:'b',report_date:date,activity_type:'קורס',total_hours:2,roundtrip_km:0,meeting_no:4,expenses:0}
];
const saved={
  travel_date:date,total_km:440,cancellation_minutes:1050,
  review_status:'pending_review',no_travel:false,public_transport_cost:0,
  legs:[
    {from:'בית',to:'בית ספר',kind:'outbound',mode:'car',kilometers:220,minutes:90},
    {from:'בית ספר',to:'בית',kind:'return',mode:'car',kilometers:220,minutes:1050}
  ]
};
const load=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('ten activity columns with meeting, without duplicate km/expenses columns',async()=>{
  const source=await load('attendance/src/screens/my-reports-screen.js');
  assert.match(source,/const colLabels = \['תאריך', 'סוג', 'התחלה', 'סיום', 'שעות', 'שם פעילות', 'מפגש', 'מיקום \/ בית ספר', 'רשות', 'פעולות'\]/);
  assert.match(source,/row\.append\(dateCell,typeCell,startCell,endCell,hoursCell,nameCell,meetingCell,schoolCell,authCell,actionsCell\)/);
  assert.match(source,/meetingCell\.textContent=record\.meeting_no/);
  assert.doesNotMatch(source,/row\.append\(dateCell, startCell, endCell, hoursCell, dayTotalCell/);
  assert.match(source,/listWrap\.append\(createDayDetailRow\(\{/);
  assert.match(source,/index===sorted\.length-1/);
  assert.match(source,/formatActivityHours\(record\.total_hours\)/);
  assert.match(source,/item\.kind==='hours' \? formatDecimalHours\(item\.numericValue\)/);
});

test('activity duration HH:MM, daily and monthly totals decimal hours',()=>{
  assert.equal(formatActivityHours(2),'02:00');
  assert.equal(formatActivityHours(1.5),'01:30');
  assert.equal(formatDecimalHours(17.5),'17.50');
  assert.equal(formatDecimalHours(1.5),'1.50');
});

test('daily trip data displays once and reflects stored report regardless of approval',()=>{
  const model=buildDayDetailModel({records:twoActivities,travelReport:saved,modern:true});
  assert.equal(model.kilometers,440);
  assert.equal(model.cancellationHours,17.5);
  assert.equal(model.expenses,0);
  const approved=buildDayDetailModel({records:twoActivities,travelReport:{...saved,review_status:'approved'},modern:true});
  assert.deepEqual(approved,model);
});

test('daily route expands to only the saved segments and expenses appear only above zero',()=>{
  const dom=new JSDOM('<!doctype html><html lang="he"><body></body></html>');
  globalThis.document=dom.window.document;
  try{
    const normal=createDayDetailRow({date,records:twoActivities,travelReport:saved,modern:true,expenseReports:[]});
    assert.equal(normal.querySelectorAll('.av2-day-detail__expense').length,0);
    assert.match(normal.textContent,/440/);
    assert.match(normal.textContent,/17.50/);
    const toggle=normal.querySelector('.av2-day-detail__route-toggle');
    assert.ok(toggle);
    assert.equal(toggle.getAttribute('aria-expanded'),'false');
    assert.equal(normal.querySelector('.av2-day-detail__route-breakdown').hidden,true);
    toggle.click();
    assert.equal(toggle.getAttribute('aria-expanded'),'true');
    assert.equal(normal.querySelector('.av2-day-detail__route-breakdown').hidden,false);
    assert.equal(normal.querySelectorAll('.av2-day-detail__route-breakdown>div').length,2);
    const withExpenses=createDayDetailRow({
      date,records:twoActivities,travelReport:saved,modern:true,
      expenseReports:[{expense_date:date,amount:24.5,review_status:'pending_review'}]
    });
    assert.equal(withExpenses.querySelectorAll('.av2-day-detail__expense').length,1);
    assert.match(withExpenses.querySelector('.av2-day-detail__expense').textContent,/24.5/);
    const noTravel=createDayDetailRow({date,records:twoActivities,modern:true});
    assert.match(noTravel.textContent,/טרם דווח/);
  }finally{delete globalThis.document;dom.window.close();}
});

test('all travel and action icons share one scoped ten-column design, including mobile',async()=>{
  const [css,runtime,mobile,index,sw]=await Promise.all([
    load('attendance/src/styles/my-reports-unified.css'),
    load('attendance/src/attendance-followup-runtime-v2.js'),
    load('attendance/src/mobile-reports-enhancer.js'),
    load('attendance/index.html'),
    load('attendance/sw.js')
  ]);
  assert.match(css,/av2-report-list--unified/);
  assert.match(css,/\.av2-rr__action-edit/);
  assert.match(css,/\.av2-rr__travel-shortcut/);
  assert.match(css,/@media\(max-width:767px\)/);
  assert.match(runtime,/if\(list\?\.classList\.contains\('av2-report-list--unified'\)\)return/);
  assert.match(mobile,/setMobileLabel\(meetingCell, 'מפגש'\)/);
  const attendanceAssetVersion=index.match(/my-reports-unified\.css\?v=(\d+)/);
  const attendanceSwVersion=sw.match(/const CACHE_VERSION = (\d+);/);
  assert.ok(attendanceAssetVersion && attendanceSwVersion);
  assert.equal(attendanceAssetVersion[1],attendanceSwVersion[1]);
});

test('compact report columns stay centered on desktop while mobile details wrap',async()=>{
  const css=await load('attendance/src/styles/my-reports-unified.css');
  assert.match(css,/width:min\(100%,1040px\)!important/);
  assert.match(css,/min-width:892px!important/);
  assert.match(css,/minmax\(110px,1\.22fr\)/);
  assert.match(css,/minmax\(136px,1\.28fr\)/);
  assert.match(css,/minmax\(88px,\.92fr\)/);
  assert.match(css,/span:nth-child\(2\)/);
  assert.match(css,/span:nth-child\(7\)/);
  assert.match(css,/\.av2-rr__type,/);
  assert.match(css,/\.av2-rr__meeting\{/);
  assert.match(css,/@media\(max-width:767px\)/);
  assert.match(css,/white-space:normal!important/);
  assert.match(css,/overflow-wrap:anywhere/);
});

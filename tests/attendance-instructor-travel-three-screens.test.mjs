import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {runInNewContext} from 'node:vm';
import {sumReportedDailyTravel,formatTravelMinutes,dailyTravelDetails,createReportedTravelTable}
  from '../attendance/src/components/reported-daily-travel.js';
import {buildMonthlySummaryItems} from '../attendance/src/components/monthly-report-summary.js';

const car={travel_date:'2026-11-03',total_km:'440.00',cancellation_minutes:90,
  public_transport_cost:0,review_status:'pending_review',no_travel:false,
  legs:[{kind:'outbound',mode:'car',minutes:90,kilometers:220},
    {kind:'return',mode:'car',minutes:90,kilometers:220}]};
const transit={travel_date:'2026-11-04',total_km:0,cancellation_minutes:0,
  public_transport_cost:14.5,review_status:'approved',no_travel:false,
  legs:[{kind:'outbound',mode:'public_transport',minutes:0,kilometers:0,transportCost:7.25},
    {kind:'return',mode:'public_transport',minutes:0,kilometers:0,transportCost:7.25}]};
const noTravel={travel_date:'2026-11-05',total_km:0,cancellation_minutes:0,
  public_transport_cost:0,review_status:'pending_review',no_travel:true,legs:[]};

test('saved daily reports are the authoritative instructor totals, each day counted once',()=>{
  const totals=sumReportedDailyTravel([car,transit,noTravel]);
  assert.deepEqual(totals,{count:3,kilometers:440,cancellationMinutes:90,publicTransportCost:14.5});
  assert.equal(formatTravelMinutes(90),'1:30');
  assert.match(dailyTravelDetails(car),/440 ק״מ/);
  assert.match(dailyTravelDetails(car),/ביטול זמן: 1:30/);
  assert.doesNotMatch(dailyTravelDetails(transit),/ק״מ|ביטול זמן/);
  assert.match(dailyTravelDetails(transit),/14.5/);
  assert.equal(dailyTravelDetails(noTravel),'נסיעות: ללא נסיעה');
});

test('home and My Reports use reported values rather than obsolete per-activity km',async()=>{
  const attendance=[
    {id:'a',report_date:'2026-11-03',activity_type:'קורס',total_hours:2,roundtrip_km:8},
    {id:'b',report_date:'2026-11-03',activity_type:'קורס',total_hours:2,roundtrip_km:8}
  ];
  // Test the real pure home-stat builder without importing its browser-only auth client.
  const homeSource=await readFile(new URL('../attendance/src/screens/home-screen.js',import.meta.url),'utf8');
  const start=homeSource.indexOf('export function buildHomeSummaryStats(');
  const end=homeSource.indexOf('\nfunction buildStat(',start);
  assert.ok(start>0 && end>start);
  const context={
    sourceAttendanceRecords:rows=>rows.filter(row=>!row.generation_kind),
    sumReportedDailyTravel,
    hoursForType:(rows,label)=>rows.filter(row=>row.activity_type===label)
      .reduce((sum,row)=>sum+Number(row.total_hours||0),0),
    cancellationHours:()=>0,
    distinctAttendanceWorkDays:rows=>new Set(rows.map(row=>row.report_date)).size,
    formatDurationHours:value=>formatTravelMinutes(Number(value||0)*60)
  };
  runInNewContext(homeSource.slice(start,end).replace('export function','function')
    +'\nthis.buildHomeSummaryStats=buildHomeSummaryStats;',context);
  const buildHomeSummaryStats=context.buildHomeSummaryStats;
  const home=buildHomeSummaryStats(attendance,[],[car,transit]);
  assert.equal(home.find(x=>x.key==='kilometers').numericValue,440);
  assert.equal(home.find(x=>x.key==='cancellation').value,'1:30');
  assert.equal(home.find(x=>x.key==='transit').numericValue,14.5);
  const monthly=buildMonthlySummaryItems(attendance,[car,transit]);
  assert.equal(monthly.find(x=>x.key==='kilometers').value,'440 ק״מ');
  assert.equal(monthly.find(x=>x.activityType==='ביטול זמן').value,'1:30');
  assert.equal(monthly.find(x=>x.key==='public-transport').numericValue,14.5);
  const legacyHome=buildHomeSummaryStats(attendance);
  assert.equal(legacyHome.find(x=>x.key==='kilometers').numericValue,16);
  const legacyMonthly=buildMonthlySummaryItems(attendance);
  assert.equal(legacyMonthly.find(x=>x.key==='kilometers').numericValue,16);
});

test('saved table shows saved reports whether or not manager has reviewed them',()=>{
  const dom=new JSDOM('<!doctype html><html lang="he"><body></body></html>');
  globalThis.document=dom.window.document;
  try{
    const table=createReportedTravelTable([car,transit,noTravel]);
    const rows=[...table.querySelectorAll('tbody tr')];
    assert.equal(rows.length,3);
    assert.equal(rows[0].querySelector('td').textContent,'05.11.2026');
    assert.match(table.textContent,/03.11.2026/);
    assert.match(table.textContent,/440 ק״מ/);
    assert.match(table.textContent,/1:30/);
    assert.match(table.textContent,/₪14.5/);
    assert.equal(rows[2].lastElementChild.textContent,'נשמר');
    assert.equal(rows[1].lastElementChild.textContent,'נשמר');
    assert.doesNotMatch(table.textContent,/ממתין לאישור/);
    const rejected={...car,review_status:'rejected'};
    const rejectedTable=createReportedTravelTable([rejected]);
    assert.match(rejectedTable.textContent,/נדרש תיקון/);
  } finally {delete globalThis.document;}
});

test('three screens are wired to the same reports and do not change payroll rules',async()=>{
  const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
  const [home,myReports,tab,css]=await Promise.all([
    read('attendance/src/screens/home-screen.js'),
    read('attendance/src/screens/my-reports-screen.js'),
    read('attendance/src/screens/daily-travel-tab.js'),
    read('attendance/src/styles/new-report-final-alignment.css')
  ]);
  assert.match(home,/getDailyTravelReports\(instructor\.empId,monthKey\)/);
  assert.match(home,/buildHomeSummaryStats\(records,expenseReports,travelReports\)/);
  assert.match(myReports,/const reportTravel=dailyTravelByDate\.get\(reportDate\)\|\|null/);
  assert.match(myReports,/if\(showDailyTravel\) shownTravelDates\.add\(reportDate\)/);
  assert.match(myReports,/dailyTravelDetails\(dailyTravelReport\)/);
  assert.match(myReports,/buildMonthlySummaryGrid\(records,monthKey>='2026-11'\?dailyTravelReports:null\)/);
  assert.match(tab,/createReportedTravelTable\(saved\)/);
  assert.match(tab,/void refreshTravelHistory\(\)/);
  assert.match(css,/\.av2-reported-travel__table/);
  assert.match(css,/\.av2-reports \.av2-report-row > \.av2-rr__saved-trip/);
});

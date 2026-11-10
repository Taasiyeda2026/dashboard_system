import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  historicalExpenses,historicalTravelDays,historicalTravelReports,groupHistoricalActivityDays,
  isHistoricTravelMonth,monthRange,monthStatusLabel
} from '../attendance/src/services/historical-display-model.js';

test('historical travel displays only stored fields and existing activity dates',()=>{
 const source=[
  {id:'a',report_date:'2026-09-14',activity_type:'הכשרה',roundtrip_km:42},
  {id:'b',report_date:'2026-10-21',activity_type:'קורס',
    cancellation_before_minutes:35,cancellation_after_minutes:50,roundtrip_km:80}
 ];
 const result=historicalTravelDays(source,[]);
 assert.deepEqual(result.map(d=>d.date),['2026-10-21','2026-09-14']);
 assert.equal(result[0].records[0].cancellation_before_minutes,35);
 assert.equal(result[0].dailyReport,null);
 assert.equal(result[1].records[0].roundtrip_km,42);
 assert.equal(result[1].records[0].cancellation_before_minutes,undefined);
 assert.equal(result[1].dailyReport,null);
 assert.equal(groupHistoricalActivityDays([...source,source[0]]).length,2);
});


test('saved historical travel totals appear once with actual distance and recorded cancellation',()=>{
 const old=[
  {id:'a',report_date:'2026-10-19',activity_type:'הכשרה',roundtrip_km:14},
  {id:'b',report_date:'2026-10-25',activity_type:'קורס',roundtrip_km:60},
  {id:'c',report_date:'2026-10-25',activity_type:'ביטול זמן',
   generation_kind:'travel_time_cancellation',source_attendance_record_id:'b',total_hours:0.5},
  {id:'d',report_date:'2026-10-29',activity_type:'הכשרה',roundtrip_km:0},
 ];
 const actual=historicalTravelReports(old,[]);
 assert.deepEqual(actual.map(row=>row.travel_date),['2026-10-25','2026-10-19']);
 assert.equal(actual[0].total_km,60);
 assert.equal(actual[0].cancellation_minutes,30);
 assert.deepEqual(actual[0].legs,[]);
 assert.equal(actual[1].total_km,14);
 assert.equal(actual[1].cancellation_minutes,null);
 const saved={travel_date:'2026-10-25',total_km:61,legs:[{kind:'outbound'}]};
 const notDuplicated=historicalTravelReports([...old,old[1]],[saved]);
 assert.equal(notDuplicated.length,2);
 assert.equal(notDuplicated[0],saved);
 assert.equal(notDuplicated[1].total_km,14);
});

test('historical expense includes original attendance amount/receipt exactly once, not duplicated by identical amounts',()=>{
 const old=[
  {id:'r1',report_date:'2026-09-10',expenses:200,expense_details:'ציוד',
    attendance_record_attachments:[{id:'att1',file_name:'receipt.pdf'}]},
  {id:'r2',report_date:'2026-09-12',expenses:200,expense_details:'ציוד נוסף'},
  {id:'r3',report_date:'2026-09-12',expenses:0},
 ];
 const independent=[{id:'exp1',expense_date:'2026-09-12',amount:200,details:'קבלה אחרת',attachments:[]}];
 const results=historicalExpenses([...old,old[0]],[...independent,independent[0]]);
 assert.equal(results.length,3);
 assert.equal(results.filter(e=>e.source==='legacy').length,2);
 assert.equal(results.filter(e=>e.source==='independent').length,1);
 assert.equal(results.find(e=>e.recordId==='r1').attachments[0].file_name,'receipt.pdf');
 assert.equal(results.find(e=>e.source==='independent').id,'exp1');
});

test('read-only September/October are distinct from existing November travel reporting',()=>{
 assert.equal(isHistoricTravelMonth('2026-09'),true);
 assert.equal(isHistoricTravelMonth('2026-10'),true);
 assert.equal(isHistoricTravelMonth('2026-11'),false);
 assert.equal(monthRange('2026-09').to,'2026-09-30');
 assert.equal(monthRange('2026-10').to,'2026-10-31');
 assert.equal(monthStatusLabel({status:'locked'}),'נעול');
 assert.equal(monthStatusLabel({status:'reopened'}),'נפתח מחדש');
});

test('history changes affect UI and read-only adapters, never saving or payroll mechanisms',async()=>{
 const travel=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 const expenses=await readFile(new URL('../attendance/src/screens/expenses-tab.js',import.meta.url),'utf8');
 const attendance=await readFile(new URL('../attendance/src/screens/new-report-screen.js',import.meta.url),'utf8');
 const helper=await readFile(new URL('../attendance/src/services/historical-display.service.js',import.meta.url),'utf8');
 assert.ok(travel.includes('if(isHistoricTravelMonth(selectedMonth)){'));
 assert.ok(travel.includes('renderHistoricalDay('));
 assert.ok(travel.includes('getAssignedTravelDays({fromDate,toDate,signal})'));
 assert.ok(travel.includes('signal=>saveDailyTravel(saveDate,saveLegs,saveNoTravel,{signal})'));
 assert.ok(expenses.includes('historicalExpenses(history.rows,independent)'));
 assert.ok(expenses.includes('form.hidden=false'));
 assert.ok(expenses.includes("if(historicalView){"));
 assert.ok(attendance.includes("historyPanel.hidden = !isAttendance || attendanceSelectedMonth===attendanceCurrentMonth"));
 assert.ok(attendance.includes("form.hidden = !isAttendance || attendanceSelectedMonth!==attendanceCurrentMonth"));
 assert.doesNotMatch(helper,/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\('av2_save/);
});

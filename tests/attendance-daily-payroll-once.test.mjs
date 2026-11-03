import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {buildCorrectedAttendanceWorkbook} from '../frontend/src/screens/attendance-control.js';

test('daily approved kilometers and cancellation enter payroll month once',()=>{
 const activities=[
  {final:{employeeId:'1503',employeeName:'מדריך',date:'2026-11-04',
    activityType:'קורס',program:'ביומימיקרי',startTime:'08:00',endTime:'09:30',workHours:2,kilometers:0}},
  {final:{employeeId:'1503',employeeName:'מדריך',date:'2026-11-04',
    activityType:'קורס',program:'ביומימיקרי',startTime:'10:00',endTime:'11:30',workHours:2,kilometers:0}},
  {final:{employeeId:'1503',employeeName:'מדריך',date:'2026-11-04',
    activityType:'ביטול זמן',program:'נסיעות וביטולים מאושרים',workHours:80/60,
    kilometers:110,publicTransport:true,publicTransportCost:20, generationKind:'daily_travel_cancellation'}}
 ];
 const book=buildCorrectedAttendanceWorkbook(activities,[{employeeId:'1503',employmentType:'תעשיידע'}]);
 const table=XLSX.utils.sheet_to_json(book.Sheets['סיכום חודשי'],{header:1});
 const headers=table[0], totals=table[1];
 assert.equal(totals[headers.indexOf('סה"כ קילומטרים')],110);
 assert.equal(totals[headers.indexOf('שעות ביטול זמן')],'1:20');
 assert.equal(totals[headers.indexOf('שעות קורס')],'4:00');
 assert.equal(totals[headers.indexOf('תחבורה ציבורית (₪)')],20);
});

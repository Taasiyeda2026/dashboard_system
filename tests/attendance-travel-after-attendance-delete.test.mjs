import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');

test('deleting source attendance deletes its saved daily travel, time cancellation and payroll',async()=>{
 const sql=await read('supabase/migrations/20261109224947_delete_linked_travel_cancellation_with_attendance.sql');
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.av2_mark_daily_travel_after_attendance_delete\(\)/i);
 assert.match(sql,/OLD\.generation_kind IS NOT NULL/i);
 assert.match(sql,/OLD\.report_date < DATE '2026-11-01'/i);
 assert.match(sql,/DELETE FROM public\.attendance_daily_travel_reports d/i);
 assert.match(sql,/d\.emp_id=OLD\.emp_id AND d\.travel_date=OLD\.report_date/i);
 assert.match(sql,/a\.generation_kind='daily_travel_cancellation'/i);
 assert.match(sql,/a\.generation_kind IS NULL AND a\.activity_type='ביטול זמן'/i);
 assert.match(sql,/attendance_deleted_travel_removed/);
 assert.doesNotMatch(sql,/SET review_status='rejected'/i);
 assert.doesNotMatch(sql,/DELETE FROM public\.attendance_records[\s\S]*a\.activity_type='קורס'/i);
});

test('deletion also removes approved travel without deleting unrelated attendance',async()=>{
 const sql=await read('supabase/migrations/20261109224947_delete_linked_travel_cancellation_with_attendance.sql');
 const source=await read('attendance/src/services/attendance.service.js');
 const review=await read('supabase/migrations/20261104061000_manager_only_daily_travel_review.sql');
 assert.match(source,/from\('attendance_records'\)[\s\S]*?\.delete\(\)/i);
 assert.match(sql,/DELETE FROM public\.attendance_records a[\s\S]*a\.generation_kind='daily_travel_cancellation'/i);
 assert.match(sql,/previous_approved_cancellation_minutes/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.av2_mark_daily_travel_after_attendance_delete/);
 assert.match(review,/av2_daily_travel_route_matches/i);
});

test('employee receives accurate warning before a linked attendance deletion',async()=>{
 const src=await read('attendance/src/screens/my-reports-screen.js');
 assert.match(src,/const physicalTravel=record\.generation_kind==null/);
 assert.match(src,/גם הנסיעות וביטול הזמן של יום זה יימחקו/);
 assert.match(src,/גם נתוני הנסיעה המשויכים לדיווח יימחקו/);
 assert.doesNotMatch(src,/אם נשמרו נסיעות ליום זה, יהיה צורך לעדכן אותן/);
});

test('remaining attendance allows a fresh daily travel report',async()=>{
 const src=await read('attendance/src/services/daily-travel.service.js');
 const screen=await read('attendance/src/screens/daily-travel-tab.js');
 assert.match(src,/getDailyTravelActivityLegs/);
 assert.match(src,/export async function saveDailyTravel/);
 assert.match(screen,/saveDailyTravel\(saveDate,saveLegs,saveNoTravel,\{signal\}\)/);
});

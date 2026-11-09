import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=relative=>readFile(new URL('../'+relative,import.meta.url),'utf8');

test('removing attendance retains the saved trip and requires a corrected route',async()=>{
  const sql=await read('supabase/migrations/20261109212044_mark_daily_travel_needs_correction_after_attendance_deletion.sql');
  assert.match(sql,/AFTER DELETE ON public\.attendance_records/i);
  assert.match(sql,/OLD\.generation_kind IS NOT NULL/i);
  assert.match(sql,/OLD\.report_date < DATE '2026-11-01'/i);
  assert.match(sql,/UPDATE public\.attendance_daily_travel_reports d/i);
  assert.match(sql,/review_status='rejected'/i);
  assert.match(sql,/NOT public\.av2_daily_travel_route_matches/i);
  assert.match(sql,/approved_km=NULL/i);
  assert.match(sql,/approved_cancellation_minutes=NULL/i);
  assert.match(sql,/approved_public_transport_cost=NULL/i);
  assert.doesNotMatch(sql,/DELETE FROM public\.attendance_daily_travel_reports/i);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.av2_mark_daily_travel_after_attendance_delete/i);
});

test('out-of-date trips remain visible and require an edit before manager review',async()=>{
  const screen=await read('attendance/src/screens/daily-travel-tab.js');
  const table=await read('attendance/src/components/reported-daily-travel.js');
  const day=await read('attendance/src/components/my-reports-day-detail.js');
  const reports=await read('attendance/src/screens/my-reports-screen.js');
  assert.match(screen,/const needsCorrection=report\?\.review_status==='rejected'/);
  assert.match(screen,/יש להתאים את הנסיעות לפעילויות היום ולשמור מחדש/);
  assert.match(screen,/for\(const saved of savedReports\)/);
  assert.match(screen,/דיווח הנסיעות נשמר, אך אין פעילות נוכחות תואמת/);
  assert.match(screen,/getDailyTravelActivityLegs\(empId,date\)/);
  assert.match(screen,/await saveDailyTravel\(saveDate,saveLegs,saveNoTravel\)/);
  assert.match(day,/needsCorrection:travelReport\?\.review_status==='rejected'/);
  assert.match(day,/נדרש תיקון/);
  assert.match(table,/report\.review_status==='rejected'\?'נדרש תיקון'/);
  assert.match(reports,/אם נשמרו נסיעות ליום זה, יהיה צורך לעדכן אותן/);
});

test('existing server-side manager guard checks the actual route',async()=>{
  const migration=await read('supabase/migrations/20261104061000_manager_only_daily_travel_review.sql');
  assert.match(migration,/av2_daily_travel_route_matches/i);
});

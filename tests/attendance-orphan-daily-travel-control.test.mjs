import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL('../'+path,import.meta.url),'utf8');

test('orphan daily travel records are loaded independently of attendance rows',async()=>{
 const view=await read('frontend/src/screens/attendance-control.js');
 assert.match(view,/api\.attendanceControlOrphanDailyTravelReports\(\{fromDate,toDate\}\)/);
 assert.match(view,/result\.orphanDailyTravelReports=filteredOrphans/);
 assert.match(view,/!attendanceRows\.length && !filteredExpenses\.length && !filteredOrphans\.length/);
 assert.match(view,/filterAttendanceControlScopeRows\(\s*orphanReports\.map/);
 assert.match(view,/data-orphan-travel-list/);
 assert.match(view,/דיווחי נסיעות ללא נוכחות/);
 assert.match(view,/data-orphan-travel-select/);
 assert.match(view,/data-orphan-travel-delete-selected/);
 assert.match(view,/data-orphan-emp/);
 assert.match(view,/data-orphan-date/);
 assert.match(view,/root\.ownerDocument\.defaultView\.confirm\(question\)/);
 assert.match(view,/api\.attendanceControlDeleteOrphanDailyTravel\(item\)/);
 assert.match(view,/loadAttendanceReview\(\{successMessage:/);
});

test('bridge provides authorized server calls rather than direct table deletion',async()=>{
 const bridge=await read('frontend/src/payroll-attendance-v2-bridge.js');
 assert.match(bridge,/api\.attendanceControlOrphanDailyTravelReports\s*=/);
 assert.match(bridge,/supabase\.rpc\('av2_list_orphan_daily_travel_for_review'/);
 assert.match(bridge,/api\.attendanceControlDeleteOrphanDailyTravel\s*=/);
 assert.match(bridge,/supabase\.rpc\('av2_delete_orphan_daily_travel'/);
 assert.match(bridge,/!\/\^20\\d\{2\}-\\d\{2\}-\\d\{2\}\$\//);
});

test('server authorizes managers, prohibits deletion of linked or closed travel, and audits deletions',async()=>{
 const sql=await read('supabase/migrations/20261109230000_select_and_delete_orphan_daily_travel_for_managers.sql');
 assert.match(sql,/av2_list_orphan_daily_travel_for_review/);
 assert.match(sql,/av2_delete_orphan_daily_travel/);
 assert.match(sql,/u\.auth_user_id=auth\.uid\(\)/);
 assert.match(sql,/attendance_travel_delete_denied/);
 assert.match(sql,/attendance_travel_has_attendance/);
 assert.match(sql,/av2_attendance_month_is_closed\(p_emp_id,p_date\)/);
 assert.match(sql,/attendance_daily_travel_audit/);
 assert.match(sql,/orphan_daily_travel_deleted/);
 assert.match(sql,/DELETE FROM public\.attendance_daily_travel_reports d/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.av2_delete_orphan_daily_travel/);
 assert.match(sql,/TO authenticated/);
 assert.doesNotMatch(sql,/TO anon;/);
});

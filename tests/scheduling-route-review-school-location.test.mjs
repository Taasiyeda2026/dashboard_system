import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const src = p => readFile(new URL(p,import.meta.url),'utf8');

test('every audited route has an explanatory action and actual calculation evidence', async () => {
 const screen=await src('../frontend/src/screens/course-scheduling.js');
 assert.match(screen,/data-review-route/);
 assert.match(screen,/בדוק מיקומים/);
 assert.match(screen,/מרחק אפס חשוד/);
 assert.match(screen,/כתובת זוהתה אחרת/);
 assert.match(screen,/outbound_query_origin/);
 assert.match(screen,/reverse_query_destination/);
 assert.match(screen,/origin_candidates/);
 assert.match(screen,/destination_candidates/);
 assert.match(screen,/כתובת מלאה ומדויקת לניווט/);
 assert.match(screen,/אני מאשר\/ת שזהו המיקום הנכון/);
});

test('school location edits require explicit confirmation and are not calculations', async () => {
 const sql=await src('../supabase/migrations/20261016235000_manual_school_route_location_review.sql');
 assert.match(sql,/create or replace function public\.scheduling_route_review_authorized/);
 assert.match(sql,/create or replace function public\.scheduling_route_review_save_school/);
 assert.match(sql,/p_confirmed is distinct from true/);
 assert.match(sql,/route_verified_address=v_address/);
 assert.match(sql,/address_must_include_school_city/);
 assert.match(sql,/on conflict\(entity_key\)/);
 assert.doesNotMatch(sql,/delete from public\.schools|delete from public\.scheduling_travel_cache|computeRoutes|routes\.googleapis|pg_cron|cron\.schedule/);
 const screen=await src('../frontend/src/screens/course-scheduling.js');
 const save=screen.split("root.querySelectorAll('[data-review-save]')")[1].split("root.querySelector('[data-review-calculate]')")[0];
 assert.match(save,/scheduling_route_review_save_school/);
 assert.doesNotMatch(save,/invokeDistanceRoute|runDistanceBuildLoop/);
});

test('manual reviewed-route calculation is separate from saving and then closes review', async () => {
 const screen=await src('../frontend/src/screens/course-scheduling.js');
 const action=screen.split("root.querySelector('[data-review-calculate]')")[1].split("root.querySelectorAll('[data-calculate-missing-route]')")[0];
 assert.match(action,/addEventListener\('click'/);
 assert.match(action,/await invokeDistanceRoute/);
 assert.match(action,/scheduling_route_review_complete/);
 const sql=await src('../supabase/migrations/20261016235000_manual_school_route_location_review.sql');
 assert.match(sql,/not c\.location_suspect and c\.distance_km>0 and c\.duration_minutes>0/);
 assert.match(sql,/status='resolved',resolved_at=now\(\)/);
});

test('location review UI remains responsive and locally scoped', async () => {
 const css=await src('../frontend/src/screens/course-scheduling.css');
 assert.match(css,/\.course-scheduling-screen \.cs-route-review-school-grid/);
 assert.match(css,/@media \(max-width: 950px\)/);
 assert.match(css,/@media \(max-width: 600px\)/);
});

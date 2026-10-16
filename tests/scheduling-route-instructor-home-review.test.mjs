import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=p=>readFile(new URL(p,import.meta.url),'utf8');
test('identify and edit instructor home without auto calculating',async()=>{
 const s=await file('../frontend/src/screens/course-scheduling.js');
 for(const part of ['origin_instructor_matches','destination_instructor_matches',
 'data-review-kind','data-review-instructor','data-review-school',
 'scheduling_route_review_save_instructor','scheduling_route_review_find_instructors'])
  assert.ok(s.includes(part),part);
 const save=s.split("root.querySelectorAll('[data-review-save]')")[1].split("root.querySelector('[data-review-calculate]')")[0];
 assert.doesNotMatch(save,/invokeDistanceRoute/);
});
test('manual instructor source edits are confirmed and audited',async()=>{
 const sql=await file('../supabase/migrations/20261016235800_route_review_instructor_endpoints.sql');
 assert.match(sql,/p_confirmed is distinct from true/);
 assert.match(sql,/update public.contacts_instructors set address=v_address/);
 assert.match(sql,/scheduling_route_location_review_log/);
 assert.doesNotMatch(sql,/googleapis|computeRoutes|cron.schedule/i);
});
test('manual calculation requires mixed endpoint review',async()=>{
 const sql=await file('../supabase/migrations/20261016235820_route_review_mixed_completion.sql');
 assert.match(sql,/origin_reviewed_at is null/);
 assert.match(sql,/destination_reviewed_at is null/);
 assert.match(sql,/q.origin_review_type='instructor'/);
 assert.match(sql,/not c.location_suspect and c.distance_km>0/);
});

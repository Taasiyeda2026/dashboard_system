import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('travel preview shows routes but does not prepopulate reported kilometres',async()=>{
 const api=await readFile(new URL('../attendance/src/services/daily-travel.service.js',import.meta.url),'utf8');
 const ui=await readFile(new URL('../attendance/src/screens/daily-travel-tab.js',import.meta.url),'utf8');
 assert.match(api,/kilometers:leg.kind==='between' && leg.sameLocation===true \? 0 : null/);
 assert.match(ui,/leg.kind==='between' && key==='minutes'/);
 assert.match(ui,/leg.kind==='between' && leg.sameLocation===true && key==='kilometers'/);
 assert.match(ui,/leg.kind==='between'\?leg.gapMinutes:/);
 assert.match(ui,/noTravelLabel.hidden=!legs.length \|\| legs.some\(leg=>leg.kind==='between'\)/);
});

test('database RPC derives middle-gap minutes from attendance and applies 45-minute outer deductible',async()=>{
 const migration=await readFile(new URL('../supabase/migrations/20261104014500_attendance_travel_45_minute_and_auto_between.sql',import.meta.url),'utf8');
 assert.match(migration,/extract\(epoch from \(next_a.start_time-prev_a.end_time\)\)/);
 assert.match(migration,/v_item:=jsonb_set\(v_item,'\{minutes\}',to_jsonb\(v_gap_minutes\)/);
 assert.match(migration,/v_minutes-45/);
 assert.match(migration,/same_location/);
 assert.match(migration,/attendance_between_activities_requires_report/);
 assert.doesNotMatch(migration,/v_minutes-40/);
});

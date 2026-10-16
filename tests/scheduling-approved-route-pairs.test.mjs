import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { findCachedRowForPair } from '../frontend/src/screens/course-scheduling-distance-build.js';

test('same locality schools use verified school IDs rather than shared address', () => {
  const pair = { origin_entity_key:'school_id:3502', destination_entity_key:'school_id:3537',
    origin_address:'מרכז שפירא', destination_address:'מרכז שפירא' };
  const rows = [
    { origin_key:'מרכז שפירא',destination_key:'מרכז שפירא',distance_km:0,duration_minutes:0,provider:'same_school' },
    { origin_entity_key:'school_id:3502',destination_entity_key:'school_id:3537',
      distance_km:2.3,duration_minutes:5,provider:'google_approved_coordinates' }
  ];
  assert.equal(findCachedRowForPair(rows,pair)?.distance_km,2.3);
});
test('routes mode writes ID-keyed values only for user-approved coordinates',async()=>{
  const maintenance=await readFile(new URL('../supabase/functions/scheduling-route-maintenance/index.ts',import.meta.url),'utf8');
  const route=await readFile(new URL('../supabase/functions/scheduling-route/index.ts',import.meta.url),'utf8');
  const segment=maintenance.split('async function repairApprovedCoordinates')[1].split('async function resolveMappedSchoolPlaces')[0];
  assert.match(segment,/scheduling_route_approved_points/);
  assert.match(segment,/approved:' \+ from.entity/);
  assert.match(segment,/google_approved_coordinates/);
  assert.match(segment,/origin_entity_key:from.entity/);
  assert.match(segment,/destination_entity_key:to.entity/);
  assert.match(segment,/travelMode:'DRIVE'/);
  assert.match(maintenance,/approvedMode/);
  assert.match(route,/if \(typed\?\.provider === 'google_approved_coordinates'\) return typed/);
});

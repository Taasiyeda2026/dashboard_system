import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('provisional distances are not written to official cache', async () => {
 const source = await readFile(new URL('../supabase/functions/scheduling-route-maintenance/index.ts',import.meta.url),'utf8');
 const text = source.split('async function estimateCoordinateSegments')[1].split('Deno.serve')[0];
 assert.ok(text.includes('not_authorized_for_payroll:true'));
 assert.ok(!text.includes('scheduling_travel_cache'));
 assert.ok(!text.includes('.upsert('));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const edge=readFileSync(new URL('../supabase/functions/scheduling-agent-worker-api/index.ts',import.meta.url),'utf8');
test('nationwide route cache loader permits 13k+ routes, deterministic, bounded',()=>{
 assert.match(edge,/scheduling_travel_cache/);
 assert.match(edge,/order\('origin_key'/);
 assert.match(edge,/order\('destination_key'/);
 assert.match(edge,/,50000\)/);
 assert.match(edge,/for\(let offset=0;offset<max;offset\+=500\)/);
 assert.match(edge,/worker_snapshot_.*_overflow/);
});

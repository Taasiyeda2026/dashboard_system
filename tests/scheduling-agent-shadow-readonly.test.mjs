import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261015181500_scheduling_agent_worker_readonly_shadow.sql',import.meta.url),'utf8');
import {runOneSchedulingAgentJob} from '../services/scheduling-agent/runner.mjs';

test('disabled machine gate makes the worker idle after a single claim',async()=>{
 const unreachable=()=>assert.fail('disabled worker must not perform any further work');
 const backend={
  claimJob:async()=>({claimed:false,disabled:true}),
  acquireLease:unreachable,loadSnapshot:unreachable,readPreflight:unreachable,heartbeatLease:unreachable,
  persistProposals:unreachable,finishJob:unreachable,releaseLease:unreachable
 };
 assert.deepEqual(await runOneSchedulingAgentJob({backend,computePlan:unreachable}),{status:'idle'});
});

test('temporary shadow migration only returns preflight and trusted lookup arrays',()=>{
 assert.match(sql,/worker_shadow_readonly/);
 assert.match(sql,/if p_action='preflight' then/);
 assert.match(sql,/if p_action='locations' then/);
 assert.match(sql,/if p_action='blockers' then/);
 assert.doesNotMatch(sql,/update public\.scheduling_planning_rows|delete from public\.scheduling_planning_rows/);
});

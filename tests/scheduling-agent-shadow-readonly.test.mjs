import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261015181500_scheduling_agent_worker_readonly_shadow.sql',import.meta.url),'utf8');
const src=readFileSync(new URL('../services/scheduling-agent/github-worker.mjs',import.meta.url),'utf8');

test('disabled machine gate is idle for every trigger and never computes a shadow',()=>{
 assert.match(src,/if\(probe\.enabled!==true \|\| probe\.atomicCompletion!==true\)/);
 const shadow=src.slice(src.indexOf('if(probe.enabled!==true'),src.indexOf('const backend=createGithubAgentBackend'));
 assert.match(shadow,/status:'idle'/);
 assert.doesNotMatch(shadow,/computeAgentSchedulingPlan\(/);
 assert.doesNotMatch(shadow,/runOneSchedulingAgentJob|persistProposals|finishJob|releaseLease/);
});

test('temporary shadow migration only returns preflight and trusted lookup arrays',()=>{
 assert.match(sql,/worker_shadow_readonly/);
 assert.match(sql,/if p_action='preflight' then/);
 assert.match(sql,/if p_action='locations' then/);
 assert.match(sql,/if p_action='blockers' then/);
 assert.doesNotMatch(sql,/update public\.scheduling_planning_rows|delete from public\.scheduling_planning_rows/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261015181500_scheduling_agent_worker_readonly_shadow.sql',import.meta.url),'utf8');
const src=readFileSync(new URL('../services/scheduling-agent/github-worker.mjs',import.meta.url),'utf8');

test('shadow requires disabled machine gate and main-branch push, never saves',()=>{
 assert.match(src,/if\(probe\.enabled!==true\)/);
 assert.match(src,/process\.env\.GITHUB_EVENT_NAME!=='push'/);
 const shadow=src.slice(src.indexOf('if(probe.enabled!==true)'),src.indexOf('const backend=createGithubAgentBackend'));
 assert.match(shadow,/computeAgentSchedulingPlan\(/);
 assert.doesNotMatch(shadow,/runOneSchedulingAgentJob|persistProposals|finishJob|releaseLease/);
});

test('temporary shadow migration only returns preflight and trusted lookup arrays',()=>{
 assert.match(sql,/worker_shadow_readonly/);
 assert.match(sql,/if p_action='preflight' then/);
 assert.match(sql,/if p_action='locations' then/);
 assert.match(sql,/if p_action='blockers' then/);
 assert.doesNotMatch(sql,/update public\.scheduling_planning_rows|delete from public\.scheduling_planning_rows/);
});

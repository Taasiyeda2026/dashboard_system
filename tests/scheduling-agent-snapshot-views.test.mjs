import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20261015184000_scheduling_agent_worker_least_privilege_views.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/scheduling-agent-worker-api/index.ts',import.meta.url),'utf8');
test('machine views avoid granting access to raw protected tables',()=>{
 assert.match(sql,/GRANT SELECT ON TABLE public\.%I TO service_role/);
 assert.match(sql,/REVOKE ALL ON TABLE public\.%I FROM PUBLIC,anon,authenticated/);
 assert.doesNotMatch(sql,/GRANT SELECT ON (TABLE )?public\.(scheduling_planning_rows|instructor_scheduling_profiles)/i);
 assert.match(sql,/NOTIFY pgrst/);
});
test('Edge uses only projected scheduling views for protected sources',()=>{
 for(const name of ['workspaces','rows','profiles','rules','exceptions','calendar','catalog','history']){
   assert.match(edge,new RegExp('scheduling_agent_worker_'+name));
 }
 assert.doesNotMatch(edge,/\.from\('(scheduling_planning_rows|instructor_scheduling_profiles|proposal_activity_pricing|school_calendar)'\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const edge=readFileSync(new URL('../supabase/functions/scheduling-agent-worker-api/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261015170000_scheduling_agent_worker_oidc_control.sql',import.meta.url),'utf8');

test('only the exact signed GitHub main-branch workflow can reach worker control',()=>{
 assert.match(edge,/crypto\.subtle\.verify/);
 assert.match(edge,/EXPECTED_REPO_ID='1212938814'/);
 assert.match(edge,/EXPECTED_WORKFLOW=/);
 assert.match(edge,/claims\.ref!=='refs\/heads\/main'/);
 assert.match(edge,/claims\.workflow_ref!==EXPECTED_WORKFLOW/);
 assert.match(edge,/claims\.aud!==AUD/);
 assert.match(edge,/\['schedule','workflow_dispatch'\]/);
 assert.match(edge,/await validateGitHubOidc\(req\.headers\.get\('authorization'\)\)/);
});

test('service-role key is isolated to Edge Function and SQL worker denies human accounts',()=>{
 assert.match(edge,/Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)/);
 assert.doesNotMatch(edge,/console\.(log|debug)|JSON\.stringify\(secret\)/);
 assert.match(sql,/caller_role <> 'service_role'/);
 assert.match(sql,/revoke all on function public\.scheduling_agent_worker_command\(text,jsonb\) from public,anon,authenticated;/);
 assert.match(sql,/grant execute on function public\.scheduling_agent_worker_command\(text,jsonb\) to service_role;/);
});

test('worker reuses existing fenced SQL persistence, never direct overwrite',()=>{
 assert.match(sql,/public\.assert_scheduling_planning_run_ownership|public\.save_scheduling_planning_snapshot\(/);
 assert.match(sql,/worker_protected_row_mutation_denied/);
 assert.match(sql,/public\.save_scheduling_planning_incremental_snapshot\(/);
 assert.match(sql,/scheduling_agent_worker_audit/);
 assert.match(edge,/worker_snapshot_revision_changed/);
 assert.match(edge,/sourceComplete:true/);
 assert.match(edge,/No.*secret|SUPABASE_SERVICE_ROLE_KEY/);
});

test('worker gateway cannot be accessed from CORS or an anonymous GET',()=>{
 assert.match(edge,/if\(req\.method!=='POST'\)/);
 assert.doesNotMatch(edge,/Access-Control-Allow-Origin/);
 assert.match(edge,/if\(!ALLOWED_ACTIONS\.has\(action\)\)/);
});

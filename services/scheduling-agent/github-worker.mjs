/**
 * Main-branch push starts a one-shot worker wake-up without relying on a browser.
 * Signed main-branch GitHub Actions worker, with safe read-only shadow on push.
 * The shadow never claims a queued job, acquires a lease, or writes proposals.
 */
import {runOneSchedulingAgentJob} from './runner.mjs';
import {computeAgentSchedulingPlan} from './compute-plan.mjs';
import {
  createGithubWorkerTransport,createGithubAgentBackend,prepareServerPlanningSnapshot
} from './github-adapter.mjs';

async function main(){
  const transport=createGithubWorkerTransport();
  const probe=await transport.call('probe');
  if(probe?.ready!==true)throw Error('worker_oidc_probe_failed');
  if(probe.enabled!==true) {
    if(process.env.GITHUB_EVENT_NAME!=='push'){
      return {status:'idle',reason:'worker_cutover_disabled'};
    }
    // ONE-TIME main-branch canary. All private inputs/results remain in runner
    // memory, never in GitHub Actions logs, cache or artifacts.
    const raw=await transport.call('snapshot');
    const trusted=prepareServerPlanningSnapshot(raw);
    const c=new AbortController();
    const watchdog=setTimeout(()=>c.abort(),8*60_000);
    try{
      const result=await computeAgentSchedulingPlan({
        ...trusted,mode:'full',signal:c.signal
      });
      return {status:'shadow_validated',engineVersion:result.engineVersion,
        rowCount:result.rows.length,sourceRevision:trusted.sourceRevision,
        workspaceRevision:trusted.workspaceRevision};
    }finally{clearTimeout(watchdog);}
  }

  const backend=createGithubAgentBackend(transport);
  return runOneSchedulingAgentJob({backend});
}

try{
  const result=await main();
  // Never print instructor/school information, OAuth claims, routes or raw
  // exceptions: failure codes are restricted to a fixed safe alphabet.
  const failureCode=String(result.failureCode||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);
  process.stdout.write(JSON.stringify({
    status:result.status,jobId:result.jobId||null,
    failureCode:failureCode||null,engineVersion:result.engineVersion||null,
    rowCount:result.rowCount??null,
    sourceRevision:result.sourceRevision??null,
    workspaceRevision:result.workspaceRevision??null
  })+'\n');
  if(result.status==='failed')process.exitCode=1;
}catch(error){
  const raw=String(error?.code||error?.message||'worker_unexpected_error');
  const code=raw.replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50)||'worker_unexpected_error';
  process.stdout.write(JSON.stringify({status:'shadow_failed',failureCode:code})+'\n');
  process.exitCode=1;
}

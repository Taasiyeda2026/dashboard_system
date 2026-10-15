/**
 * Server dispatch or scheduled polling starts one queue attempt without a browser.
 * v38 trusted database transition gate now matches the approved 30km automatic limit.
 * Disabled means idle on EVERY trigger; no implicit shadow calculation.
 */
import {runOneSchedulingAgentJob} from './runner.mjs';
import {
  createGithubWorkerTransport,createGithubAgentBackend
} from './github-adapter.mjs';

async function main(){
  const transport=createGithubWorkerTransport();
  const probe=await transport.call('probe');
  if(probe?.ready!==true)throw Error('worker_oidc_probe_failed');
  if(probe.enabled!==true || probe.atomicCompletion!==true) {
    return {status:'idle',reason:'worker_cutover_disabled'};
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
  process.stdout.write(JSON.stringify({status:'failed',failureCode:code})+'\n');
  process.exitCode=1;
}

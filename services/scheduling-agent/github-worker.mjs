/**
 * One scheduled GitHub Actions invocation. It neither logs private inputs nor
 * stores any credentials; OIDC is obtained from GitHub at runtime.
 */
import {runOneSchedulingAgentJob} from './runner.mjs';
import {createGithubWorkerTransport,createGithubAgentBackend} from './github-adapter.mjs';

const transport=createGithubWorkerTransport();
const backend=createGithubAgentBackend(transport);
const deadline=new AbortController();
const timeout=setTimeout(()=>deadline.abort(),8*60_000);
timeout.unref?.();
try {
 const result=await runOneSchedulingAgentJob({backend});
 // Never print employee/school details, candidate rows, routes or identity tokens.
 process.stdout.write(JSON.stringify({status:result.status,jobId:result.jobId||null,
   failureCode:result.failureCode||null,engineVersion:result.engineVersion||null})+'\n');
 if (result.status==='failed')process.exitCode=1;
} finally {
 clearTimeout(timeout);
}

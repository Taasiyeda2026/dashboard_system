/** OIDC-authenticated, no queue, no lease, no persistence. */
import {createGithubWorkerTransport,prepareServerPlanningSnapshot} from './github-adapter.mjs';
import {previewThreeCoursesReadOnly} from './readonly-canary.mjs';

try {
  const transport=createGithubWorkerTransport();
  const payload=await transport.call('canary_snapshot');
  const input=prepareServerPlanningSnapshot(payload);
  const output=await previewThreeCoursesReadOnly({input});
  const summaries=output.targets.map(row=>({
    courseId:row.courseId,
    kind:row.kind,
    hasSuggestion:Boolean(row.instructorEmpId || row.options?.length || row.scheduleOptions?.length || row.packingOptions?.length),
    optionCount:(row.options?.length||0)+(row.scheduleOptions?.length||0)+(row.packingOptions?.length||0)
  }));
  process.stdout.write(JSON.stringify({
    status:'readonly_canary_completed',saved:false,
    sourceRevision:output.sourceRevision,
    count:summaries.length,summaries
  })+'\n');
} catch(error) {
  const code=String(error?.code||error?.message||'canary_failed').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,75);
  const failures=Array.isArray(error?.failures) ? error.failures : [];
  const reasons=failures.slice(0,8).map(f=>({reason:String(f?.reason||f?.code||'unknown').slice(0,64),firstCourseId:String(f?.firstCourseId||'').slice(0,90),secondCourseId:String(f?.secondCourseId||'').slice(0,90)}));
  process.stdout.write(JSON.stringify({status:'readonly_canary_failed',code,failureCount:failures.length,reasons})+'\n');
  process.exitCode=1;
}

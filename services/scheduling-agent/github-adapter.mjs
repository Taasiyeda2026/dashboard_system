/**
 * GitHub-hosted scheduling worker: OIDC-authenticated HTTPS calls only.
 * No service-role key, staff login, OAuth refresh token, or private data in logs.
 */
import {
  planningDataFingerprint, serializePlanningContextFingerprint, applyPlanningLockToRow, planningWorkspaceCourses
} from '../../frontend/src/screens/course-scheduling-planning.js';
import {expandPlanningAffectedIdsBySchool} from '../../frontend/src/screens/course-scheduling-planning-store.js';
import {createRouteClient} from '../../frontend/src/screens/course-scheduling-travel.js';
import {enrichActivitiesWithSchoolAddresses} from '../../frontend/src/screens/course-scheduling-distance-build.js';
import {activeSchedulingInstructors} from '../../frontend/src/screens/shared/course-scheduling-instructors.js';
import {israelTodayIso} from '../../frontend/src/screens/course-scheduling-meetings.js';

export const WORKER_AUDIENCE='taasiyeda-scheduling-agent-worker';
const DEFAULT_BASE='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/scheduling-agent-worker-api';

export class WorkerTransportError extends Error {
  constructor(code){super(code);this.name='WorkerTransportError';this.code=code;}
}

const groupByEmp=rows=>Object.groupBy(rows||[],x=>String(x.emp_id||''));
const asArray=value=>Array.isArray(value)?value:[];
const trim=value=>String(value??'').trim();
const requiredList=(source,key)=>{
  if(!Array.isArray(source?.[key]))throw new WorkerTransportError('missing_server_snapshot_'+key);
  return source[key];
};

export function prepareServerPlanningSnapshot(payload, {now = new Date()} = {}) {
  if(!payload || typeof payload!=='object'||!payload.workspace
    || !/^\d+$/.test(String(payload.sourceRevision??''))
    || !/^\d+$/.test(String(payload.workspace.revision??''))) {
    throw new WorkerTransportError('planning_snapshot_metadata_invalid');
  }
  const activities=requiredList(payload,'activities');
  const contacts=requiredList(payload,'instructors');
  const schoolLocations=requiredList(payload,'schoolLocations');
  const externalBlockers=requiredList(payload,'externalBlockers');
  const history=requiredList(payload,'meetingInstructorHistory');
  const profiles=requiredList(payload,'profiles');
  const rules=requiredList(payload,'rules');
  const exceptions=requiredList(payload,'exceptions');
  const calendar=requiredList(payload,'schoolCalendar');
  const catalog=requiredList(payload,'catalog');
  const cachedRoutes=requiredList(payload,'routes');
  const stored=requiredList(payload,'existingRows');
  const planningIntents=requiredList(payload,'planningIntents');
  const targets=requiredList(payload,'targetCourseIds');
  if (payload.sourceComplete!==true || payload.routesComplete!==true || payload.catalogComplete!==true
      || payload.schoolCalendarComplete!==true) {
    throw new WorkerTransportError('authoritative_planning_source_incomplete');
  }
  const enriched=enrichActivitiesWithSchoolAddresses(activities,schoolLocations);
  // Raw year data also contains workshops/tours and historical non-course rows;
  // only missing addresses among actual planned courses block a plan. Each
  // retained non-course blocker is separately validated by the core engine.
  // Keep incomplete open course records visible to the authoritative planner
  // as unresolved scheduling cases. Never invent an address or route for them.
  // The compute boundary rejects any actual assignment on such a course.
  const courses=planningWorkspaceCourses(enriched.activities,'','year');
  const missingSchoolCourseIds=courses
    .filter(x=>x.school_address_missing===true).map(x=>trim(x.row_id));
  const cancelled=new Map();
  for(const row of requiredList(payload,'cancellations')){
    const id=trim(row.activity_id); if(!cancelled.has(id))cancelled.set(id,new Set());
    cancelled.get(id).add(trim(row.meeting_date));
  }
  const withCancellations=rows=>rows.map(row=>cancelled.has(trim(row.row_id))
    ? {...row,cancelled_meeting_dates:[...cancelled.get(trim(row.row_id))]}:row);
  const historyByActivity = new Map();
  for (const entry of history) {
    const entries = historyByActivity.get(entry.activity_id) || [];
    entries.push(entry);
    historyByActivity.set(entry.activity_id, entries);
  }
  const baseActivities=[...withCancellations(enriched.activities),...withCancellations(externalBlockers)]
    .map(a=>({...a,meeting_instructor_overrides:historyByActivity.get(a.row_id) || []}));
  const fingerprintInput={
    activities:baseActivities,instructors:activeSchedulingInstructors(contacts),
    profiles,rules,exceptions,schoolCalendar:calendar,catalog,periodKey:'year'
  };
  const trustedRows=stored.map(x=>{
    const row=x.lockedOption
      ? applyPlanningLockToRow(x.row,x.lockedOption,'year'):x.row;
    if(!row)return null;
    // needs_recalc lives on the workspace wrapper; stamp it onto the engine row
    // so point planning can refuse stale unprotected proposals as occupancy anchors.
    return {...row,needsRecalc:x.needsRecalc===true};
  }).filter(Boolean);
  if(stored.some(x=>!x||!x.activityId||!x.row) ||
    new Set(stored.map(x=>x.activityId)).size!==stored.length) {
    throw new WorkerTransportError('workspace_rows_invalid');
  }
  const targetCourseIds = new Set(targets.map(trim).filter(Boolean));
  if (payload.preflight) {
    // New active courses have no workspace row to carry needs_recalc.
    const savedIds = new Set(stored.map(row => trim(row.activityId)));
    for (const course of courses) {
      const id = trim(course.row_id);
      if (!savedIds.has(id)) targetCourseIds.add(id);
    }
    for (const id of expandPlanningAffectedIdsBySchool({
      affectedIds:[...targetCourseIds], shared:{rows:stored}, activities:enriched.activities,
      currentCourseIds:courses.map(course => trim(course.row_id))
    })) targetCourseIds.add(id);
  }
  // A locked row must be supplied in the canonical form, not silently dropped.
  const routeClient=createRouteClient({
    preloadedRows:cachedRoutes,
    // Never substitute invented distances/times: an authoritative source must
    // supply missing routes through the separate signed server route service.
    invoke:async ()=>({data:{calculated:false},error:{code:'travel_unverified'}})
  });
  return {
    sourceRevision:trim(payload.sourceRevision),
    workspaceRevision:trim(payload.workspace.revision),
    preflight:payload.preflight,
    snapshotMetrics:payload.snapshotMetrics,
    dataFingerprint:planningDataFingerprint(fingerprintInput),
    contextFingerprint:serializePlanningContextFingerprint(fingerprintInput),
    targetCourseIds:[...targetCourseIds],
    routeClient,
    snapshot:{
      ...fingerprintInput,planningIntents,
      // Match the dashboard's date-sensitive guards even when the runner uses UTC.
      today:israelTodayIso(payload.preflight?.serverTime ? new Date(payload.preflight.serverTime) : now),
      profiles:Object.fromEntries(profiles.map(p=>[trim(p.emp_id),p])),
      rules:groupByEmp(rules),exceptions:groupByEmp(exceptions),
      existingRows:trustedRows,committedRows:trustedRows,
      lockedOptions:Object.fromEntries(stored.filter(x=>x.lockedOption).map(x=>[x.activityId,x.lockedOption])),
      routeRows:cachedRoutes,missingSchoolCourseIds
    }
  };
}

export function createGithubWorkerTransport({
  env=process.env,fetchImpl=fetch,
  baseUrl=DEFAULT_BASE,
  now=()=>Date.now()
}={}) {
  if(!/^https:\/\//.test(baseUrl))throw new WorkerTransportError('worker_api_https_required');
  const requestUrl=trim(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  const requestToken=trim(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  if(!requestUrl || !requestToken)throw new WorkerTransportError('github_oidc_identity_unavailable');
  let cachedToken='', tokenExpiresAt=0;
  async function oidc() {
    if(cachedToken && tokenExpiresAt-now()>120_000)return cachedToken;
    const url=new URL(requestUrl);
    url.searchParams.set('audience',WORKER_AUDIENCE);
    const result=await fetchImpl(url,{headers:{Authorization:'Bearer '+requestToken},signal:AbortSignal.timeout(15000)});
    if(!result.ok)throw new WorkerTransportError('github_oidc_exchange_failed');
    const doc=await result.json();
    if(typeof doc.value!=='string'||doc.value.split('.').length!==3)throw new WorkerTransportError('github_oidc_token_invalid');
    const encoded=doc.value.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const claims=JSON.parse(Buffer.from(encoded,'base64').toString('utf8'));
    cachedToken=doc.value;
    // Edge accepts iat no older than 180s, even when exp is much later.
    tokenExpiresAt=Math.min(Number(claims.exp)*1000||0,now()+240_000);
    return cachedToken;
  }
  async function call(action,payload={}){
    const token=await oidc();
    let response;
    try {response=await fetchImpl(baseUrl,{
      method:'POST',
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({action,...payload}),signal:AbortSignal.timeout(action === 'heartbeat' ? 10_000 : 120_000)
    });}catch{throw new WorkerTransportError('worker_transport_failed');}
    if(!response.ok) {
      let code='worker_api_unavailable';
      try{const body=await response.json();if(typeof body?.code==='string')code=body.code;}catch{}
      throw new WorkerTransportError(code);
    }
    return response.json();
  }
  return {call};
}

export function createGithubAgentBackend(transport) {
  if(!transport || typeof transport.call!=='function')throw new WorkerTransportError('worker_transport_required');
  const call=(action,details={})=>transport.call(action,details);
  return {
    claimJob:({runId}={})=>call('claim',runId?{runId}:{}),
    acquireLease:({jobId,runId,ttlSeconds})=>call('lease',{jobId,runId,ttlSeconds}),
    heartbeatLease:({jobId,runId,ttlSeconds})=>call('heartbeat',{jobId,runId,ttlSeconds}),
    loadSnapshot:async({jobId,runId,mode})=>prepareServerPlanningSnapshot(await call('snapshot',{jobId,runId,mode})),
    readPreflight:({jobId,runId})=>call('preflight',{jobId,runId}),
    loadCheckpoint:details=>call('load_checkpoint',details),
    saveCheckpoint:details=>call('save_checkpoint',details),
    persistProposals:({jobId,runId,mode,validationOnly=false,sourceRevision,workspaceRevision,dataFingerprint,
      contextFingerprint,engineVersion,rows,activities})=>{
      const updatedAtById = new Map(activities.map(a => [trim(a.row_id), a.updated_at]));
      return call('persist',{
       jobId,runId,mode,validationOnly,sourceRevision,workspaceRevision,dataFingerprint,contextFingerprint,
       engineVersion, rows:rows.map(row=>({
          activityId:trim(row.courseId),row,
          activityUpdatedAt:updatedAtById.get(trim(row.courseId)) || null
       }))
      });
    },
    finishJob:({jobId,runId,success,failureCode})=>call('finish',{jobId,runId,success,failureCode}),
    releaseLease:({jobId,runId})=>call('release',{jobId,runId})
  };
}

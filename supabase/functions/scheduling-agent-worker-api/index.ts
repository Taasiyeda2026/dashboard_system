// GitHub Actions OIDC -> isolated scheduling worker API.
// Each call MUST carry a signed GitHub JWT from our main-branch workflow.
// Supabase service-role credential exists only in the protected Edge runtime.
import {createClient} from 'npm:@supabase/supabase-js@2.57.4';

const BASE='https://szinlhjuwyiyszdpsdop.supabase.co';
const AUD='taasiyeda-scheduling-agent-worker';
const ISSUER='https://token.actions.githubusercontent.com';
const JWK_URI=ISSUER+'/.well-known/jwks';
const EXPECTED_REPO='Taasiyeda2026/dashboard_system';
const EXPECTED_REPO_ID='1212938814';
const EXPECTED_WORKFLOW=EXPECTED_REPO+'/.github/workflows/scheduling-agent-worker.yml@refs/heads/main';
const ALLOWED_ACTIONS=new Set([
  'probe','claim','lease','heartbeat','preflight','snapshot','persist','finish','release'
]);

const encoder=new TextEncoder();
const b64url=(str:string)=>new Uint8Array(
  atob(str.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(str.length/4)*4,'='))
    .split('').map(x=>x.charCodeAt(0)));
function parsePart(encoded:string):Record<string,unknown>{
  const raw=new TextDecoder().decode(b64url(encoded));
  const obj=JSON.parse(raw);
  if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('oidc_invalid_claims');
  return obj;
}
let cache:{jwks:Record<string,unknown>[],expires:number}|null=null;
async function oidcKeys(){
  if(cache&&cache.expires>Date.now())return cache.jwks;
  const r=await fetch(JWK_URI,{signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw Error('oidc_public_keys_unavailable');
  const value=await r.json();
  if(!Array.isArray(value?.keys))throw Error('oidc_public_keys_invalid');
  cache={jwks:value.keys,expires:Date.now()+300_000};
  return cache.jwks;
}
async function validateGitHubOidc(authorization:string|null){
  const match=/^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization||'');
  if(!match)throw Error('missing_github_oidc');
  const parts=match[1].split('.');
  if(parts.length!==3)throw Error('invalid_github_oidc');
  const header=parsePart(parts[0]),claims=parsePart(parts[1]);
  if(header.alg!=='RS256'||typeof header.kid!=='string')throw Error('unexpected_oidc_algorithm');
  const now=Math.floor(Date.now()/1000);
  const exp=Number(claims.exp),nbf=claims.nbf==null?now:Number(claims.nbf),iat=Number(claims.iat);
  if(!Number.isFinite(exp)||!Number.isFinite(iat)||exp<now||iat>now+30||iat<now-180
      ||nbf>now+30)throw Error('github_oidc_expired');
  if(claims.iss!==ISSUER || claims.aud!==AUD
      || claims.repository!==EXPECTED_REPO || String(claims.repository_id)!==EXPECTED_REPO_ID
      || claims.ref!=='refs/heads/main' || claims.workflow_ref!==EXPECTED_WORKFLOW
      || !['schedule','workflow_dispatch','push'].includes(String(claims.event_name||''))) {
    throw Error('github_workflow_identity_denied');
  }
  const keys=await oidcKeys();
  const jwk=keys.find((key)=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256'));
  if(!jwk)throw Error('github_oidc_signing_key_unknown');
  const key=await crypto.subtle.importKey('jwk',jwk as JsonWebKey,
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const payload=encoder.encode(parts[0]+'.'+parts[1]);
  if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64url(parts[2]),payload)) {
    throw Error('github_oidc_invalid_signature');
  }
}

function output(doc:unknown,status=200){
  return Response.json(doc,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return output({code:'post_required'},405);
  try{
    await validateGitHubOidc(req.headers.get('authorization'));
  }catch(error){
    // Never echo JWT/claims to callers or logs.
    return output({code: String((error as Error)?.message||'oidc_denied').slice(0,70)},401);
  }
  const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!secret)return output({code:'worker_server_secret_missing'},503);
  const client=createClient(BASE,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  let body:Record<string,unknown>;
  try{body=await req.json();if(!body||typeof body!=='object'||Array.isArray(body))throw Error('invalid');}
  catch{return output({code:'invalid_worker_request'},400);}
  const action=String(body.action||'');
  if(!ALLOWED_ACTIONS.has(action))return output({code:'unknown_worker_command'},400);
  const command=async(name:string,payload:Record<string,unknown>={})=>{
    const {data,error}=await client.rpc('scheduling_agent_worker_command',{p_action:name,p_payload:payload});
    if(error){
      const retryable=new Set(['planning_source_revision_conflict','planning_revision_conflict',
        'worker_snapshot_revision_changed','worker_run_lease_invalid']);
      const code=retryable.has(error.message)?error.message:
        ['40001','40P01'].includes(error.code)?'worker_database_retry':error.code||'worker_command_failed';
      throw Error(code);
    }
    return data;
  };
  // Range pagination is explicit: PostgREST's default 1,000-row limit must
  // never cause an incomplete or silently truncated nationwide snapshot.
  const paged=async(
    table:string,cols:string,filters:(q:any)=>any=(q)=>q,max=10000
  ):Promise<any[]>=>{
    const all:any[]=[];
    for(let offset=0;offset<max;offset+=500){
      const q=filters(client.from(table).select(cols).range(offset,offset+499));
      const {data,error}=await q;
      if(error)throw Error('worker_snapshot_'+table+'_failed');
      if(!Array.isArray(data))throw Error('worker_snapshot_'+table+'_invalid');
      all.push(...data);
      if(data.length<500)return all;
    }
    throw Error('worker_snapshot_'+table+'_overflow');
  };
  try{
    const args:Record<string,unknown>={};
    for(const key of ['jobId','runId','mode','ttlSeconds','success','failureCode',
      'sourceRevision','workspaceRevision','dataFingerprint','contextFingerprint',
      'engineVersion','rows']){
      if(Object.hasOwn(body,key))args[key]=body[key];
    }
    if(action!=='snapshot')return output(await command(action,args));

    // Full snapshot uses multiple DB requests but protects against mixed
    // versions by comparing authoritative preflight both BEFORE and AFTER.
    const start=await command('preflight',args);
    const {data:workspace,error:workspaceError}=await client.from('scheduling_agent_worker_workspaces')
      .select('id,revision').eq('period_key','year').eq('district','').single();
    if(workspaceError||!workspace?.id||String(workspace.revision)!==String(start?.workspace?.revision)){
      throw Error('worker_workspace_identity_conflict');
    }
    const selectAct=[
      'row_id','district','authority_id','authority','school','school_id','activity_name',
      'catalog_slug','activity_no','proposal_item_id','activity_type','item_type',
      'activity_season','grade','education_level','class_group','sessions',
      'start_time','end_time','instruction_language','required_instructor_gender',
      'scheduling_note','instructor_assignment_status','instructor_assignment_locked',
      'draft_emp_id','draft_instructor_name','draft_created_at','draft_proposed_meetings',
      'emp_id','instructor_name','emp_id_2','instructor_name_2','start_date','end_date',
      'status',...Array.from({length:35},(_,i)=>'date_'+(i+1)),'updated_at'
    ].join(',');
    const [
      activities,instructors,schoolLocations,externalBlockers,meetingInstructorHistory,
      profiles,rules,exceptions,schoolCalendar,catalog,routes,stored,cancellations
    ]=await Promise.all([
      paged('activities',selectAct,q=>q.eq('activity_season','school_2027'),10000),
      paged('contacts_instructors','emp_id,full_name,address,active,seniority_years',q=>q.order('emp_id'),5000),
      command('locations',args),
      command('blockers',args),
      paged('scheduling_agent_worker_history','activity_id,meeting_date,emp_id',
        q=>q.gte('meeting_date','2026-09-01').lte('meeting_date','2027-06-30'),10000),
      paged('scheduling_agent_worker_profiles','emp_id,default_start_time,default_end_time,friday_allowed,gender,instruction_languages,education_levels,course_restriction_mode,course_ids,blocked_authorities,blocked_schools,matching_note,weekly_target_hours,weekly_max_hours,preferred_work_days,max_fixed_courses',q=>q.order('emp_id'),5000),
      paged('scheduling_agent_worker_rules','emp_id,weekday,available,start_time,end_time,notes',q=>q.order('emp_id'),5000),
      paged('scheduling_agent_worker_exceptions','emp_id,exception_date,available,start_time,end_time,notes',q=>q.order('emp_id'),5000),
      paged('scheduling_agent_worker_calendar','external_key,title,category,calendar_sector,start_date,end_date,resume_date,day_status,school_day_end_time,blocks_scheduling,enforce_end_time,show_on_main_calendar,is_active',
        q=>q.eq('is_active',true).eq('show_on_main_calendar',true).order('start_date'),5000),
      paged('scheduling_agent_worker_catalog','activity_name,activity_no,gefen_number,pricing_key,program_name,name,title,meetings_count,hours_count,unit_duration,is_active_for_proposals',q=>q.order('activity_name'),5000),
      paged('scheduling_travel_cache','origin_key,destination_key,distance_km,duration_minutes,provider,calculated_at,expires_at,origin_address,destination_address,origin_entity_key,destination_entity_key',
        q=>q.gt('expires_at',new Date().toISOString())
            .order('origin_key',{ascending:true}).order('destination_key',{ascending:true}),50000),
      paged('scheduling_agent_worker_rows','activity_id,row_data,activity_updated_at,locked_option,needs_recalc',
        q=>q.eq('workspace_id',String(workspace.id)),10000),
      paged('course_meeting_cancellations','activity_id,meeting_date',q=>q.order('meeting_date'),10000)
    ]);
    const end=await command('preflight',args);
    if(String(start?.sourceRevision)!==String(end?.sourceRevision)
        ||String(start?.workspace?.revision)!==String(end?.workspace?.revision)) {
      throw Error('worker_snapshot_revision_changed');
    }
    if(!Array.isArray(schoolLocations)||!Array.isArray(externalBlockers)
        ||schoolCalendar.length===0||catalog.length===0||instructors.length===0) {
      throw Error('worker_snapshot_dependencies_incomplete');
    }
    const planningRows=stored.map(x=>({
      activityId:x.activity_id,row:x.row_data,
      activityUpdatedAt:x.activity_updated_at,lockedOption:x.locked_option,
      needsRecalc:x.needs_recalc
    }));
    const threshold=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
    const targets=new Set(stored.filter(x=>x.needs_recalc).map(x=>String(x.activity_id)));
    const activityById=new Map(activities.map(x=>[String(x.row_id),x]));
    for(const x of planningRows){
      const row=x.row||{};
      if(x.lockedOption||!['proposal','fixed-proposal'].includes(String(row.kind))
         ||!row.startDate||String(row.startDate)>=threshold)continue;
      const activity=activityById.get(String(x.activityId));
      if(activity && !activity.emp_id && !activity.emp_id_2 && !activity.start_date
        && !activity.instructor_assignment_locked)targets.add(String(x.activityId));
    }
    return output({
      sourceRevision:String(start.sourceRevision),
      workspace:{...start.workspace,id:workspace.id},
      activities,instructors,schoolLocations,externalBlockers,meetingInstructorHistory,
      profiles,rules,exceptions,schoolCalendar,catalog,routes,
      existingRows:planningRows,cancellations,
      targetCourseIds:[...targets],
      sourceComplete:true,routesComplete:true,
      schoolCalendarComplete:true,catalogComplete:true
    });
  }catch(error){
    // Never echo private source rows, tokens or raw database detail.
    const code=String((error as Error)?.message||'worker_backend_failed').slice(0,100);
    return output({code},code==='worker_snapshot_revision_changed'?409:500);
  }
});

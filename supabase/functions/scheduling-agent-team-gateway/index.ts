import { schedulingError, describeSchedulingSnapshot } from './diagnostics.mjs';
// Team-scoped MCP gateway. Separate from owner-only scheduling-agent-gateway.
// Every tool uses the requesting user's Supabase JWT: NEVER a service_role or shared owner token.
const PROJECT = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const BASE = PROJECT + '/functions/v1/scheduling-agent-team-gateway/mcp';
const META = BASE + '/.well-known/oauth-protected-resource';

const TOOLS = [
  {
    name: 'review_manager_approval',
    annotations: {readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false},
    description: 'Only the active designated admin can approve or reject ONE existing exception request. First use manager_approval_state, show the exact activity, instructor, dates and structured exception, and ask explicit consent. The existing database reviewer enforces authorization and request freshness. Never finalizes a course. If the outcome is unknown, read state before any retry.',
    inputSchema: {type:'object',properties:{activityId:{type:'string',minLength:1,maxLength:200},requestId:{type:'string',minLength:1,maxLength:200},decision:{type:'string',enum:['approved','rejected']}},required:['activityId','requestId','decision'],additionalProperties:false}
  },
  {
    name: 'request_optimization',
    description: 'Request a fresh operational scheduling optimization of the current-year plan. Incremental can be requested by Idan/Eden/Esraa, full rebuild by Idan only. Queued requests are processed by the private authenticated GitHub Actions scheduling agent worker; the dashboard is display-only. Execution may be delayed until a workflow runner starts. NEVER claim it has run until status says completed. No existing confirmed assignments are changed.',
    inputSchema: {type:'object',properties:{mode:{type:'string',enum:['incremental','full']}},required:['mode'],additionalProperties:false}
  },
  {
    name: 'optimization_status',
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    description: 'Read the actual state of a previously submitted optimization job: queued, running, completed or failed.',
    inputSchema: {type:'object',properties:{jobId:{type:'string',format:'uuid'}},required:['jobId'],additionalProperties:false}
  },
  {
    name: 'planning_status',
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    description: 'Read-only freshness/optimization status of the nationwide plan: current source and workspace revisions, dirty activities, whether an authorized planner run is already active. Never claims to calculate or refresh anything.',
    inputSchema: {type:'object',properties:{},additionalProperties:false}
  },
  {
    name: 'read_snapshot',
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    description: 'Read-only scheduling status and missing-date/time readiness; inspect the target activities BEFORE writing. If a schedule is missing, explain what is missing and obtain the user\'s consent to exact dates and times before using stage_schedule_batch. Excludes finance and private data.',
    inputSchema: {type:'object',properties:{},additionalProperties:false}
  },
  {
    name: 'manager_approval_state',
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    description: 'Read current structured approval_details for the draft. Operational rationale is audit documentation, NEVER an exception signal. Show exception codes and checked values before requesting manager consent. approval_required=false with request_applicable=false means any returned pending request is historical and does not block ordinary confirmation. Blocking violations remain non-overridable. Read only.',
    inputSchema: {type:'object',properties:{activityId:{type:'string'}},required:['activityId'],additionalProperties:false}
  },
  {
    name: 'stage_manual_draft',
    description: 'Create a validated manual assignment draft only when official meeting dates/hours ALREADY exist. If missing, use stage_schedule_batch after the user approves the complete schedule. Never finalize or approve exceptions.',
    inputSchema: {type:'object',properties:{activityId:{type:'string'},instructorId:{type:'integer',minimum:1},reason:{type:'string',maxLength:500}},required:['activityId','instructorId'],additionalProperties:false}
  },
  {
    name: 'stage_schedule_batch',
    description: 'STAGE 1-5 unscheduled 2027 courses as one atomic transaction with exact dates, hours and instructors. Call only AFTER a user explicitly approves the specific school, activity IDs, instructor IDs, dates and hours. First read_snapshot, compare meeting counts, identify ambiguous dates and request corrections, never auto-fix calendar years. A failure rolls back every draft. Official dates and assignments are NOT changed. Check current structured manager approval details; never infer an exception from the free-text reason. Ordinary rationale is preserved for audit. Request separate explicit finalization consent.',
    inputSchema: {type:'object',properties:{items:{type:'array',minItems:1,maxItems:5,items:{type:'object',properties:{
      activityId:{type:'string'},instructorId:{type:'integer',minimum:1},
      startTime:{type:'string'},endTime:{type:'string'},
      dates:{type:'array',minItems:1,maxItems:35,items:{type:'string'}},reason:{type:'string',maxLength:500}
    },required:['activityId','instructorId','startTime','endTime','dates'],additionalProperties:false}}},
    required:['items'],additionalProperties:false}
  },
  {
    name: 'confirm_schedule_batch',
    description: 'FINALIZE 1-5 caller-owned staged course drafts atomically, applying exact staged dates to the official calendar and confirming instructors through existing validators. Call only after the user separately and explicitly approves finalizing THESE drafts, and only if all CURRENT structured manager exceptions are already approved. A historical request marked request_applicable=false is not a current exception. Never bypass blocking violations. If any course is rejected, all changes roll back.',
    inputSchema: {type:'object',properties:{items:{type:'array',minItems:1,maxItems:5,items:{type:'object',properties:{
      activityId:{type:'string'},draftCreatedAt:{type:'string'},activityUpdatedAt:{type:'string'}
    },required:['activityId','draftCreatedAt','activityUpdatedAt'],additionalProperties:false}}},
    required:['items'],additionalProperties:false}
  },
  {
    name: 'submit_manager_approval',
    description: 'Submit the caller-owned manual scheduling draft to the existing dashboard approval queue. First read manager_approval_state and confirm approval_required=true with a concrete structured exception; NEVER submit solely because of a free-text rationale. Call ONLY after explicit user consent. Only the administrator can approve/reject in the dashboard.',
    inputSchema: {type:'object',properties:{activityId:{type:'string'}},required:['activityId'],additionalProperties:false}
  },
  {
    name: 'confirm_own_draft',
    description: 'Finalize the caller\'s already saved, validated ordinary course-assignment draft in the dashboard. Requires the employee\'s EXPLICIT confirmation of that particular assignment. Never approve an exception; pending exception requests will be rejected until the designated owner approves.',
    inputSchema: {type:'object',properties:{activityId:{type:'string'}},required:['activityId'],additionalProperties:false}
  },
  {
    name: 'confirm_planning_option',
    description: 'Confirm a fresh verified existing plan option, including proposed dates. Requires explicit confirmation. Changing agreed future dates requires separate explicit consent. Never change past sessions or approve exceptions.',
    inputSchema: {type:'object',properties:{
      activityId:{type:'string'},optionIndex:{type:'integer',minimum:0,maximum:50},
      workspaceRevision:{type:'string',pattern:'^[0-9]+$'},sourceRevision:{type:'string',pattern:'^[0-9]+$'},
      allowDateChange:{type:'boolean'}},
      required:['activityId','optionIndex','workspaceRevision','sourceRevision','allowDateChange'],additionalProperties:false}
  }
];

function respond(payload:unknown,status=200,headers:Record<string,string>={}){
  return Response.json(payload,{status,headers:{'Cache-Control':'no-store',...headers}});
}
function rejectUnauthorized(status=401){
  return respond({error:'unauthorized'},status,
    {'WWW-Authenticate':'Bearer resource_metadata="'+META+'"'});
}
function isObject(v:unknown):v is Record<string,unknown> {
  return v!==null&&typeof v==='object'&&!Array.isArray(v);
}
function activityId(v:unknown){
  return typeof v==='string'&&v.trim().length>0&&v.length<=200;
}
async function rpc(token:string,fn:string,args:Record<string,unknown>={}){
  const response=await fetch(PROJECT+'/rest/v1/rpc/'+fn,{
    method:'POST',
    headers:{'apikey':ANON_KEY,'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(args),
    signal:AbortSignal.timeout(fn==='scheduling_agent_team_confirm_schedule_batch'?55000:18000)
  });
  if(!response.ok){
    const body=await response.json().catch(()=>({}));
    return {...schedulingError(body,response.status),status:response.status};
  }
  return {data:await response.json()};
}
async function authenticate(request:Request):Promise<string|null> {
  if(!ANON_KEY)return null;
  const match=/^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization')||'');
  if(!match)return null;
  const token=match[1];
  const response=await fetch(PROJECT+'/auth/v1/user',{
    headers:{apikey:ANON_KEY,Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)return null;
  const who=await response.json();
  if(!who?.id)return null;
  const access=await rpc(token,'scheduling_agent_team_identity');
  if(!access.data?.authorized)return null;
  return token;
}
function validate(name:string,args:unknown):args is Record<string,unknown> {
  if(!isObject(args))return false;
  const allowed:Record<string,string[]>={
    review_manager_approval:['activityId','requestId','decision'],
    read_snapshot:[],
    planning_status:[],
    request_optimization:['mode'],
    optimization_status:['jobId'],
    manager_approval_state:['activityId'],
    stage_manual_draft:['activityId','instructorId','reason'],
    stage_schedule_batch:['items'],
    confirm_schedule_batch:['items'],
    submit_manager_approval:['activityId'],
    confirm_own_draft:['activityId'],
    confirm_planning_option:['activityId','optionIndex','workspaceRevision','sourceRevision','allowDateChange']
  };
  if(!allowed[name]||Object.keys(args).some(k=>!allowed[name].includes(k)))return false;
  if(name==='read_snapshot'||name==='planning_status')return Object.keys(args).length===0;
  if(name==='stage_schedule_batch'||name==='confirm_schedule_batch'){
    if(Object.keys(args).length!==1||!Array.isArray(args.items)
       ||args.items.length<1||args.items.length>5)return false;
    const ids=new Set<string>();
    for(const item of args.items){
      if(!isObject(item)||typeof item.activityId!=='string'||!activityId(item.activityId)
        ||ids.has(item.activityId))return false;
      ids.add(item.activityId);
      if(name==='confirm_schedule_batch'){
        if(Object.keys(item).some(k=>!['activityId','draftCreatedAt','activityUpdatedAt'].includes(k)))return false;
        if(typeof item.draftCreatedAt!=='string'||item.draftCreatedAt.length<10||item.draftCreatedAt.length>60
          ||typeof item.activityUpdatedAt!=='string'||item.activityUpdatedAt.length<10||item.activityUpdatedAt.length>60)return false;
      }else{
        if(Object.keys(item).some(k=>!['activityId','instructorId','startTime','endTime','dates','reason'].includes(k)))return false;
        if(typeof item.instructorId!=='number'||!Number.isSafeInteger(item.instructorId)
          ||item.instructorId<=0)return false;
        if(typeof item.startTime!=='string'||typeof item.endTime!=='string'
          ||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.startTime)
          ||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(item.endTime)
          ||item.startTime>=item.endTime)return false;
        if(!Array.isArray(item.dates)||item.dates.length<1||item.dates.length>35
           ||item.dates.some(d=>typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)))return false;
        if(item.reason!==undefined&&(typeof item.reason!=='string'||item.reason.length>500))return false;
      }
    }
    return true;
  }
  if(name==='request_optimization')return args.mode==='incremental'||args.mode==='full';
  if(name==='optimization_status')return typeof args.jobId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.jobId);
  if(!activityId(args.activityId))return false;
  if(name==='review_manager_approval')return activityId(args.requestId)&&(args.decision==='approved'||args.decision==='rejected');
  if(name==='stage_manual_draft'){
    if(typeof args.instructorId!=='number'||!Number.isSafeInteger(args.instructorId)||args.instructorId<=0)return false;
    if(args.reason!==undefined&&(typeof args.reason!=='string'||args.reason.length>500))return false;
  }
  if(name==='confirm_planning_option'){
    if(typeof args.optionIndex!=='number'||!Number.isInteger(args.optionIndex)||args.optionIndex<0||args.optionIndex>50)return false;
    if(typeof args.workspaceRevision!=='string'||!/^\d+$/.test(args.workspaceRevision))return false;
    if(typeof args.sourceRevision!=='string'||!/^\d+$/.test(args.sourceRevision))return false;
    if(typeof args.allowDateChange!=='boolean')return false;
  }
  return true;
}
Deno.serve(async request=>{
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/mcp/.well-known/oauth-protected-resource'))
    return respond({resource:BASE,authorization_servers:[PROJECT+'/auth/v1'],scopes_supported:['openid'],bearer_methods_supported:['header']});
  if(!path.endsWith('/mcp'))return respond({error:'not_found'},404);
  if(request.method!=='POST'&&request.method!=='GET')return respond({error:'method_not_allowed'},405);
  let token:string|null;
  try {token=await authenticate(request);} catch{return rejectUnauthorized();}
  if(!token)return rejectUnauthorized();
  if(request.method==='GET')return new Response(null,{status:405,headers:{Allow:'POST','Cache-Control':'no-store'}});
  let body:Record<string,unknown>;
  try{
    if(Number(request.headers.get('content-length')||0)>16384)return respond({error:'payload_too_large'},413);
    const raw=await request.text();
    if(new TextEncoder().encode(raw).length>16384)return respond({error:'payload_too_large'},413);
    const value=JSON.parse(raw);
    if(!isObject(value)||value.jsonrpc!=='2.0'||typeof value.method!=='string')throw Error();
    body=value;
  } catch {return respond({error:'invalid_jsonrpc'},400);}
  const id=body.id;
  const result=(value:unknown)=>respond({jsonrpc:'2.0',id,result:value});
  if(body.method==='notifications/initialized'&&!('id' in body))
    return new Response(null,{status:202});
  if(body.method==='initialize')
    return result({protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:true}},serverInfo:{name:'taasiyeda-team-scheduling-agent',version:'0.2.2'}});
  if(body.method==='ping')return result({});
  if(body.method==='tools/list')return result({tools:TOOLS});
  if(body.method!=='tools/call')return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  const params=body.params;
  const name=isObject(params)?params.name:null;
  const args=isObject(params)?params.arguments??{}:null;
  if(typeof name!=='string'||!validate(name,args))
    return result({isError:true,content:[{type:'text',text:'invalid_or_unauthorized_arguments'}]});
  const names:Record<string,string>={
    review_manager_approval:'review_course_assignment_manager_approval',
    read_snapshot:'scheduling_agent_team_read_snapshot',
    planning_status:'scheduling_agent_team_planning_status',
    request_optimization:'scheduling_agent_team_request_optimization',
    optimization_status:'scheduling_agent_team_optimization_status',
    manager_approval_state:'scheduling_agent_team_manager_approval_state',
    stage_manual_draft:'scheduling_agent_team_stage_manual_draft',
    stage_schedule_batch:'scheduling_agent_team_stage_schedule_batch',
    confirm_schedule_batch:'scheduling_agent_team_confirm_schedule_batch',
    submit_manager_approval:'scheduling_agent_team_submit_manager_approval',
    confirm_own_draft:'scheduling_agent_team_confirm_own_draft',
    confirm_planning_option:'scheduling_agent_team_confirm_planning_option'
  };
  const input:Record<string,unknown>=(name==='read_snapshot'||name==='planning_status')?{}:
    name==='review_manager_approval'?{p_request_id:args.requestId,p_status:args.decision}:
    name==='request_optimization'?{p_mode:args.mode}:
    name==='optimization_status'?{p_job_id:args.jobId}:
    name==='stage_manual_draft'?{p_activity_id:args.activityId,p_emp_id:args.instructorId,p_reason:args.reason??null}:
    (name==='stage_schedule_batch'||name==='confirm_schedule_batch')?{p_items:args.items}:
    name==='confirm_planning_option'?{
      p_activity_id:args.activityId,
      p_option_index:args.optionIndex,
      p_workspace_revision:args.workspaceRevision,
      p_source_revision:args.sourceRevision,
      p_allow_date_change:args.allowDateChange
    }:{p_activity_id:args.activityId};
  if(name==='review_manager_approval'){
    // Bind approval consent to the exact activity and current pending request.
    // The existing reviewer independently locks/revalidates request and draft and checks admin identity.
    const state=await rpc(token,'scheduling_agent_team_manager_approval_state',{p_activity_id:args.activityId}).catch(()=>null);
    if(!state?.data || state.data.request_id!==args.requestId || state.data.request_status!=='pending'
      || (args.decision==='approved' && state.data.approval_required!==true))
      return result({isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:'approval_state_not_current',writesCommitted:false,retrySameRequest:false,nextStep:'קרא מחדש את מצב הבקשה; לא בוצעה החלטת מנהל.'})}]});
  }
  const output=await rpc(token,names[name],input).catch(()=>({error:'upstream_unavailable',status:502,reasonCode:null,diagnosticCode:null,activityId:null,message:'הקשר עם מערכת השיבוצים נקטע; תוצאת הפעולה אינה ידועה.',nextStep:'קרא מחדש את מצב הפעילות או הבקשה לפני ניסיון נוסף. אין להסיק שהשמירה הצליחה או בוטלה.'}));
  if('error' in output)
    return result({isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:output.error,reasonCode:output.reasonCode??null,diagnosticCode:output.diagnosticCode??null,message:output.message,nextStep:output.nextStep,activityId:output.activityId??null,retrySameRequest:false,writesCommitted:output.status>=500?null:false,outcome:output.status>=500?'unknown':'rejected'})}]});
  if(name==='review_manager_approval'){
    // Never send the generic edit_requests row (which includes requested_payload) to ChatGPT.
    const row=output.data;
    return result({isError:false,content:[{type:'text',text:JSON.stringify({ok:true,result:{requestId:row.request_id,status:row.status,activityId:row.source_row_id,reviewedAt:row.reviewed_at,assignmentFinalized:false}})}]});
  }
  return result({isError:false,content:[{type:'text',text:JSON.stringify({ok:true,result:name==='read_snapshot'?describeSchedulingSnapshot(output.data):output.data})}]});
});

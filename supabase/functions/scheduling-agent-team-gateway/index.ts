import { generateWeeklyScheduleFromStartDate } from './calendar-shared.mjs';
import { schedulingError, describeSchedulingSnapshot } from './diagnostics.mjs';
// Team-scoped MCP gateway. Separate from owner-only scheduling-agent-gateway.
// Every tool uses the requesting user's Supabase JWT: NEVER a service_role or shared owner token.
const PROJECT = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
const BASE = PROJECT + '/functions/v1/scheduling-agent-team-gateway/mcp';
const META = BASE + '/.well-known/oauth-protected-resource';

const TOOLS = [
  {
    name: 'read_activity_notes',
    annotations: {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    description: 'Read the actual general notes field on one current-year course activity, its notesVersion and canAppendNotes. This is NOT the linked planning intention or baseline. Excludes private and financial notes. Read before appending and after uncertain writes.',
    inputSchema: {type:'object',properties:{activityId:{type:'string',minLength:1,maxLength:200}},required:['activityId'],additionalProperties:false}
  },
  {
    name: 'append_activity_note',
    annotations: {readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    description: 'Append the user-requested note to the ACTUAL activity general notes field, preserving all existing text. Available to team members with the existing activity direct-edit permission, not just the admin. First read_activity_notes, verify the activity and canAppendNotes, and supply its notesVersion. Use a new UUID requestId for each intentional append. After an uncertain outcome read first; retry only the exact same payload with the SAME requestId to avoid duplicates. Never substitute a planning note when activity notes were requested. No dates required. Does not change assignments, dates, locks, private/financial notes or exception approvals; free text is never authorization. Read back after saving.',
    inputSchema: {type:'object',properties:{activityId:{type:'string',minLength:1,maxLength:200},note:{type:'string',minLength:1,maxLength:2000},expectedNotesVersion:{type:'string',pattern:'^[a-f0-9]{32}$'},requestId:{type:'string',format:'uuid'}},required:['activityId','note','expectedNotesVersion','requestId'],additionalProperties:false}
  },
  {
    name: 'read_planning_intents',
    annotations: {readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    description: 'Read durable instructor planning baselines and intended course instructors, including versions and protection status. Read before writes and after uncertain outcomes. A baseline is reference text; only an active course intention holds that course out of automatic optimization. Neither reserves calendar time nor approves exceptions.',
    inputSchema: {type:'object',properties:{instructorId:{type:'integer',minimum:1}},additionalProperties:false}
  },
  {
    name: 'save_planning_baseline',
    annotations: {readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
    description: 'Save the explicitly requested instructor planning baseline, including weekdays, schools, alternatives and conditions, without requiring dates. First read_planning_intents and use its version (0 if absent). Preserves the baseline across optimization, but text alone is NOT an optimizer constraint; use save_intended_instructor for each specific course to protect. Does not change availability, previous notes, official assignments or approvals. Read back to verify.',
    inputSchema: {type:'object',properties:{instructorId:{type:'integer',minimum:1},planText:{type:'string',minLength:1,maxLength:6000},expectedVersion:{type:'string',pattern:'^[0-9]+$'}},required:['instructorId','planText','expectedVersion'],additionalProperties:false}
  },
  {
    name: 'save_intended_instructor',
    annotations: {readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false},
    description: 'Save or explicitly release a user-selected instructor for one open unassigned course, EVEN WHEN dates or hours are missing. Read read_snapshot and read_planning_intents first; use current version (0 if absent). active holds the course out of optimization pending schedule validation; released removes that hold. Never select a mere alternative as active without user consent. This is NOT a validated draft, final assignment, calendar reservation or exception approval. Existing assignments/drafts/locks cannot be overwritten. Finalization still requires exact dates, existing validators and separate explicit consent. Read back to verify.',
    inputSchema: {type:'object',properties:{activityId:{type:'string',minLength:1,maxLength:200},instructorId:{type:'integer',minimum:1},reason:{type:'string',maxLength:1000},status:{type:'string',enum:['active','released']},expectedVersion:{type:'string',pattern:'^[0-9]+$'}},required:['activityId','instructorId','reason','status','expectedVersion'],additionalProperties:false}
  },
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
    name: 'read_staged_schedule',
    annotations: {readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false},
    description: 'Read the exact persisted meeting dates, hours, draft owner-status and revision stamps for an existing 2027 course draft. Use this before deciding dates are missing or confirming an already staged schedule. This does NOT approve, edit or finalize anything; independently check approvals and request explicit finalization consent.',
    inputSchema: {type:'object',properties:{activityId:{type:'string'}},required:['activityId'],additionalProperties:false}
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
    name: 'stage_schedule',
    description: 'One scheduling entrypoint with two EXCLUSIVE modes. mode=exact_dates: the provided approved dates are authoritative and never regenerated; provide activityId,instructorId,startTime,endTime,dates. mode=from_start_date: supply approved startDate and hours; the shared school-sector calendar logic computes all meetings. Both modes delegate to existing atomic validation and draft saving; never overwrite existing dates, drafts, locks or assignments. Use read_staged_schedule for existing drafts; exception approvals and final confirmation remain separate.',
    inputSchema: {type:'object',properties:{
      mode:{type:'string',enum:['exact_dates','from_start_date']},
      activityId:{type:'string'},instructorId:{type:'integer',minimum:1},
      startTime:{type:'string'},endTime:{type:'string'},startDate:{type:'string'},
      dates:{type:'array',minItems:1,maxItems:35,items:{type:'string'}},
      reason:{type:'string',maxLength:500}
    },required:['mode','activityId','instructorId','startTime','endTime'],additionalProperties:false}
  },
  {
    name: 'stage_schedule_from_start_date',
    description: 'Calculate a weekly calendar from an approved start date and live school calendar, then stage a NEW unassigned 2027 course via the existing atomic validator. No overwriting drafts, existing hours, approved dates or assignments. Does NOT finalize or grant exceptions. Read snapshot and obtain consent for exact activity, instructor, start date and hours before use.',
    inputSchema: {type:'object',properties:{
      activityId:{type:'string'},instructorId:{type:'integer',minimum:1},
      startDate:{type:'string'},startTime:{type:'string'},endTime:{type:'string'},
      reason:{type:'string',maxLength:500}
    },required:['activityId','instructorId','startDate','startTime','endTime'],additionalProperties:false}
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
    description: 'FINALIZE 1-5 caller-owned staged course drafts atomically, checking proposed date count against course sessions before writing dates to the official calendar and confirming instructors through existing validators. Call only after the user separately and explicitly approves finalizing THESE drafts, and only if all CURRENT structured manager exceptions are already approved. A historical request marked request_applicable=false is not a current exception. Never bypass blocking violations. If any course is rejected, all changes roll back.',
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
    description: 'Finalize the caller\'s existing validated course draft, including moving proposed dates into the official calendar only on confirmation. Requires the employee\'s EXPLICIT confirmation of that particular assignment. Never approve an exception; pending exception requests will be rejected until the designated owner approves.',
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
    read_activity_notes:['activityId'],
    append_activity_note:['activityId','note','expectedNotesVersion','requestId'],
    read_planning_intents:['instructorId'],
    save_planning_baseline:['instructorId','planText','expectedVersion'],
    save_intended_instructor:['activityId','instructorId','reason','status','expectedVersion'],
    review_manager_approval:['activityId','requestId','decision'],
    read_snapshot:[],
    planning_status:[],
    request_optimization:['mode'],
    optimization_status:['jobId'],
    manager_approval_state:['activityId'],
    read_staged_schedule:['activityId'],
    stage_manual_draft:['activityId','instructorId','reason'],
    stage_schedule_batch:['items'],
    stage_schedule_from_start_date:['activityId','instructorId','startDate','startTime','endTime','reason'],
    confirm_schedule_batch:['items'],
    submit_manager_approval:['activityId'],
    confirm_own_draft:['activityId'],
    confirm_planning_option:['activityId','optionIndex','workspaceRevision','sourceRevision','allowDateChange']
  };
  if(!allowed[name]||Object.keys(args).some(k=>!allowed[name].includes(k)))return false;
  if(['read_planning_intents','save_planning_baseline','save_intended_instructor'].includes(name)){
    if(name==='read_planning_intents' && args.instructorId===undefined)return true;
    if(typeof args.instructorId!=='number'||!Number.isSafeInteger(args.instructorId)||args.instructorId<1)return false;
    if(name==='read_planning_intents')return true;
    if(typeof args.expectedVersion!=='string'||!/^\d{1,15}$/.test(args.expectedVersion))return false;
    if(name==='save_planning_baseline')return typeof args.planText==='string'&&args.planText.trim().length>0&&args.planText.length<=6000;
    return activityId(args.activityId)&&typeof args.reason==='string'&&args.reason.length<=1000&&(args.status==='active'||args.status==='released');
  }
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
  if(name==='stage_schedule_from_start_date') {
    return activityId(args.activityId)
      && Number.isSafeInteger(args.instructorId) && (args.instructorId as number)>0
      && typeof args.startDate==='string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(args.startDate)
      && typeof args.startTime==='string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(args.startTime)
      && typeof args.endTime==='string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(args.endTime)
      && args.startTime<args.endTime
      && (args.reason===undefined || (typeof args.reason==='string' && args.reason.length<=500));
  }
  if(name==='request_optimization')return args.mode==='incremental'||args.mode==='full';
  if(name==='optimization_status')return typeof args.jobId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.jobId);
  if(!activityId(args.activityId))return false;
  if(name==='append_activity_note')return typeof args.note==='string'&&args.note.trim().length>0&&args.note.length<=2000&&typeof args.expectedNotesVersion==='string'&&/^[a-f0-9]{32}$/.test(args.expectedNotesVersion)&&typeof args.requestId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(args.requestId);
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
    if(Number(request.headers.get('content-length')||0)>32768)return respond({error:'payload_too_large'},413);
    const raw=await request.text();
    if(new TextEncoder().encode(raw).length>32768)return respond({error:'payload_too_large'},413);
    const value=JSON.parse(raw);
    if(!isObject(value)||value.jsonrpc!=='2.0'||typeof value.method!=='string')throw Error();
    body=value;
  } catch {return respond({error:'invalid_jsonrpc'},400);}
  const id=body.id;
  const result=(value:unknown)=>respond({jsonrpc:'2.0',id,result:value});
  if(body.method==='notifications/initialized'&&!('id' in body))
    return new Response(null,{status:202});
  if(body.method==='initialize')
    return result({protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:true}},serverInfo:{name:'taasiyeda-team-scheduling-agent',version:'0.3.1'}});
  if(body.method==='ping')return result({});
  if(body.method==='tools/list')return result({tools:TOOLS});
  if(body.method!=='tools/call')return respond({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
  const params=body.params;
  let name=isObject(params)?params.name:null;
  let args=isObject(params)?params.arguments??{}:null;
  if(name==='stage_schedule'){
    if(!isObject(args)|| !['exact_dates','from_start_date'].includes(String(args.mode))
      ||(args.mode==='exact_dates' && (!Array.isArray(args.dates)||args.startDate!==undefined))
      ||(args.mode==='from_start_date' && (typeof args.startDate!=='string'||args.dates!==undefined))){
      return result({isError:true,content:[{type:'text',text:JSON.stringify({
        ok:false,error:'invalid_schedule_mode',message:'בחר רשימת מועדים או תאריך התחלה, לא את שניהם.',
        nextStep:'לרשימה מאושרת השתמש ב-exact_dates עם dates; לחישוב אוטומטי השתמש ב-from_start_date עם startDate.',
        writesCommitted:false
      })}]});
    }
    const {mode,...scheduleArgs}=args;
    if(mode==='exact_dates'){
      name='stage_schedule_batch';
      args={items:[scheduleArgs]};
    } else {
      name='stage_schedule_from_start_date';
      args=scheduleArgs;
    }
  }
  if(typeof name!=='string'||!TOOLS.some(tool=>tool.name===name))
    return result({isError:true,content:[{type:'text',text:JSON.stringify({
      ok:false,error:'unknown_tool',message:'כלי השיבוץ אינו מוכר.',
      nextStep:'רענן את רשימת כלי הסוכן ובדוק את שם הכלי.',writesCommitted:false
    })}]});
  if(!validate(name,args))
    return result({isError:true,content:[{type:'text',text:JSON.stringify({
      ok:false,error:'invalid_arguments',message:'פרמטרי הקריאה אינם עומדים בסכמת הכלי.',
      nextStep:'בדוק את השדות הנדרשים, הפורמטים והערכים מול tools/list; לא בוצעה פעולה.',
      writesCommitted:false
    })}]});
  if(name==='stage_schedule_from_start_date'){
    const errorReply=(code:string,nextStep:string)=>result({isError:true,content:[{type:'text',text:JSON.stringify({
      ok:false,error:code,message:code,nextStep,writesCommitted:false,outcome:'rejected'
    })}]});
    // Authenticated source reads: no service-role privileges or calendar fallbacks.
    const readRows=async(table:string,query:string)=>{
      const response=await fetch(PROJECT+'/rest/v1/'+table+'?'+query,{
        headers:{apikey:ANON_KEY,Authorization:'Bearer '+token},
        signal:AbortSignal.timeout(18000)
      });
      if(!response.ok)throw Error('source_read_unavailable');
      return await response.json();
    };
    try{
      const rows=await readRows('activities',
        'select=row_id,school_id,activity_season,activity_type,status,sessions,start_date,end_date,start_time,end_time,emp_id,draft_emp_id,instructor_assignment_locked,draft_proposed_meetings,date_1'
        +'&row_id=eq.'+encodeURIComponent(String(args.activityId)));
      if(rows.length!==1)return errorReply('activity_not_found','בדוק את מזהה הפעילות ואת הרשאות הקריאה.');
      const course=rows[0];
      if(course.activity_season!=='school_2027'||course.activity_type!=='course'||course.status!=='פתוח')
        return errorReply('activity_not_eligible','הפעילות אינה קורס פתוח בתשפ״ז.');
      if(course.emp_id||course.draft_emp_id||course.draft_proposed_meetings||course.instructor_assignment_locked
         ||course.start_date||course.end_date||course.start_time||course.end_time||course.date_1)
        return errorReply('existing_schedule_protected','יש טיוטה או לוח קיים. קרא את מצב הטיוטה; אין לדרוס אותו. נדרש מנגנון המשך טיוטה נפרד.');
      if(!Number.isInteger(Number(course.sessions))||Number(course.sessions)<1||Number(course.sessions)>35)
        return errorReply('invalid_session_count','תקן את מספר המפגשים ברשומת הפעילות.');
      const schools=await readRows('schools','select=id,sector&id=eq.'+encodeURIComponent(String(course.school_id)));
      if(schools.length!==1||!schools[0].sector)
        return errorReply('school_sector_missing','הגדר מגזר לוח שנה לבית הספר.');
      const calendarRows=await readRows('school_calendar',
        'select=calendar_sector,start_date,end_date,day_status,blocks_scheduling,enforce_end_time,school_day_end_time,is_active,show_on_main_calendar'
        +'&is_active=eq.true&show_on_main_calendar=eq.true&order=start_date.asc&limit=5000');
      // Never authorize generation based on a truncated calendar snapshot.
      if(calendarRows.length===5000)return errorReply('calendar_unavailable','לוח השנה גדול ממגבלת הקריאה; נדרש דפדוף לפני חישוב.');
      const schedule=generateWeeklyScheduleFromStartDate({
        calendarRows,sector:schools[0].sector,startDate:args.startDate,
        startTime:args.startTime,endTime:args.endTime,sessions:Number(course.sessions)
      });
      const stagedItems=[{
        activityId:args.activityId,instructorId:args.instructorId,startTime:args.startTime,
        endTime:args.endTime,dates:schedule.dates,reason:args.reason??''
      }];
      const staged=await rpc(token,'scheduling_agent_team_stage_schedule_batch',{p_items:stagedItems});
      if('error' in staged){
        const routeMissing=['scheduling_transition_unverified','scheduling_home_route_unverified']
          .includes(String(staged.reasonCode));
        let maintenanceQueued: boolean|null=null;
        let maintenanceNewCount: number|null=null;
        if(routeMissing && staged.status < 500){
          // Registration only, in a separate transaction. Never compute routes or retry a write.
          const registration=await rpc(token,'scheduling_agent_team_queue_missing_stage_routes',
            {p_items:stagedItems}).catch(()=>null);
          if(registration && !('error' in registration)
             && Number.isInteger(registration.data) && registration.data>=0){
            maintenanceNewCount=registration.data;
            maintenanceQueued=registration.data>0;
          } else maintenanceQueued=false;
        }
        return result({isError:true,content:[{type:'text',text:JSON.stringify({
          ok:false,error:staged.error,reasonCode:staged.reasonCode??null,
          message:staged.message,activityId:staged.activityId??args.activityId,
          maintenanceQueued,maintenanceNewCount,
          nextStep:'עצור. בדוק את מסך תחזוקת המסלולים, חשב מסלול חסר ידנית, אמת מרחק וזמן מעבר ורק לאחר מכן קבל אישור לניסיון שמירה חדש.',
          writesCommitted:staged.status>=500?null:false,
          outcome:staged.status>=500?'unknown':'rejected',retrySameRequest:false
        })}]});
      }
      return result({isError:false,content:[{type:'text',text:JSON.stringify({
        ok:true,result:staged.data,calculation:{endDate:schedule.endDate,
          deferred:schedule.deferred,source:'school_calendar',meetingCount:schedule.dates.length},
        finalized:false
      })}]});
    }catch(e){
      const code=e instanceof Error&&['invalid_start_date','invalid_times','invalid_session_count',
        'calendar_generation_exhausted','school_sector_missing','calendar_unavailable'].includes(e.message)
        ?e.message:'source_read_unavailable';
      return errorReply(code,'בדוק את תאריך ההתחלה, שעות הפעילות וזמינות לוח השנה; לא נשמרה טיוטה.');
    }
  }
  const names:Record<string,string>={
    read_activity_notes:'scheduling_agent_team_read_activity_notes',
    append_activity_note:'scheduling_agent_team_append_activity_note',
    read_planning_intents:'scheduling_agent_team_read_planning_intents',
    save_planning_baseline:'scheduling_agent_team_save_planning_baseline',
    save_intended_instructor:'scheduling_agent_team_save_intended_instructor',
    review_manager_approval:'review_course_assignment_manager_approval',
    read_snapshot:'scheduling_agent_team_read_snapshot',
    planning_status:'scheduling_agent_team_planning_status',
    request_optimization:'scheduling_agent_team_request_optimization',
    optimization_status:'scheduling_agent_team_optimization_status',
    read_staged_schedule:'scheduling_agent_team_read_staged_schedule',
    manager_approval_state:'scheduling_agent_team_manager_approval_state',
    stage_manual_draft:'scheduling_agent_team_stage_manual_draft',
    stage_schedule_batch:'scheduling_agent_team_stage_schedule_batch',
    confirm_schedule_batch:'scheduling_agent_team_confirm_schedule_batch',
    submit_manager_approval:'scheduling_agent_team_submit_manager_approval',
    confirm_own_draft:'scheduling_agent_team_confirm_own_draft',
    confirm_planning_option:'scheduling_agent_team_confirm_planning_option'
  };
  const input:Record<string,unknown>=(name==='read_snapshot'||name==='planning_status')?{}:
    name==='append_activity_note'?{p_activity_id:args.activityId,p_note:args.note,p_expected_notes_version:args.expectedNotesVersion,p_request_id:args.requestId}:
    name==='read_planning_intents'?{p_emp_id:args.instructorId??null}:
    name==='save_planning_baseline'?{p_emp_id:args.instructorId,p_plan_text:args.planText,p_expected_version:args.expectedVersion}:
    name==='save_intended_instructor'?{p_activity_id:args.activityId,p_emp_id:args.instructorId,p_reason:args.reason,p_status:args.status,p_expected_version:args.expectedVersion}:
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
  if('error' in output){
    // Query only the caller-visible staged schedule after a rejected write.
    // No retries, date generation, new drafts, or raw SQL details are sent back.
    let meetingCountDetails: Record<string, number|null>|null=null;
    const countFailureCodes=new Set([
      'scheduling_proposed_meeting_count_mismatch',
      'scheduling_agent_schedule_count_mismatch',
      'scheduling_activity_sessions_invalid',
      'scheduling_existing_official_meeting_count_conflict'
    ]);
    const affectedId=typeof args.activityId==='string' ? args.activityId
      : typeof output.activityId==='string' ? output.activityId
      : Array.isArray(args.items)&&args.items.length===1&&isObject(args.items[0])
        ? args.items[0].activityId : null;
    if(output.status<500 && countFailureCodes.has(String(output.reasonCode)) && activityId(affectedId)){
      const current=await rpc(token,'scheduling_agent_team_read_staged_schedule',
        {p_activity_id:affectedId as string}).catch(()=>null);
      if(current && 'data' in current && current.data){
        const row=current.data as Record<string,unknown>;
        const raw=String(row.requiredMeetingCount??'');
        const req=/^[0-9]{1,2}$/.test(raw)?Number(raw):null;
        const draft=Number(row.draftMeetingCount??(Array.isArray(row.draftMeetings)?row.draftMeetings.length:0));
        const official=Number(row.officialMeetingCount??0);
        meetingCountDetails={
          requiredMeetingCount:req,
          draftMeetingCount:Number.isSafeInteger(draft)?draft:null,
          officialMeetingCount:Number.isSafeInteger(official)?official:null
        };
      }
    }
    let maintenanceQueued: boolean|null=null;
    if(name==='stage_schedule_batch' && ['scheduling_transition_unverified','scheduling_home_route_unverified'].includes(String(output.reasonCode))){
      // Queue AFTER failed atomic stage, not inside the rolled-back transaction. No Google calls.
      const registration=await rpc(token,'scheduling_agent_team_queue_missing_stage_routes',{p_items:args.items}).catch(()=>null);
      maintenanceQueued=!!registration && !('error' in registration) && Number.isInteger(registration.data) && registration.data>0;
    }
    return result({isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:output.error,reasonCode:output.reasonCode??null,diagnosticCode:output.diagnosticCode??null,message:meetingCountDetails ? output.message+' נדרשים '+String(meetingCountDetails.requiredMeetingCount??'לא הוגדר')+' מפגשים, בטיוטה '+String(meetingCountDetails.draftMeetingCount??'לא ידוע')+', ובמועדים הרשמיים '+String(meetingCountDetails.officialMeetingCount??'לא ידוע')+'.' : output.message,meetingCountDetails,nextStep:maintenanceQueued===true?'המסלול החסר נרשם בתחזוקת המסלולים. נדרש חישוב ידני ואחריו ניסיון שיבוץ חדש באישור המשתמש.':output.nextStep,maintenanceQueued,activityId:output.activityId??null,retrySameRequest:false,writesCommitted:output.status>=500?null:false,outcome:output.status>=500?'unknown':'rejected'})}]});
  }
  if(name==='review_manager_approval'){
    // Never send the generic edit_requests row (which includes requested_payload) to ChatGPT.
    const row=output.data;
    return result({isError:false,content:[{type:'text',text:JSON.stringify({ok:true,result:{requestId:row.request_id,status:row.status,activityId:row.source_row_id,reviewedAt:row.reviewed_at,assignmentFinalized:false}})}]});
  }
  return result({isError:false,content:[{type:'text',text:JSON.stringify({ok:true,result:name==='read_snapshot'?describeSchedulingSnapshot(output.data):output.data})}]});
});

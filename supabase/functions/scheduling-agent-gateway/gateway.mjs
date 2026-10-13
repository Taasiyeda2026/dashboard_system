export const ACTIONS = Object.freeze(['read_snapshot','preview_changes','request_approval','commit_approved_changes','verify_commit']);
export class GatewayError extends Error {
 constructor(code,status=400){super(code);this.status=status;}
}
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
export async function snapshotHash(snapshot){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable(snapshot))));
 return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join('');
}
function exactKeys(body,allowed){if(Object.keys(body).some(k=>!allowed.includes(k)))throw new GatewayError('unexpected_field');}
const revision=v=>{if(typeof v!=='string'||!/^(0|[1-9]\d*)$/.test(v))throw new GatewayError('invalid_revision');return v;};
const uuid=v=>{if(typeof v!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v))throw new GatewayError('invalid_uuid');return v;};
export function createGateway({authenticate,rpc,readSheet,spreadsheetId,analyzeSnapshot,commitsEnabled=false}){
 return async function handle(request){
  try{
   if(request.method!=='POST')throw new GatewayError('method_not_allowed',405);
   if(Number(request.headers.get('content-length')||0)>16384)throw new GatewayError('payload_too_large',413);
   const raw=await request.text();if(new TextEncoder().encode(raw).length>16384)throw new GatewayError('payload_too_large',413);
   let body;try{body=JSON.parse(raw);}catch{throw new GatewayError('invalid_json');}
   if(!body||Array.isArray(body)||typeof body!=='object'||!ACTIONS.includes(body.action))throw new GatewayError('invalid_action');
   // authenticate verifies the user with the issuer; no role or actor is read from JSON.
   const actor=await authenticate(request);if(!actor?.id)throw new GatewayError('unauthorized',401);
   const pinnedSheetId=typeof spreadsheetId==='function'?spreadsheetId(actor):spreadsheetId;
   if(!pinnedSheetId)throw new GatewayError('spreadsheet_not_configured',503);
   const call=(name,args={})=>rpc(actor,name,args);
   let result;
   if(body.action==='read_snapshot'){
    exactKeys(body,['action']);
    const database=await call('scheduling_agent_read_snapshot');
    let sheet;
    try{sheet=await readSheet(actor,pinnedSheetId);}catch(error){
     if(!(error instanceof GatewayError)||error.message!=='google_server_oauth_not_configured')throw error;
     result={database,sheet:null,sheetHash:null,googleStatus:'authorization_required',mode:'read_only'};
    }
    if(sheet)result={database,sheet,sheetHash:await snapshotHash(sheet),googleStatus:'connected',mode:commitsEnabled?'approval_gated':'read_only'};
    if(sheet&&analyzeSnapshot)result.syncPreview=analyzeSnapshot({database,sheet});
   }else if(['preview_changes','request_approval'].includes(body.action)){
    exactKeys(body,['action','activityId','optionIndex','workspaceRevision','sourceRevision',...(body.action==='request_approval'?['idempotencyKey']:[])]);
    if(typeof body.activityId!=='string'||!body.activityId.trim()||body.activityId.length>200||!Number.isInteger(body.optionIndex)||body.optionIndex<0||body.optionIndex>50)throw new GatewayError('invalid_selection');
    // Authorize BEFORE reading Google; caller cannot change the pinned spreadsheet.
    await call('scheduling_agent_read_snapshot');
    const sheet=await readSheet(actor,pinnedSheetId);
    const args={p_activity_id:body.activityId,p_option_index:body.optionIndex,p_workspace_revision:revision(body.workspaceRevision),p_source_revision:revision(body.sourceRevision),p_sheet_hash:await snapshotHash(sheet)};
    result=await call(body.action==='preview_changes'?'scheduling_agent_preview':'scheduling_agent_request_approval',body.action==='request_approval'?{...args,p_idempotency_key:uuid(body.idempotencyKey)}:args);
   }else if(body.action==='commit_approved_changes'){
    exactKeys(body,['action','requestId']);
    if(!commitsEnabled)throw new GatewayError('writes_disabled',503);
    await call('scheduling_agent_read_snapshot');
    const sheet=await readSheet(actor,pinnedSheetId);
    result=await call('scheduling_agent_commit_approved',{p_request_id:uuid(body.requestId),p_sheet_hash:await snapshotHash(sheet)});
   }else{
    exactKeys(body,['action','requestId']);result=await call('scheduling_agent_verify_commit',{p_request_id:uuid(body.requestId)});
   }
   return Response.json({ok:true,result},{headers:{'Cache-Control':'no-store'}});
  }catch(error){
   // Do not disclose upstream messages, tokens, authorization headers or payloads.
   const known=error instanceof GatewayError;
   return Response.json({ok:false,error:known?error.message:'gateway_request_failed'},{status:known?error.status:502,headers:{'Cache-Control':'no-store'}});
  }
 };
}

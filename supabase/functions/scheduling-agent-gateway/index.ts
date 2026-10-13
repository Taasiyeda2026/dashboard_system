import { createGateway, GatewayError } from './gateway.mjs';
import { createGoogleReader, createGoogleTokenProvider } from './google-reader.mjs';
import { createServiceAccountTokenProvider } from './google-service-account.mjs';
import { JWT } from 'npm:google-auth-library@11.3.0';
import { createMcpTransport } from './mcp.mjs';
import { buildSyncPreview } from './sync-preview.mjs';

const SUPABASE_PROJECT = 'https://szinlhjuwyiyszdpsdop.supabase.co';
const rpcNames = new Set(['scheduling_agent_read_snapshot','scheduling_agent_preview',
 'scheduling_agent_request_approval','scheduling_agent_commit_approved','scheduling_agent_verify_commit']);
const url = Deno.env.get('SUPABASE_URL') || '';
const key = Deno.env.get('SUPABASE_ANON_KEY') || '';
const googleProviders=new Map<string,ReturnType<typeof createGoogleTokenProvider>>();
async function callRpc(authorization: string,name: string,args: unknown = {}) {
 if(!rpcNames.has(name))throw new GatewayError('rpc_not_allowed',403);
 const response=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',
  headers:{apikey:key,Authorization:authorization,'Content-Type':'application/json'},
  body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
 if(!response.ok){
  const code=(await response.json().catch(()=>({})))?.code;
  if(code==='42501')throw new GatewayError('permission_denied',403);
  if(code==='PT409')throw new GatewayError('revision_conflict',409);
  throw new GatewayError('database_rejected_request',409);
 }
 return response.json();
}

const authenticate=async (request: Request) => {
  if (url !== SUPABASE_PROJECT || !key) throw new GatewayError('gateway_not_configured',503);
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s]+$/.test(authorization))throw new GatewayError('unauthorized',401);
  const response=await fetch(`${url}/auth/v1/user`,{headers:{apikey:key,Authorization:authorization},signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new GatewayError('unauthorized',401);
  const user=await response.json();
  if(!user.id)throw new GatewayError('unauthorized',401);
  const snapshot=await callRpc(authorization,'scheduling_agent_read_snapshot');
  return {id:user.id,authorization,configuration:snapshot.connector};
};
const serviceAccountToken=createServiceAccountTokenProvider({credentialsJson:Deno.env.get('SCHEDULING_AGENT_GOOGLE_SERVICE_ACCOUNT'),createJwt:(options: ConstructorParameters<typeof JWT>[0])=>new JWT(options)});
const gateway=createGateway({
 analyzeSnapshot:buildSyncPreview,
 spreadsheetId:(actor: {configuration: {spreadsheetId:string}})=>actor.configuration.spreadsheetId,
 // A second authoritative DB switch also defaults to false. Never use service_role.
 commitsEnabled: Deno.env.get('SCHEDULING_AGENT_ENABLE_COMMITS') === 'true',
 authenticate,
 rpc: async (actor: { authorization: string }, name: string, args: unknown) => {
  return callRpc(actor.authorization,name,args);
 },
 // The connected Drive plugin does NOT give this server its access token.
 // This adapter stays closed until separate consent populates secure server secrets.
 readSheet: async(actor: {configuration:{spreadsheetId:string,folderId:string,googleSub:string}},id: string)=>{
  const config=actor.configuration;
  if(!googleProviders.has(config.googleSub))googleProviders.set(config.googleSub,createGoogleTokenProvider({
   clientId:Deno.env.get('SCHEDULING_AGENT_GOOGLE_CLIENT_ID'),clientSecret:Deno.env.get('SCHEDULING_AGENT_GOOGLE_CLIENT_SECRET'),
   refreshToken:Deno.env.get('SCHEDULING_AGENT_GOOGLE_REFRESH_TOKEN'),expectedGoogleSub:config.googleSub
  }));
  const provider=Deno.env.get('SCHEDULING_AGENT_GOOGLE_SERVICE_ACCOUNT')?serviceAccountToken:googleProviders.get(config.googleSub)!;
  return createGoogleReader({getAccessToken:provider,spreadsheetId:config.spreadsheetId,folderId:config.folderId})(actor,id);
 }
});
Deno.serve(createMcpTransport({handleGateway:gateway,authenticate,
 resourceUrl:SUPABASE_PROJECT+'/functions/v1/scheduling-agent-gateway/mcp',issuer:SUPABASE_PROJECT+'/auth/v1'}));

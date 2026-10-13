import {GatewayError} from './gateway.mjs';
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
const selection={activityId:{type:'string'},optionIndex:{type:'integer',minimum:0,maximum:50},workspaceRevision:{type:'string',pattern:'^[0-9]+$'},sourceRevision:{type:'string',pattern:'^[0-9]+$'}};
export const MCP_TOOLS=[
 {name:'read_snapshot',description:'Read the owner-bound dashboard and private Google Sheet. No writes.',inputSchema:object({},[])},
 {name:'preview_changes',description:'Preview one existing plan option. Does not approve or apply.',inputSchema:object(selection,Object.keys(selection))},
 {name:'request_approval',description:'Create an immutable pending request for a separate human approval screen.',inputSchema:object({...selection,idempotencyKey:{type:'string',format:'uuid'}},[...Object.keys(selection),'idempotencyKey'])},
 {name:'commit_approved_changes',description:'Consume one human-approved request through atomic existing scheduling RPCs. Disabled until activation.',inputSchema:object({requestId:{type:'string',format:'uuid'}},['requestId'])},
 {name:'verify_commit',description:'Read the receipt and compare the current committed activity version.',inputSchema:object({requestId:{type:'string',format:'uuid'}},['requestId'])}
];
export function createMcpTransport({handleGateway,authenticate,resourceUrl,issuer}){
 const metadataUrl=resourceUrl+'/.well-known/oauth-protected-resource';
 return async request=>{
  const path=new URL(request.url).pathname;
  if(request.method==='GET'&&path.endsWith('/.well-known/oauth-protected-resource'))return Response.json({resource:resourceUrl,authorization_servers:[issuer],scopes_supported:['openid'],bearer_methods_supported:['header']});
  if(!path.endsWith('/mcp'))return handleGateway(request);
  if(request.method==='GET')return new Response(null,{status:405}); // Stateless JSON transport; no SSE session.
  if(request.method!=='POST')return new Response(null,{status:405});
  let body;
  try{
   const raw=await request.text();if(new TextEncoder().encode(raw).length>16384)throw new GatewayError('payload_too_large',413);
   body=JSON.parse(raw);
   if(!body||body.jsonrpc!=='2.0'||Array.isArray(body)||typeof body.method!=='string')throw new GatewayError('invalid_jsonrpc');
   await authenticate(request);
  }catch(error){return Response.json({error:error instanceof GatewayError?error.message:'invalid_request'},{status:error instanceof GatewayError?error.status:400,headers:{'WWW-Authenticate':`Bearer resource_metadata="${metadataUrl}"`,'Cache-Control':'no-store'}});}
  const result=value=>Response.json({jsonrpc:'2.0',id:body.id,result:value},{headers:{'Cache-Control':'no-store'}});
  if(body.method==='notifications/initialized'&&!('id' in body))return new Response(null,{status:202});
  if(body.method==='initialize'){
   const supported=['2025-06-18','2025-03-26','2024-11-05'];
   return result({protocolVersion:supported.includes(body.params?.protocolVersion)?body.params.protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'taasiyeda-scheduling-agent',version:'0.2.0'}});
  }
  if(body.method==='ping')return result({});
  if(body.method==='tools/list')return result({tools:MCP_TOOLS});
  if(body.method==='tools/call'){
   const tool=MCP_TOOLS.find(t=>t.name===body.params?.name);
   if(!tool)return Response.json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Tool not found'}});
   const args=body.params?.arguments||{};
   if(!args||typeof args!=='object'||Array.isArray(args)||'action' in args)return result({isError:true,content:[{type:'text',text:'invalid_arguments'}]});
   const response=await handleGateway(new Request(request.url,{method:'POST',headers:request.headers,body:JSON.stringify({...args,action:tool.name})}));
   const data=await response.json();
   return result({isError:!response.ok,content:[{type:'text',text:JSON.stringify(data)}]});
  }
  return Response.json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
 };
}

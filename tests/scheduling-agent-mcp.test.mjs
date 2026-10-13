import test from 'node:test';import assert from 'node:assert/strict';
import {createMcpTransport} from '../supabase/functions/scheduling-agent-gateway/mcp.mjs';
import {GatewayError} from '../supabase/functions/scheduling-agent-gateway/gateway.mjs';
const url='https://private.example/gateway/mcp';
const req=(method,params)=>new Request(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
test('MCP discovery contains no data and every authenticated tool is allowlisted',async()=>{
 const m=createMcpTransport({resourceUrl:url,issuer:'https://issuer.example/auth',authenticate:async()=>({id:'owner'}),handleGateway:async()=>Response.json({ok:true})});
 const d=await m(new Request(url+'/.well-known/oauth-protected-resource'));assert.equal((await d.json()).resource,url);
 const tools=(await (await m(req('tools/list'))).json()).result.tools;assert.equal(tools.length,5);assert.equal(tools.some(t=>t.name==='approve'),false);
 assert.equal((await (await m(req('initialize',{protocolVersion:'2025-06-18'}))).json()).result.protocolVersion,'2025-06-18');
});
test('MCP unauthorized requests return an OAuth resource challenge without gateway execution',async()=>{
 let calls=0;const m=createMcpTransport({resourceUrl:url,issuer:'https://issuer.example/auth',authenticate:async()=>{throw new GatewayError('unauthorized',401);},handleGateway:async()=>{calls++;}});
 const r=await m(req('tools/list'));assert.equal(r.status,401);assert.match(r.headers.get('www-authenticate'),/resource_metadata/);assert.equal(calls,0);
});
test('MCP forwards only a named action and refuses action spoofing',async()=>{
 let received;const m=createMcpTransport({resourceUrl:url,issuer:'https://issuer.example/auth',authenticate:async()=>({id:'owner'}),handleGateway:async r=>{received=await r.json();return Response.json({ok:true});}});
 await m(req('tools/call',{name:'read_snapshot',arguments:{}}));assert.equal(received.action,'read_snapshot');
 assert.equal((await (await m(req('tools/call',{name:'read_snapshot',arguments:{action:'approve'}}))).json()).result.isError,true);
 assert.equal((await (await m(req('tools/call',{name:'execute_sql'}))).json()).error.code,-32601);
});

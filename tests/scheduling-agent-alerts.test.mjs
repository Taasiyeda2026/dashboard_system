import test from 'node:test';
import assert from 'node:assert/strict';
import {createAlertDelivery} from '../supabase/functions/scheduling-agent-wakeup/alerts.mjs';
import {createWakeupHandler} from '../supabase/functions/scheduling-agent-wakeup/handler.mjs';
const secret='synthetic-alert-secret-over-32-characters';
const tenantId='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
const credentials={tenantId,clientId,clientSecret:'synthetic',sender:'sender@example.invalid'};
const item={reserved:true,alertId:'stable-id',deliveryToken:'fenced-token',jobId:'job-id',kind:'failed',eventAt:'2026-10-15T08:00:00Z',recipient:'owner@example.invalid'};
const token=(roles=['Mail.Send'],appid=clientId)=>'header.'+Buffer.from(JSON.stringify({tid:tenantId,appid,roles})).toString('base64url')+'.signature';
test('unconfigured mail leaves durable outbox untouched',async()=>{
 assert.deepEqual(await createAlertDelivery({command:()=>assert.fail()})(),{status:'not_configured'});
});
test('Graph mail targets only DB owner and carries stable alert ID without exposing reservation token',async()=>{
 const events=[];const result=await createAlertDelivery({...credentials,
  command:async(action,payload)=>{events.push({action,payload});return action==='begin_send'?{started:true}:item;},
  fetchImpl:async(url,options)=>{
   assert.equal(options.redirect,'error');
   if(url.startsWith('https://login.microsoftonline.com/'))return Response.json({access_token:token()});
   assert.equal(url,'https://graph.microsoft.com/v1.0/users/sender%40example.invalid/sendMail');
   const mail=JSON.parse(options.body);assert.deepEqual(mail.message.toRecipients,[{emailAddress:{address:item.recipient}}]);
   assert.equal(mail.message.internetMessageHeaders[0].value,item.alertId);
   assert.ok(mail.message.body.content.includes(item.eventAt));assert.match(mail.message.body.content,/פעולה נדרשת/);
   assert.ok(!options.body.includes(item.deliveryToken));return new Response(null,{status:202});
  }})();
 assert.equal(result.status,'accepted');assert.equal(events[2].payload.accepted,true);
});
for(const kind of ['network','http'])test('Graph '+kind+' ambiguity suppresses automatic resend',async()=>{
 let ack;const result=await createAlertDelivery({...credentials,
  command:async(action,payload)=>{if(action==='ack')ack=payload;return action==='begin_send'?{started:true}:item;},
  fetchImpl:async url=>{if(url.startsWith('https://login.microsoftonline.com/'))return Response.json({access_token:token()});
   if(kind==='network')throw Error('private');return new Response(null,{status:503});}
 })();assert.equal(result.status,'delivery_unknown');assert.equal(ack.accepted,false);assert.equal(ack.uncertain,true);
});
for(const kind of ['permission','identity'])test('Graph '+kind+' denial does not reserve alert',async()=>{
 await assert.rejects(createAlertDelivery({...credentials,command:()=>assert.fail(),
  fetchImpl:async()=>Response.json({access_token:kind==='permission'?token([]):token(['Mail.Send'],tenantId)})})(),/mail_send_required/);
});
test('mail readiness checks credentials and owner without reserving or sending',async()=>{
 let count=0;const delivery=createAlertDelivery({...credentials,
  command:async action=>{assert.equal(action,'verify');return {recipientReady:true};},
  fetchImpl:async url=>{assert.ok(url.startsWith('https://login.microsoftonline.com/'));count++;return Response.json({access_token:token()});}});
 assert.equal((await delivery.verify()).mailSend,true);assert.equal(count,1);
});
test('alert outage never prevents queue wake and readiness never sends alerts',async()=>{
 let notifications=0,dispatches=0;const dispatch=async()=>{dispatches++;};dispatch.verify=async()=>({verified:true});
 const handler=createWakeupHandler({secret,notify:async()=>{notifications++;throw Error('lost');},dispatch,
  command:async action=>action==='reserve'?{reserved:true,jobId:'job',dispatchToken:'token'}:{} });
 const request=body=>new Request('https://example.invalid',{method:'POST',headers:{'x-scheduling-wakeup-secret':secret},body});
 assert.equal((await handler(request('{"action":"verify"}'))).status,200);assert.equal(notifications,0);
 assert.equal((await handler(request('{}'))).status,200);assert.equal(dispatches,1);assert.equal(notifications,1);
});

test('lost begin-send acknowledgement never sends email',async()=>{
 let sent=0;await assert.rejects(createAlertDelivery({...credentials,
  command:async action=>{if(action==='begin_send')throw Error('lost');return item;},
  fetchImpl:async url=>{if(url.startsWith('https://login.microsoftonline.com/'))return Response.json({access_token:token()});sent++;return new Response(null,{status:202});}
 })(),/lost/);assert.equal(sent,0);
});
test('Graph rate rejection permits a bounded safe retry',async()=>{
 let ack;const r=await createAlertDelivery({...credentials,
  command:async(action,payload)=>{if(action==='ack')ack=payload;return action==='begin_send'?{started:true}:item;},
  fetchImpl:async url=>url.startsWith('https://login.microsoftonline.com/')?Response.json({access_token:token()}):new Response(null,{status:429})
 })();assert.equal(r.status,'retry_pending');assert.equal(ack.retrySafe,true);assert.equal(ack.uncertain,false);
});

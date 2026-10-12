import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryWindow, staffMail, deliverClaim, runAutomation, STAFF_FEEDBACK_SENDER } from '../supabase/functions/feedback-staff-automation/delivery.mjs';
import { staffDeliveryStatus, staffStatusIndex } from '../frontend/src/impact-feedback/staff-delivery-status.js';

const item = { id:'id',claim_token:'claim',token:'a'.repeat(43),stage:'pre',
  school:'בית ספר אלון',program_title:'פורצות דרך',recipient_email:'selected@school.test' };
const baseUrl = 'https://taasiyeda2026.github.io/dashboard_system/';

test('staff feedback always sends through the office mailbox, not shared MS_MAIL_SENDER', () => {
  assert.equal(STAFF_FEEDBACK_SENDER, 'office@think.org.il');
  const edge=readFileSync(new URL('../supabase/functions/feedback-staff-automation/index.ts',import.meta.url),'utf8');
  assert.match(edge,/const sender = STAFF_FEEDBACK_SENDER;/);
  assert.doesNotMatch(edge,/const sender = Deno\.env\.get\('MS_MAIL_SENDER'\)/);
  assert.match(edge,/encodeURIComponent\(sender\)\}\/sendMail/);
});

test('default disabled: not one queue call, token request or mail call', async () => {
  const fail = () => { throw new Error('side_effect'); };
  for (const action of ['prepare','dispatch']) {
    assert.deepEqual(await runAutomation({action,now:new Date('2026-10-13T05:00Z'),rpc:fail,transport:fail}),
      {disabled:true,mail_sent:0});
  }
});

test('05/08 Israel gates at exact DST transition dates', () => {
  for (const [day,offset] of [['2026-10-24',3],['2026-10-25',2],['2027-03-25',2],['2027-03-26',3]]) {
    for (const [action,hour] of [['prepare',5],['dispatch',8]]) {
      assert.equal(deliveryWindow(action,new Date(`${day}T${String(hour-offset).padStart(2,'0')}:00Z`)),true);
      assert.equal(deliveryWindow(action,new Date(`${day}T${String(hour-offset+1).padStart(2,'0')}:00Z`)),false);
    }
  }
});

test('personal Hebrew mail uses selected address, program, school and stage token', () => {
  const mail=staffMail(item,baseUrl);
  assert.deepEqual(mail.toRecipients,[{emailAddress:{address:item.recipient_email}}]);
  assert.match(mail.subject,/פתיחה.*פורצות דרך.*אלון/);
  assert.ok(mail.body.content.includes(`${baseUrl}feedback.html?t=${item.token}`));
  assert.match(staffMail({...item,stage:'final'},baseUrl).subject,/סיום/);
  assert.throws(()=>staffMail({...item,token:'invalid'},baseUrl));
});

test('Graph 202, definitive rejection and ambiguous communication are recorded once', async () => {
  for (const status of [202,400,401,403,429,500,503,'network']) {
    const calls=[];
    const rpc=async(name,args)=>{ calls.push([name,args]);return {ready:true,recorded:true}; };
    let sent=0;
    const result=await deliverClaim(item,{rpc,baseUrl,getAccessToken:async()=> 'fake',send:async()=>{
      sent++;if(status==='network') throw new Error('lost');
      return new Response(null,{status,headers:{'request-id':'fake-request'}});
    }});
    assert.equal(sent,1);
    assert.equal(result,status===202?'accepted':status==='network'||status>=500?'unknown':'failed');
    assert.equal(calls.at(-1)[1].p_result,result);
    assert.equal(calls.filter(x=>x[0]==='feedback_staff_auto_finish').length,1);
  }
});

test('fresh check can prevent sending; token failure is definitive and sends nothing', async () => {
  let sent=0;const send=()=>{sent++;};const calls=[];
  const rpc=async(name,args)=>{calls.push([name,args]);return {ready:false};};
  assert.equal(await deliverClaim(item,{rpc,baseUrl,send,getAccessToken:async()=> 'fake'}),'blocked');
  assert.equal(await deliverClaim(item,{rpc,baseUrl,send,getAccessToken:async()=>{throw Error('auth');}}),'failed');
  assert.equal(sent,0);
  assert.equal(calls.at(-1)[1].p_error,'mail_preflight_failed');
});

test('lost DB acknowledgement never invokes the transport a second time', async () => {
  let sent=0;
  await assert.rejects(deliverClaim(item,{baseUrl,getAccessToken:async()=> 'fake',
    rpc:async(name)=>{if(name==='feedback_staff_auto_finish')throw Error('db_lost');return {ready:true};},
    send:async()=>{sent++;return new Response(null,{status:202});}}),/db_lost/);
  assert.equal(sent,1);
});

test('compact status covers all required labels and stays inside existing staff columns', () => {
  assert.deepEqual(['not_due','pending','sent','failed','needs_attention'].map(x=>staffDeliveryStatus(x).label),
    ['טרם הגיע מועד','ממתין לשליחה','נשלח','נכשל','דורש טיפול']);
  assert.equal(staffDeliveryStatus(undefined).label,'דורש טיפול');
  assert.equal(staffStatusIndex([{activity_row_id:'ACT',stage:'pre',status:'sent'}]).get('ACT|pre').status,'sent');
  const screen=readFileSync(new URL('../frontend/src/screens/impact-feedback.js',import.meta.url),'utf8');
  assert.match(screen,/scope !== 'staff' \|\| ui.year !== 'school_2027'/);
  assert.match(screen,/staffEmailStatusHtml\(g, 'pre', scope\)/);
  assert.match(screen,/staffEmailStatusHtml\(g, 'final', scope\)/);
  assert.equal((screen.match(/class="ifb-gw-date ifb-gw-date--start"/g)||[]).length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deliveryWindow, staffMail, deliverClaim, runAutomation, STAFF_FEEDBACK_SENDER, STAFF_GRAPH_CLIENT_ID, STAFF_GRAPH_TENANT_ID, staffGraphCredentials, staffGraphTokenHasMailSend } from '../supabase/functions/feedback-staff-automation/delivery.mjs';
import { staffDeliveryStatus, staffStatusIndex } from '../frontend/src/impact-feedback/staff-delivery-status.js';
import { STAFF_SIGNATURE_CONTENT_ID, STAFF_SIGNATURE_PNG_BASE64, STAFF_SIGNATURE_WIDTH, STAFF_SIGNATURE_HEIGHT } from '../supabase/functions/feedback-staff-automation/staff-signature.mjs';

const item = { id:'id',claim_token:'claim',token:'a'.repeat(43),stage:'pre',
  school:'בית ספר אלון',contact_name:'רונית כהן',program_title:'פורצות דרך',recipient_email:'selected@school.test' };
const baseUrl = 'https://taasiyeda2026.github.io/dashboard_system/';

test('staff feedback always sends through the office mailbox, not shared MS_MAIL_SENDER', () => {
  assert.equal(STAFF_FEEDBACK_SENDER, 'office@think.org.il');
  const edge=readFileSync(new URL('../supabase/functions/feedback-staff-automation/index.ts',import.meta.url),'utf8');
  assert.match(edge,/const sender = STAFF_FEEDBACK_SENDER;/);
  assert.doesNotMatch(edge,/const sender = Deno\.env\.get\('MS_MAIL_SENDER'\)/);
  assert.match(edge,/encodeURIComponent\(sender\)\}\/sendMail/);
});

test('dedicated Graph secrets are mandatory, pinned to approved Entra app and never fall back to shared MS_*', () => {
  const values = {
    MS_TENANT_ID: STAFF_GRAPH_TENANT_ID,
    MS_CLIENT_ID: STAFF_GRAPH_CLIENT_ID,
    MS_CLIENT_SECRET: 'shared-credential',
    FEEDBACK_STAFF_MS_TENANT_ID: STAFF_GRAPH_TENANT_ID,
    FEEDBACK_STAFF_MS_CLIENT_ID: STAFF_GRAPH_CLIENT_ID,
    FEEDBACK_STAFF_MS_CLIENT_SECRET: 'dedicated-credential'
  };
  const used = [];
  const credentials = staffGraphCredentials(name => { used.push(name); return values[name]; });
  assert.deepEqual(credentials, {
    tenant: STAFF_GRAPH_TENANT_ID, client: STAFF_GRAPH_CLIENT_ID, secret: 'dedicated-credential'
  });
  assert.deepEqual(used, [
    'FEEDBACK_STAFF_MS_CLIENT_ID',
    'FEEDBACK_STAFF_MS_TENANT_ID',
    'FEEDBACK_STAFF_MS_CLIENT_SECRET'
  ]);
  assert.throws(() => staffGraphCredentials(name => values['MS_' + name]), /credentials_not_ready/);
  assert.throws(() => staffGraphCredentials(name => name.startsWith('FEEDBACK_STAFF_') ? undefined : values[name]), /credentials_not_ready/);
  assert.throws(() => staffGraphCredentials(name => name === 'FEEDBACK_STAFF_MS_CLIENT_ID' ? 'wrong-app' : values[name]), /credentials_not_ready/);
  assert.throws(() => staffGraphCredentials(name => name === 'FEEDBACK_STAFF_MS_TENANT_ID' ? 'wrong-tenant' : values[name]), /credentials_not_ready/);
  const edge = readFileSync(new URL('../supabase/functions/feedback-staff-automation/index.ts',import.meta.url),'utf8');
  assert.match(edge, /staffGraphCredentials\(\(name: string\) => Deno\.env\.get\(name\)\)/);
  assert.match(edge, /staffGraphTokenHasMailSend\(String\(token\)\)/);
  assert.doesNotMatch(edge, /Deno\.env\.get\('MS_(CLIENT_ID|TENANT_ID|CLIENT_SECRET)'\)/);
});

test('Graph token needs Mail.Send application role from the matching app and tenant', () => {
  const jwt = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
  const granted = { appid: STAFF_GRAPH_CLIENT_ID, tid: STAFF_GRAPH_TENANT_ID, roles: ['Mail.Send'] };
  assert.equal(staffGraphTokenHasMailSend(jwt(granted)), true);
  assert.equal(staffGraphTokenHasMailSend(jwt({...granted,roles:['Files.Read.All']})), false);
  assert.equal(staffGraphTokenHasMailSend(jwt({...granted,roles:[],scp:'Mail.Send'})), false);
  assert.equal(staffGraphTokenHasMailSend(jwt({...granted,appid:'different-app'})), false);
  assert.equal(staffGraphTokenHasMailSend(jwt({...granted,tid:'different-tenant'})), false);
  assert.equal(staffGraphTokenHasMailSend(jwt({azp:STAFF_GRAPH_CLIENT_ID,tid:STAFF_GRAPH_TENANT_ID,roles:['Mail.Send']})), true);
  assert.equal(staffGraphTokenHasMailSend('opaque-token'), false);
  assert.equal(staffGraphTokenHasMailSend(null), false);
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

test('approved Hebrew opening and closing emails use the selected contact name and one school-free subject', () => {
  const pre=staffMail(item,baseUrl);
  const final=staffMail({...item,stage:'final'},baseUrl);
  const subject='משוב על פעילויות תעשיידע | פורצות דרך';
  for(const mail of [pre,final]) {
    assert.equal(mail.subject,subject);
    assert.equal(mail.body.contentType,'HTML');
    assert.deepEqual(mail.toRecipients,[{emailAddress:{address:item.recipient_email}}]);
    assert.match(mail.body.content,/dir="rtl"/);
    assert.match(mail.body.content,/שלום רונית כהן,/);
    assert.match(mail.body.content,/למילוי המשוב האישי:/);
    assert.match(mail.body.content,/תודה רבה על שיתוף הפעולה,/);
    assert.match(mail.body.content,/צוות תעשיידע/);
    assert.ok(mail.body.content.includes(`${baseUrl}feedback.html?t=${item.token}`));
    assert.doesNotMatch(mail.subject+mail.body.content,/בית ספר אלון/);
    assert.doesNotMatch(mail.subject,/פתיחה|סיום/);
    assert.doesNotMatch(mail.body.content,/\[שם איש הקשר\]|\[שם התוכנית\]/);
  }
  assert.match(pre.body.content,/לאחר המפגשים הראשונים בתוכנית/);
  assert.match(pre.body.content,/נשמח לשמוע את התרשמותך מהפעילות עד כה/);
  assert.match(pre.body.content,/כדאי לדייק, לשפר או להתאים כבר בשלב זה של התוכנית/);
  assert.match(pre.body.content,/להתאים אותה לצורכי התלמידים ובית הספר/);
  assert.match(final.body.content,/עם סיום התוכנית/);
  assert.match(final.body.content,/אילו חלקים היו משמעותיים במיוחד/);
  assert.match(final.body.content,/לשמר, לדייק או לשפר לקראת הפעילויות הבאות/);
  assert.match(final.body.content,/להתאים אותה לצורכי התלמידים ובית הספר/);
  assert.doesNotMatch(pre.body.content,/עם סיום התוכנית/);
  assert.doesNotMatch(final.body.content,/לאחר המפגשים הראשונים/);
  assert.throws(()=>staffMail({...item,token:'invalid'},baseUrl));
  assert.throws(()=>staffMail({...item,stage:'invalid'},baseUrl));
  assert.throws(()=>staffMail({...item,program_title:''},baseUrl));
});

test('approved wide Taasiyeda signature is an inline PNG under the single thank-you line in both emails', () => {
  const bytes=Buffer.from(STAFF_SIGNATURE_PNG_BASE64,'base64');
  assert.ok(bytes.length > 8000 && bytes.length < 25000);
  assert.deepEqual(bytes.subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
  assert.equal(bytes.readUInt32BE(16),825);
  assert.equal(bytes.readUInt32BE(20),179);
  assert.equal(STAFF_SIGNATURE_WIDTH,410);
  assert.equal(STAFF_SIGNATURE_HEIGHT,89);
  for(const stage of ['pre','final']) {
    const message=staffMail({...item,stage},baseUrl);
    assert.match(message.body.content,new RegExp('src="cid:'+STAFF_SIGNATURE_CONTENT_ID+'"'));
    assert.match(message.body.content,/alt="חתימת תעשיידע"/);
    assert.equal(message.body.content.includes('<p><strong>צוות תעשיידע</strong></p>'),false);
    assert.equal((message.body.content.match(/תודה רבה על שיתוף הפעולה,/g)||[]).length,1);
    assert.ok(message.body.content.indexOf('תודה רבה על שיתוף הפעולה,') < message.body.content.indexOf('src="cid:'));
    assert.match(message.body.content,/width="410" height="89"/);
    assert.doesNotMatch(message.body.content,/<p>בברכה,</);
    assert.doesNotMatch(message.body.content,/>צוות תעשיידע</);
    assert.doesNotMatch(message.body.content,/src="https?:[^"]+\\.(png|jpg|gif)/i);
    assert.deepEqual(message.attachments,[{
      '@odata.type':'#microsoft.graph.fileAttachment',
      name:'taasiyeda-signature.png',
      contentType:'image/png',
      contentId:STAFF_SIGNATURE_CONTENT_ID,
      isInline:true,
      contentBytes:STAFF_SIGNATURE_PNG_BASE64
    }]);
  }
});

test('personal name and program are safely escaped; blank names do not leak placeholders',()=>{
  const malicious=staffMail({...item,contact_name:'<רונית & דנה>',program_title:'<מדע & טכנולוגיה>'},baseUrl);
  assert.match(malicious.body.content,/שלום &lt;רונית &amp; דנה&gt;,/);
  assert.match(malicious.body.content,/&lt;מדע &amp; טכנולוגיה&gt;/);
  assert.doesNotMatch(malicious.body.content,/<רונית|<מדע/);
  assert.equal(staffMail({...item,contact_name:''},baseUrl).body.content.includes('שלום רב,'),true);
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

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import QRCode from 'npm:qrcode@1.5.4';

// All routes share one verified office-mail Graph application and DB transaction log.
// This endpoint is reachable only with the preexisting Vault-owned scheduler secret.
const SENDER='office@think.org.il';
const GRAPH_CLIENT='b37ae8f7-0b03-4925-b0e4-f5cb8da95238';
const GRAPH_TENANT='bb3f0918-c67d-4fee-b2db-e6a8eab891d1';
const SCHEDULER_SECRET_SHA256='5799221868b0bc9081f4d3cda7839928dd84c79d7b7680033f80283b471a93f4';

const json=(payload:unknown,status=200)=>new Response(JSON.stringify(payload),{
 status,headers:{'Content-Type':'application/json; charset=utf-8'}
});
const clean=(value:unknown)=>String(value??'').replace(/[\r\n]+/g,' ').trim();
const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g, (c)=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
} as Record<string,string>)[c]||c);
const digest=async(value:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))]
 .map(b=>b.toString(16).padStart(2,'0')).join('');
const goodAddress=(v:unknown)=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v||''));
const readJwt=(token:string)=>JSON.parse(atob((token.split('.')[1]||'')
 .replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil((token.split('.')[1]||'').length/4)*4,'=')));

interface Delivery {
 id:string;claim_token:string;audience:'student'|'instructor';stage:'pre'|'post'|'final'|'final_b';
 delivery_key:string;recipient_name:string;recipient_email:string;cc_email:string|null;
 program_title:string;school_name:string;authority_name:string;
 grade:string;class_group:string;token:string;
}

function surveyUrl(item:Delivery) {
 if(!/^[A-Za-z0-9_-]{20,128}$/.test(item.token||''))throw Error('invalid_survey_token');
 const link=new URL('feedback.html','https://taasiyeda2026.github.io/dashboard_system/');
 link.searchParams.set('t',item.token);
 return link.href;
}

async function composeEmail(item:Delivery) {
 if(!goodAddress(item.recipient_email))throw Error('missing_valid_recipient');
 if(item.audience==='student'&&!goodAddress(item.cc_email))throw Error('missing_valid_assigned_manager');
 const program=escapeHtml(clean(item.program_title));
 const school=escapeHtml(clean(item.school_name));
 const grade=escapeHtml(clean(item.grade));
 const authority=escapeHtml(clean(item.authority_name));
 const group=escapeHtml(clean(item.class_group));
 const name=escapeHtml(clean(item.recipient_name));
 if(!program||!name)throw Error('invalid_mail_identity');
 const link=surveyUrl(item);
 const title=item.audience==='student'
    ? item.stage==='pre'?'משוב פתיחת קורס':'משוב סיום קורס'
    : item.stage==='pre'?'משוב פתיחה לאחר הכשרה'
    : item.stage==='final'?'משוב סיום מחצית א׳':'משוב סיום מחצית ב׳';
 const greeting='<p>שלום '+name+',</p>';
 const studentParagraph='<p>לקראת המפגש הקרוב, נבקש להעביר לתלמידים את <strong>'+escapeHtml(title)+
    '</strong> עבור התוכנית <strong>'+program+'</strong>.</p>'+
    '<p>בית ספר: <strong>'+school+'</strong> · רשות: '+authority+' · כיתה: '+grade+
    (group?' · קבוצה: '+group:'')+'</p>'+
    '<p>ניתן להציג לתלמידים את קוד ה־QR או להעביר להם את הקישור. המשוב זמין גם בלשונית „משובים” בממשק המדריכים.</p>';
 const personalParagraph=item.stage==='pre'
   ? '<p>לאחר ההכשרה לתוכנית <strong>'+program+
     '</strong>, נשמח לקבל את התרשמותך מההכשרה, מהחומרים וממידת המוכנות שלך להדרכה.</p>'
   : '<p>עם סיום ההדרכה בתוכנית <strong>'+program+
     '</strong>, נשמח לקבל את המשוב האישי שלך, שיסייע לשפר את הפעילות.</p>';
 const files:unknown[]=[];
 let qr='';
 if(item.audience==='student'){
   const image=await QRCode.toDataURL(link,{width:250,margin:1,errorCorrectionLevel:'M'});
   const png=image.split(',')[1];
   if(!png)throw Error('qr_generation_failed');
   files.push({'@odata.type':'#microsoft.graph.fileAttachment',
      name:'feedback-qr.png',contentType:'image/png',contentId:'student-feedback-qr',
      isInline:true,contentBytes:png});
   qr='<p><img src="cid:student-feedback-qr" alt="QR לפתיחת משוב תלמידים" width="200" height="200"></p>';
 }
 const msg={
  subject:title+' | '+clean(item.program_title)+(item.audience==='student'?' | '+clean(item.school_name):''),
  body:{contentType:'HTML',content:
   '<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;text-align:right">'+
   greeting+(item.audience==='student'?studentParagraph:personalParagraph)+
   '<p><strong>קישור למשוב:</strong> <a href="'+escapeHtml(link)+'">למילוי המשוב</a></p>'+
   qr+'<p>תודה רבה על שיתוף הפעולה,<br>צוות תעשיידע</p></div>'},
  toRecipients:[{emailAddress:{address:item.recipient_email}}],
  ...(item.audience==='student'?{ccRecipients:[{emailAddress:{address:String(item.cc_email)}}]}:{}),
  ...(files.length?{attachments:files}:{})
 };
 return msg;
}

Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
  const secret=req.headers.get('x-staff-dry-run-secret')||'';
  if(!secret||await digest(secret)!==SCHEDULER_SECRET_SHA256)
    return json({ok:false,error:'unauthorized'},401);
  const input=await req.json().catch(()=>({}));
  const action=String(input?.action||'');
  if(!['daily_prepare','daily_dispatch','manual'].includes(action))
    return json({ok:false,error:'invalid_action'},400);
  const local=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
  if(action==='daily_prepare'&&local!=='05:30')return json({ok:true,outside_window:true});
  if(action==='daily_dispatch'&&(local<'09:15'||local>='09:45'))
    return json({ok:true,outside_window:true});
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!supabaseUrl||!serviceKey)return json({ok:false,error:'db_not_configured'},503);
  const rpc=async(name:string,body:Record<string,unknown>={})=>{
    const r=await fetch(supabaseUrl+'/rest/v1/rpc/'+name,{
     method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},
     body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});
    if(!r.ok)throw Error(name+'_http_'+r.status);
    return r.json();
  };
  const creds=()=>{
   const id=String(Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_ID')||'').toLowerCase();
   const tenant=String(Deno.env.get('FEEDBACK_STAFF_MS_TENANT_ID')||'').toLowerCase();
   const password=Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_SECRET')||'';
   if(id!==GRAPH_CLIENT||tenant!==GRAPH_TENANT||!password)throw Error('graph_credentials_not_ready');
   return password;
  };
  let graphToken:string|undefined;
  const getGraphToken=async()=>{
   if(graphToken)return graphToken;
   const password=creds();
   const tokenResponse=await fetch('https://login.microsoftonline.com/'+GRAPH_TENANT+'/oauth2/v2.0/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:GRAPH_CLIENT,client_secret:password,
       scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
    signal:AbortSignal.timeout(15000)});
   if(!tokenResponse.ok)throw Error('graph_token_http_'+tokenResponse.status);
   const token=String((await tokenResponse.json()).access_token||'');
   let payload:Record<string,unknown>;
   try{payload=readJwt(token);}catch{throw Error('graph_token_invalid');}
   if(String(payload.appid||payload.azp||'').toLowerCase()!==GRAPH_CLIENT
     ||String(payload.tid||'').toLowerCase()!==GRAPH_TENANT
     ||!Array.isArray(payload.roles)||!payload.roles.includes('Mail.Send'))
      throw Error('graph_mail_send_not_granted');
   graphToken=token;
   return token;
  };
  // Preflight the real sender before creating any dispatchable campaigns.
  if(action==='daily_prepare')await getGraphToken();
  const mode=action==='manual'?'manual':'daily';
  let prepared:unknown;
  if(action==='daily_prepare'||action==='manual'){
    prepared=await rpc('feedback_auto_prepare',{p_mode:mode});
  }
  if(action==='daily_prepare')return json({ok:true,prepared});
  if(action==='manual'&&(!prepared||Number((prepared as {prepared_or_checked?:number}).prepared_or_checked||0)===0))
    return json({ok:true,prepared,mail_sent:0});
  const token=await getGraphToken();
  const outcomes={accepted:0,failed:0,unknown:0,blocked:0};
  // Keep requests sequential so one mailbox does not trip Graph 429 at scale.
  for(let i=0;i<16;i++){
   const item=await rpc('feedback_auto_claim',{p_mode:mode}) as Delivery|null;
   if(!item?.id)break;
   let email:unknown;
   try{email=await composeEmail(item);}catch{
     // A failed preflight is safe to record without invoking Graph.
     const began=await rpc('feedback_auto_begin',{p_id:item.id,p_claim:item.claim_token});
     if(began===true) {
       await rpc('feedback_auto_finish',{p_id:item.id,p_claim:item.claim_token,
         p_status:'failed',p_http:null,p_graph_request_id:null,p_error:'mail_preflight_failed'});
     }
     outcomes.failed++;continue;
   }
   const allow=await rpc('feedback_auto_begin',{p_id:item.id,p_claim:item.claim_token});
   if(allow!==true){outcomes.blocked++;continue;}
   let status='unknown';let http:number|null=null;let requestId:string|null=null;let error:string|null=null;
   try{
     const r=await fetch('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(SENDER)+'/sendMail',{
       method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
       body:JSON.stringify({message:email,saveToSentItems:true}),signal:AbortSignal.timeout(25000)});
     http=r.status;requestId=r.headers.get('request-id');
     status=r.status===202?'accepted'
       :[400,401,403,404,413,422,429].includes(r.status)?'failed':'unknown';
     if(status!=='accepted')error='graph_http_'+r.status;
   }catch{error='graph_response_uncertain';}
   try{await rpc('feedback_auto_finish',{p_id:item.id,p_claim:item.claim_token,
      p_status:status,p_http:http,p_graph_request_id:requestId,p_error:error});
   }catch{status='unknown';}
   outcomes[status as 'accepted'|'failed'|'unknown']++;
  }
  return json({ok:true,mode,prepared:prepared||null,...outcomes});
 }catch(error){
   console.error('feedback auto scheduler failed, no personal details emitted');
   return json({ok:false,error:clean(error instanceof Error?error.message:'automation_error')},500);
 }
});

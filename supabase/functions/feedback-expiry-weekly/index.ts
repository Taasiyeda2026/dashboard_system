import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Every second Thursday 08:30 Asia/Jerusalem from 2026-11-12, plus one explicit first send on 2026-10-28. No automatic expiry extension.
// Exactly one non-retried mail attempt per manager and week; the database is the audit log.
const SECRET_DIGEST = '5799221868b0bc9081f4d3cda7839928dd84c79d7b7680033f80283b471a93f4';
const GRAPH_CLIENT = 'b37ae8f7-0b03-4925-b0e4-f5cb8da95238';
const GRAPH_TENANT = 'bb3f0918-c67d-4fee-b2db-e6a8eab891d1';
const SENDER = 'office@think.org.il';

const reply = (v: unknown, status = 200) => new Response(JSON.stringify(v), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8'}
});
const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
const html = (v: unknown) => clean(v).replace(/[&<>"']/g, (c) =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'} as Record<string,string>)[c]);
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
  .map((x) => x.toString(16).padStart(2, '0')).join('');
const validEmail = (s: unknown) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(s));
const localTime = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(d).map((p) => [p.type, p.value]));
const date = (v: unknown) => {
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('he-IL', {
    dateStyle:'short',timeZone:'Asia/Jerusalem'
  }).format(d);
};
const stage = (audience: string, s: string) =>
  audience === 'instructor'
    ? (s === 'pre' ? 'משוב מדריך - פתיחה' : s === 'final_b' ? 'משוב מדריך - סיום ב׳' : 'משוב מדריך - סיום')
    : (s === 'pre' ? 'משוב צוות חינוכי - פתיחה' : 'משוב צוות חינוכי - סיום');

type PendingItem = { audience:string;stage:string;program:string;subject_name:string;school:string;expired_at:string };
type Digest = { ready:boolean; to_email:string; cc_emails:string[]; items:PendingItem[]; count:number };

function emailMessage(payload: Digest) {
  if (!validEmail(payload.to_email) || !Array.isArray(payload.cc_emails) ||
      !payload.cc_emails.length || payload.cc_emails.some((x) => !validEmail(x)) ||
      !Array.isArray(payload.items) || !payload.items.length) throw Error('mail_preflight_failed');
  const rows = payload.items.map((item, i) =>
    '<tr><td style="border:1px solid #ddd;padding:7px">'+(i+1)+'</td>' +
    '<td style="border:1px solid #ddd;padding:7px">'+html(stage(item.audience,item.stage))+'</td>' +
    '<td style="border:1px solid #ddd;padding:7px">'+html(item.subject_name)+'</td>' +
    '<td style="border:1px solid #ddd;padding:7px">'+html(item.program)+'</td>' +
    '<td style="border:1px solid #ddd;padding:7px">'+html(item.school)+'</td>' +
    '<td style="border:1px solid #ddd;padding:7px">'+html(date(item.expired_at))+'</td></tr>'
  ).join('');
  const body = '<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;line-height:1.6;font-size:15px">' +
    '<p>שלום,</p><p>להלן המשובים שבאחריותך אשר פג תוקפם וטרם מולאו. '+
    'יש להיכנס למערכת, לפתוח את <strong>משובים</strong>, לבחור את המשוב וללחוץ על <strong>עדכון תוקף</strong> כדי לאפשר את השלמתו.</p>' +
    '<p><strong>משובים לטיפול: '+payload.items.length+'</strong></p>' +
    '<table style="border-collapse:collapse;text-align:right"><thead><tr>' +
    ['#','סוג משוב','מדריך / איש קשר','תוכנית','בית ספר','פג תוקף']
    .map((label)=>'<th style="border:1px solid #ddd;padding:7px;background:#f5f5f5">'+html(label)+'</th>').join('') +
    '</tr></thead><tbody>'+rows+'</tbody></table>' +
    '<p><a href="https://taasiyeda2026.github.io/dashboard_system/">פתיחת דשבורד תעשיידע</a></p>' +
    '<p>התוקף אינו משתנה אוטומטית. קישור המשוב הקיים נשמר לאחר העדכון.</p>' +
    '<p>בברכה,<br>מערכת תעשיידע</p></div>';
  return {
    subject: 'תעשיידע | דוח דו-שבועי: '+payload.items.length+' משובים שפג תוקפם',
    body: {contentType:'HTML',content:body},
    toRecipients: [{emailAddress:{address:payload.to_email}}],
    ccRecipients: [...new Set(payload.cc_emails.map((x)=>x.toLowerCase()))]
      .filter((x)=>x!==payload.to_email.toLowerCase())
      .map((address)=>({emailAddress:{address}}))
  };
}
function jwtClaims(token: string) {
  const part = token.split('.')[1]||'';
  return JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/')
    .padEnd(Math.ceil(part.length/4)*4,'=')));
}
async function graphToken() {
  const client=String(Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_ID')||'').toLowerCase();
  const tenant=String(Deno.env.get('FEEDBACK_STAFF_MS_TENANT_ID')||'').toLowerCase();
  const secret=Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_SECRET')||'';
  if(client!==GRAPH_CLIENT||tenant!==GRAPH_TENANT||!secret)throw Error('graph_credentials_missing');
  const r=await fetch('https://login.microsoftonline.com/'+GRAPH_TENANT+'/oauth2/v2.0/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:client,client_secret:secret,
      scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
    signal:AbortSignal.timeout(15000)
  });
  if(!r.ok)throw Error('graph_token_failed');
  const token=String((await r.json()).access_token||'');
  const claims=jwtClaims(token);
  if(String(claims.tid||'').toLowerCase()!==GRAPH_TENANT ||
    String(claims.appid||claims.azp||'').toLowerCase()!==GRAPH_CLIENT ||
    !Array.isArray(claims.roles)||!claims.roles.includes('Mail.Send'))throw Error('mail_send_not_granted');
  return token;
}

Deno.serve(async(req:Request)=>{
  try {
    if(req.method!=='POST')return reply({ok:false,error:'method_not_allowed'},405);
    const header=req.headers.get('x-staff-dry-run-secret')||'';
    if(!header || await sha(header)!==SECRET_DIGEST)return reply({ok:false,error:'unauthorized'},401);
    const clock=localTime(new Date());
    const israelDay=[clock.year,clock.month,clock.day].join('-');
    const action=String((await req.json().catch(()=>({})))?.action||'');
    if(action!=='scheduled' && action!=='send_now')
      return reply({ok:false,error:'invalid_action'},400);
    const localUtcDay=Date.UTC(Number(clock.year),Number(clock.month)-1,Number(clock.day));
    const anchorUtcDay=Date.UTC(2026,10,12);
    const daysSinceAnchor=Math.round((localUtcDay-anchorUtcDay)/86400000);
    const scheduled=clock.weekday==='Thu' && clock.hour==='08' && clock.minute==='30'
      && daysSinceAnchor>=0 && daysSinceAnchor%14===0;
    // The one-time first send is not a standing manual API.
    const immediate=action==='send_now' && israelDay==='2026-10-28';
    if((action==='scheduled'&&!scheduled)||(action==='send_now'&&!immediate))
      return reply({ok:true,outside_window:true});
    const url=Deno.env.get('SUPABASE_URL')||'';
    const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
    if(!url||!key)return reply({ok:false,error:'database_not_configured'},503);
    const rpc=async (name:string, body:Record<string,unknown>)=>{
      const r=await fetch(url+'/rest/v1/rpc/'+name,{
        method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(20000)
      });
      if(!r.ok)throw Error(name+'_http_'+r.status);
      return await r.json();
    };
    // Preflight before acquiring any weekly claim.
    const token=await graphToken();
    const totals={accepted:0,failed:0,unknown:0,blocked:0};
    for(let n=0;n<25;n++){
      const claim=await rpc('feedback_expiry_weekly_claim',{}) as {ready:boolean;id?:string;claim_token?:string};
      if(!claim?.ready||!claim.id||!claim.claim_token)break;
      const begin=await rpc('feedback_expiry_weekly_begin',{
        p_id:claim.id,p_claim:claim.claim_token
      }) as Digest;
      if(!begin?.ready){totals.blocked++;continue;}
      let status='unknown',http:number|null=null,requestId:string|null=null,error:string|null=null;
      try {
        const message=emailMessage(begin);
        const result=await fetch('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(SENDER)+'/sendMail',{
          method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({message,saveToSentItems:true}),signal:AbortSignal.timeout(25000)
        });
        http=result.status;requestId=result.headers.get('request-id');
        status=http===202?'accepted':[400,401,403,404,413,422,429].includes(http)?'failed':'unknown';
        if(http!==202)error='graph_http_'+http;
      }catch{status='unknown';error='graph_outcome_uncertain';}
      // No resend if Graph accepted but recording fails: an unknown claim is permanent.
      try {
        await rpc('feedback_expiry_weekly_finish',{p_id:claim.id,p_claim:claim.claim_token,
          p_result:status,p_http:http,p_graph_request_id:requestId,p_error:error});
      }catch{status='unknown';}
      totals[status as 'accepted'|'failed'|'unknown']++;
    }
    return reply({ok:true,...totals});
  }catch{
    console.error('Weekly expired feedback digest failed without logging addresses or tokens');
    return reply({ok:false,error:'weekly_digest_failed'},500);
  }
});

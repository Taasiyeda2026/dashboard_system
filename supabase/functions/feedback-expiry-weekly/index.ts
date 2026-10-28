import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

// Every second Thursday 08:30 Asia/Jerusalem from 2026-11-12, plus one explicit first send on 2026-10-28. No automatic expiry extension.
// Exactly one non-retried mail attempt per manager and week; the database is the audit log.
const SECRET_DIGEST = '5799221868b0bc9081f4d3cda7839928dd84c79d7b7680033f80283b471a93f4';
const GRAPH_CLIENT = 'b37ae8f7-0b03-4925-b0e4-f5cb8da95238';
const GRAPH_TENANT = 'bb3f0918-c67d-4fee-b2db-e6a8eab891d1';
const SENDER = 'office@think.org.il';
const MAIL_DELIVERY_APPROVED = true; // approved 2026-10-28: office@think.org.il to activity managers; idann@think.org.il CC only

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
type Digest = { ready:boolean; to_name?:string; to_email:string; cc_emails:string[]; items:PendingItem[]; count:number };

/** Outlook-safe, RTL HTML. Exactly four columns, one row for each feedback campaign. */
function emailMessage(payload: Digest, now = new Date()) {
  if (!validEmail(payload.to_email) || !Array.isArray(payload.cc_emails) ||
      !payload.cc_emails.length || payload.cc_emails.some((x) => !validEmail(x)) ||
      !Array.isArray(payload.items) || !payload.items.length) throw Error('mail_preflight_failed');
  const firstName = clean(payload.to_name).split(/\s+/)[0];
  const greeting = firstName ? 'שלום ' + html(firstName) + ',' : 'שלום,';
  const items = [...payload.items].sort((a,b) =>
    clean(a.subject_name).localeCompare(clean(b.subject_name),'he') ||
    clean(a.program).localeCompare(clean(b.program),'he') ||
    clean(a.expired_at).localeCompare(clean(b.expired_at)));
  const allInstructor = items.every((x) => x.audience === 'instructor');
  const allInstructorPre = allInstructor && items.every((x) => x.stage === 'pre');
  const allStaff = items.every((x) => x.audience === 'educational_staff');
  const personHeader = allInstructor ? 'מדריך' : allStaff ? 'איש קשר' : 'מדריך / איש קשר';
  const intro = allInstructorPre
    ? 'נמצאו משובי פתיחה של מדריכים שפג תוקפם וטרם מולאו.'
    : 'נמצאו משובים שפג תוקפם וטרם מולאו, ונדרש לעדכן את תוקפם במערכת.';
  // Word/Outlook ignores many web-style layout hints. Set explicit pixel widths,
  // visible cell borders, cell padding and a fixed line height on EACH cell.
  const widths = [42, 168, 192, 118]; // 520px total, RTL order: number | person | course | expiry
  const cellStyle = (extra = '') =>
    'border:1px solid #D5DEE7;padding:5px 7px;vertical-align:middle;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:12pt;font-weight:400;' +
    'line-height:19px;mso-line-height-rule:exactly;text-align:right;' + extra;
  const rows = items.map((item, i) => {
    const cols = [
      String(i + 1),
      html(item.subject_name),
      html(item.program),
      '<span dir="ltr" style="direction:ltr;white-space:nowrap">' + html(date(item.expired_at)) + '</span>'
    ];
    return '<tr valign="middle">' + cols.map((value,index) =>
      '<td width="' + widths[index] + '" align="' + (index === 0 ? 'center' : 'right') + '"' +
      ' dir="' + (index === 3 ? 'ltr' : 'rtl') + '" bgcolor="#FFFFFF" style="' +
      cellStyle(index === 0 ? 'text-align:center;' : index === 3 ? 'text-align:right;white-space:nowrap;' : '') +
      '">' + value + '</td>').join('') + '</tr>';
  }).join('');
  const heads = [
    'מספר',personHeader,'קורס','תוקף'
  ].map((name,index) =>
    '<th width="' + widths[index] + '" align="' + (index === 0 ? 'center' : 'right') + '"' +
    ' dir="rtl" bgcolor="#EAF1F5" scope="col" style="' +
    'border:1px solid #CAD6DF;padding:6px 7px;text-align:'+(index === 0 ? 'center' : 'right')+';' +
    'font-family:Arial,Helvetica,sans-serif;font-size:12pt;font-weight:bold;' +
    'line-height:19px;mso-line-height-rule:exactly;white-space:nowrap">' +
    html(name) + '</th>').join('');
  const surveyTab = allStaff ? 'צוות חינוכי' : allInstructor ? 'מדריכים' : 'הלשונית המתאימה';
  const steps = [
    allInstructor || allStaff
      ? 'היכנס לדשבורד תעשיידע < משובים < '+surveyTab+'.'
      : 'היכנס לדשבורד תעשיידע ולממשק "משובים".',
    'אתר את המשובים שפג תוקפם לפי הטבלה.',
    'לחץ על "עדכון תוקף", בחר תאריך חדש ושמור.',
    allInstructor ? 'שלח מחדש למדריכים את הקישור למילוי המשוב.' :
      allStaff ? 'שלח מחדש לצוות החינוכי את הקישור למילוי המשוב.' :
      'שלח מחדש לנמענים את הקישור למילוי המשוב.'
  ];
  const body = '<div dir="rtl" lang="he" style="direction:rtl;text-align:right;font-family:Arial,Helvetica,sans-serif;' +
    'font-size:15px;line-height:1.65;color:#111;max-width:700px;margin:0;padding:0">' +
    '<p style="margin:0 0 22px">'+greeting+'</p>' +
    '<p style="margin:0 0 28px">בבדיקה שבוצעה ביום <span dir="ltr">'+html(date(now))+
    '</span> '+intro+'</p>' +
    '<p style="margin:0 0 12px;font-size:17px;font-weight:bold;text-decoration:underline">פירוט המשובים לטיפול:</p>' +
    '<table dir="rtl" align="right" border="1" bordercolor="#D5DEE7" role="table" width="520" ' +
    'cellspacing="0" cellpadding="0" bgcolor="#FFFFFF" style="direction:rtl;' +
    'border-collapse:collapse;border:1px solid #D5DEE7;width:520px;' +
    'table-layout:fixed;text-align:right;margin:0 0 20px">' +
    '<thead><tr>'+heads+'</tr></thead><tbody>'+rows+'</tbody></table>' +
    '<p style="font-size:17px;font-weight:bold;margin:24px 0 12px">מה נדרש לעשות?</p>' +
    '<ol style="margin:0 0 25px;padding:0 28px 0 0;direction:rtl;text-align:right">' +
    steps.map((step)=>'<li style="margin:0 0 3px;padding-right:2px">'+html(step)+'</li>').join('') +
    '</ol>' +
    '<p style="margin:24px 0 32px"><strong>שים לב:</strong> עדכון התוקף מפעיל מחדש את הקישור הקיים, ' +
    'ללא צורך ביצירת משוב חדש.</p>' +
    '<p style="margin:0">בברכה,<br>מערכת תעשיידע</p></div>';
  return {
    subject: 'תעשיידע | '+items.length+' משובי '+(allInstructor ? 'מדריכים' : allStaff ? 'צוות חינוכי' : 'פעילויות')+' שפג תוקפם - נדרש טיפול',
    body: {contentType:'HTML',content:body},
    toRecipients: [{emailAddress:{address:payload.to_email}}],
    // The administrator receives only a copy; never use the administrator as To.
    ccRecipients: [{emailAddress:{address:'idann@think.org.il'}}]
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
    if(!MAIL_DELIVERY_APPROVED)return reply({ok:true,approval_required:true,mail_sent:0});
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

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const OFFICE = 'office@think.org.il';
const GRAPH_CLIENT_ID = 'b37ae8f7-0b03-4925-b0e4-f5cb8da95238';
const GRAPH_TENANT_ID = 'bb3f0918-c67d-4fee-b2db-e6a8eab891d1';
const CRON_SECRET_SHA256='5799221868b0bc9081f4d3cda7839928dd84c79d7b7680033f80283b471a93f4';
const DUE=Date.parse('2026-10-13T17:00:00Z');
const UNTIL=Date.parse('2026-10-13T17:30:00Z');

const respond=(obj:unknown,code=200)=>new Response(JSON.stringify(obj),{status:code,headers:{'Content-Type':'application/json; charset=utf-8'}});
const digest=async(input:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));
const plain=(value:unknown)=>String(value??'').replace(/[\r\n]+/g,' ').trim();
const decodeClaims=(token:string)=>JSON.parse(atob((token.split('.')[1]||'').replace(/-/g,'+').replace(/_/g,'/')));

Deno.serve(async(req:Request)=>{
 try{
  if(req.method!=='POST')return respond({ok:false,error:'method_not_allowed'},405);
  const secret=req.headers.get('x-staff-dry-run-secret')||'';
  if(!secret || await digest(secret)!==CRON_SECRET_SHA256)return respond({ok:false,error:'unauthorized'},401);
  const body=await req.json().catch(()=>({}));
  if(body.action!=='dispatch')return respond({ok:false,error:'invalid_action'},400);
  const now=Date.now();
  if(now<DUE||now>=UNTIL)return respond({ok:false,error:'outside_one_time_window'},409);
  const url=Deno.env.get('SUPABASE_URL');
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return respond({ok:false,error:'missing_backend_credentials'},503);
  const rpc=async(name:string,args:Record<string,unknown>={})=>{
   const res=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
   if(!res.ok)throw Error('rpc_'+name+'_'+res.status);
   return res.json();
  };
  const client=(Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_ID')||'').toLowerCase();
  const tenant=(Deno.env.get('FEEDBACK_STAFF_MS_TENANT_ID')||'').toLowerCase();
  const clientSecret=Deno.env.get('FEEDBACK_STAFF_MS_CLIENT_SECRET')||'';
  if(client!==GRAPH_CLIENT_ID||tenant!==GRAPH_TENANT_ID||!clientSecret)
   return respond({ok:false,error:'graph_credentials_not_ready'},503);
  const tokenRes=await fetch('https://login.microsoftonline.com/'+GRAPH_TENANT_ID+'/oauth2/v2.0/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({client_id:GRAPH_CLIENT_ID,client_secret:clientSecret,scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
   signal:AbortSignal.timeout(20000)
  });
  if(!tokenRes.ok)return respond({ok:false,error:'graph_token_failure',http_status:tokenRes.status},503);
  const token=String((await tokenRes.json()).access_token||'');
  let claims:any={};
  try{claims=decodeClaims(token);}catch{return respond({ok:false,error:'invalid_graph_token'},503);}
  if(String(claims.appid||claims.azp||'').toLowerCase()!==GRAPH_CLIENT_ID||String(claims.tid||'').toLowerCase()!==GRAPH_TENANT_ID||!Array.isArray(claims.roles)||!claims.roles.includes('Mail.Send'))
   return respond({ok:false,error:'mail_send_permission_missing'},503);
  const stats={accepted:0,failed:0,unknown:0,blocked:0};
  const worker=async()=>{
    for(let step=0;step<10;step++){
      if(Date.now()>=UNTIL)break;
      const row=await rpc('feedback_instructor_batch_claim_20261013');
      if(!row?.id)break;
      let status='failed',http:number|null=null,requestId:string|null=null,error:string|null=null;
      try{
       const addr=String(row.email||'').trim();const personal=String(row.token||'');
       if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)||!personal||personal.length<20)throw Error('invalid_recipient_or_token');
       const individual=new URL('feedback.html', 'https://taasiyeda2026.github.io/dashboard_system/');
       individual.searchParams.set('t',personal);
       const name=esc(plain(row.name));const program=esc(plain(row.program));
       const mail={
        subject:'משוב פתיחה לאחר הכשרה | '+plain(row.program),
        body:{contentType:'HTML',content:
         '<div dir="rtl" lang="he" style="font-family:Arial,sans-serif;font-size:15px;line-height:1.65;text-align:right">'+
         '<p>שלום '+name+',</p>'+
         '<p>בהמשך להכשרה לתוכנית <strong>'+program+'</strong>, נשמח לקבל את המשוב שלך על ההכשרה, החומרים ומידת המוכנות לקראת ההדרכה.</p>'+
         '<p>נודה לך על הקדשת מספר דקות למילוי המשוב האישי באמצעות הקישור הבא:</p>'+
         '<p><a href="'+esc(individual.href)+'">למילוי משוב הפתיחה לאחר הכשרה</a></p>'+
         '<p>תודה רבה על שיתוף הפעולה,<br>צוות תעשיידע</p></div>'},
        toRecipients:[{emailAddress:{address:addr}}]
       };
       const began=await rpc('feedback_instructor_batch_begin_20261013',{p_id:row.id,p_claim:row.claim_token});
       if(began!==true){stats.blocked++;continue;}
       let response:Response;
       try{
        response=await fetch('https://graph.microsoft.com/v1.0/users/'+encodeURIComponent(OFFICE)+'/sendMail',
         {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
          body:JSON.stringify({message:mail,saveToSentItems:true}),signal:AbortSignal.timeout(25000)});
        http=response.status;requestId=response.headers.get('request-id');
        status=response.status===202?'accepted':[400,401,403,404,413,422,429].includes(response.status)?'failed':'unknown';
        error=status==='accepted'?null:'graph_http_'+response.status;
       }catch{status='unknown';error='graph_response_uncertain';}
      }catch(e){
       status='failed';error='preflight_failed';
      }
      try{await rpc('feedback_instructor_batch_finish_20261013',{
        p_id:row.id,p_claim:row.claim_token,p_status:status,p_http:http,
        p_graph_request_id:requestId,p_error:error
      });}catch{status='unknown';}
      stats[status as 'accepted'|'failed'|'unknown']++;
    }
  };
  await Promise.all(Array.from({length:6},()=>worker()));
  return respond({ok:true,...stats});
 }catch{console.error('instructor feedback batch failed without personal details');return respond({ok:false,error:'batch_failed'},500);}
});

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { previewEligibility, summarizeCandidatePreview, israelClock } from './planner.mjs';
import { runAutomation, STAFF_FEEDBACK_SENDER, staffGraphCredentials, staffGraphTokenHasMailSend } from './delivery.mjs';

// Production activation approved on 2026-10-13. The DB control is the
// authoritative runtime on/off switch; Cron uses a Vault-stored shared secret.
// Microsoft Graph uses separate pinned credentials and Mail.Send permission.
const STAFF_SCHEDULER_SECRET_SHA256 = '5799221868b0bc9081f4d3cda7839928dd84c79d7b7680033f80283b471a93f4';
const reply = (data: unknown, code = 200) => new Response(JSON.stringify(data), {
 status: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }
});
const sha256 = async (text: string) =>
 [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
 .map((x) => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
 try {
   if (req.method !== 'POST') return reply({ok:false,error:'method_not_allowed'},405);
   const body = await req.json().catch(() => ({}));
   const action = body?.action || 'preview';
   if (!['preview','prepare','dispatch'].includes(action)) return reply({ok:false,error:'invalid_action'},400);
   const candidateSecret = req.headers.get('x-staff-dry-run-secret') || '';
   const legacySecret = Deno.env.get('FEEDBACK_STAFF_DRY_RUN_SECRET') || '';
   if (!candidateSecret) return reply({ok:false,error:'unauthorized'},401);
   const actualDigest = await sha256(candidateSecret);
   const legacyAuthorized = Boolean(legacySecret) && actualDigest === await sha256(legacySecret);
   // The scheduled job's random secret is kept only in Supabase Vault. Its
   // digest is safe to store in source; do not allow it to call preview.
   const cronAuthorized = action !== 'preview' && actualDigest === STAFF_SCHEDULER_SECRET_SHA256;
   if (!legacyAuthorized && !cronAuthorized) return reply({ok:false,error:'unauthorized'},401);

   const url = Deno.env.get('SUPABASE_URL');
   const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
   if (!url || !key) return reply({ok:false,error:'supabase_not_configured'},503);
   const asOf = new Date();
   const rpc = async (name: string, args: unknown) => {
     const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
       method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
       body:JSON.stringify(args),signal:AbortSignal.timeout(20000)
     });
     if (!response.ok) throw new Error(`rpc_http_${response.status}`);
     return response.json();
   };
   if (action !== 'preview') {
     let cachedToken: string | null = null;
     // Business requirement: staff feedback is always sent as office@think.org.il.
     // Never inherit a different sender from shared Microsoft Graph configuration.
     const sender = STAFF_FEEDBACK_SENDER;
     const getAccessToken = async () => {
       if (cachedToken) return cachedToken;
       // Do not use the shared MS_* app credentials belonging to other systems.
       const { tenant, client, secret } = staffGraphCredentials((name: string) => Deno.env.get(name));
       const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
         method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
         body:new URLSearchParams({client_id:client,client_secret:secret,
           scope:'https://graph.microsoft.com/.default',grant_type:'client_credentials'}),
         signal:AbortSignal.timeout(15000)
       });
       if (!response.ok) throw new Error('graph_token_failed');
       const token = (await response.json()).access_token;
       if (!token) throw new Error('graph_token_missing');
       if (!staffGraphTokenHasMailSend(String(token))) throw new Error('staff_graph_mail_send_not_granted');
       cachedToken = String(token);
       return cachedToken;
     };
     // Before preparing a batch, verify the Graph identity and Mail.Send role.
     // Missing credentials must NOT create pending mail that will fail at 08:00.
     if (action === 'prepare') await getAccessToken();
     return reply({ok:true,...await runAutomation({action,now:asOf,
       enabled:true,rpc,
       transport:{getAccessToken,baseUrl:Deno.env.get('FEEDBACK_STAFF_BASE_URL') ||
         'https://taasiyeda2026.github.io/dashboard_system/',
         send:(message: unknown, token: string) => fetch(
           `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
             method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
             body:JSON.stringify({message,saveToSentItems:true}),signal:AbortSignal.timeout(20000)
           })}
     })});
   }
   const response = await fetch(`${url}/rest/v1/rpc/feedback_staff_auto_candidates`, {
     method:'POST',headers: {
       'apikey':key,'Authorization':`Bearer ${key}`,
       'Content-Type':'application/json'
     },
     body:JSON.stringify({p_now:asOf.toISOString()})
   });
   if (!response.ok) throw new Error(`candidate_rpc_http_${response.status}`);
   const candidates = await response.json();
   if (!Array.isArray(candidates)) throw new Error('invalid_candidate_response');
   const activationAt = Deno.env.get('FEEDBACK_STAFF_ACTIVATION_AT') || undefined;
   const items = previewEligibility(candidates, {activationAt});
   // Do not expose names, emails, tokens or group members in external response/logs.
   return reply({ok:true,dry_run:true,mail_sent:0,outbox_written:0,
     israel:israelClock(asOf),staff_rows:candidates.length / 2,
     would_queue:items.filter((i) => i.status==='would_queue').length,
     by_stage_and_status:summarizeCandidatePreview(candidates,{activationAt}),
     note:'No scheduling or sending is enabled in simulation'});
 } catch (err) {
   // No personal data, recipient tokens, Graph credentials or upstream bodies.
   console.error('feedback-staff automation request failed');
   return reply({ok:false,error:'automation_failed'},500);
 }
});

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { previewEligibility, summarizeCandidatePreview, israelClock } from './planner.mjs';

// STAGE A: an authenticated preview. NO mail sender, NO queues, NO cron.
// Any deployment remains permanently non-sending until a separate approved rollout.
const reply = (data: unknown, code = 200) => new Response(JSON.stringify(data), {
 status: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }
});
const sha256 = async (text: string) =>
 [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
 .map((x) => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req: Request) => {
 try {
   if (req.method !== 'POST') return reply({ok:false,error:'method_not_allowed'},405);
   const secret = Deno.env.get('FEEDBACK_STAFF_DRY_RUN_SECRET') || '';
   const candidateSecret = req.headers.get('x-staff-dry-run-secret') || '';
   if (!secret || !candidateSecret
       || (await sha256(secret)) !== (await sha256(candidateSecret))) {
     return reply({ok:false,error:'unauthorized'},401);
   }

   // Explicitly disallow any side-effect requests during stage A.
   const body = await req.json().catch(() => ({}));
   if (body?.action && body.action !== 'preview') {
     return reply({ok:false,error:'dry_run_only'},403);
   }

   const url = Deno.env.get('SUPABASE_URL');
   const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
   if (!url || !key) return reply({ok:false,error:'supabase_not_configured'},503);
   const asOf = new Date();
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
   console.error('feedback-staff dry-run preview failed',err);
   return reply({ok:false,error:'preview_failed'},500);
 }
});

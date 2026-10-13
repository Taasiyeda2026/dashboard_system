-- Approved personalized school-staff email: send the selected contact's real name
-- to the message renderer. The email does not contain the school name.
-- This migration does NOT activate any automation, cron or delivery flag.
-- Keep every claim and duplicate-delivery guard unchanged.
create or replace function public.feedback_staff_auto_claim(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.feedback_staff_auto_outbox; c record; ctl public.feedback_staff_auto_control;
 link jsonb; claim uuid; result_status text;
begin
 select * into ctl from public.feedback_staff_auto_control where singleton;
 if not coalesce(ctl.enabled,false) or ctl.activation_at is null then return '{"disabled":true}'::jsonb; end if;
 if extract(hour from p_now at time zone 'Asia/Jerusalem')<>8 then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,805);
 -- A worker crash is never interpreted as permission to resend.
 for o in select * from public.feedback_staff_auto_outbox where status='sending'
   and claimed_at<p_now-interval '15 minutes' for update loop
   result_status:=case when o.graph_started_at is null then 'failed' else 'unknown' end;
   update public.feedback_staff_auto_outbox set status=result_status,last_error='worker_lost',updated_at=p_now where id=o.id;
   update public.feedback_staff_auto_attempts set result=result_status,error='worker_lost',finished_at=p_now where id=o.claim_token;
 end loop;
 for o in select * from public.feedback_staff_auto_outbox where status='pending' and send_after<=p_now
   order by send_after,id for update skip locked loop
   select * into c from public.feedback_staff_auto_candidates(p_now) where group_key=o.group_key and stage=o.stage;
   if not found or c.status<>'eligible' or c.eligibility_at<ctl.activation_at
     or private.feedback_staff_auto_snapshot(to_jsonb(c))<>o.snapshot then
     update public.feedback_staff_auto_outbox set status='cancelled',last_error='source_changed',updated_at=p_now where id=o.id;
     continue;
   end if;
   if exists(select 1 from public.feedback_staff_auto_outbox x where x.id<>o.id and x.stage=o.stage
     and x.member_row_ids && o.member_row_ids and x.status in ('accepted','sending','unknown')) then
     update public.feedback_staff_auto_outbox set status='needs_attention',last_error='overlapping_delivery',updated_at=p_now where id=o.id;
     continue;
   end if;
   link:=private.feedback_staff_auto_link(o,p_now);
   if link ? 'error' then
     update public.feedback_staff_auto_outbox set status='needs_attention',last_error=link->>'error',updated_at=p_now where id=o.id;
     continue;
   end if;
   claim:=gen_random_uuid();
   update public.feedback_staff_auto_outbox set status='sending',claim_token=claim,claimed_at=p_now,
     graph_started_at=null,attempts=attempts+1,campaign_id=(link->>'campaign_id')::uuid,
     recipient_id=(link->>'recipient_id')::uuid,updated_at=p_now where id=o.id;
   insert into public.feedback_staff_auto_attempts(id,outbox_id,attempt_no,recipient_email,contact_id,
     activity_row_id,started_at,result) values(claim,o.id,o.attempts+1,o.recipient_email,o.contact_id,o.activity_row_id,p_now,'sending');
   return jsonb_build_object('id',o.id,'claim_token',claim,'recipient_email',o.recipient_email,'stage',o.stage,
     'token',link->>'token','contact_name',
      coalesce((select cs.contact_name from public.contacts_schools cs where cs.id=o.contact_id),''),
      'program_title',
     (select title from public.feedback_programs where key=o.program_key));
 end loop;
 return '{}'::jsonb;
end $$;

-- Legacy accepted records referenced entire previously merged sets, including
-- activities starting in other weeks. Only an actually emailed representative
-- or an exact new stage/week group can prevent a new legitimate invite.
-- A new weekly cohort must not inherit an earlier week's sent state.
CREATE OR REPLACE FUNCTION public.feedback_staff_auto_prepare(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; ctl public.feedback_staff_auto_control; existing public.feedback_staff_auto_outbox;
 due timestamptz; n integer:=0;
begin
 select * into ctl from public.feedback_staff_auto_control where singleton;
 if not coalesce(ctl.enabled,false) or ctl.activation_at is null then return '{"disabled":true,"prepared":0}'::jsonb; end if;
 if extract(hour from p_now at time zone 'Asia/Jerusalem')<>7
    or extract(minute from p_now at time zone 'Asia/Jerusalem')<>59 then return '{"outside_window":true}'::jsonb; end if;
 perform pg_advisory_xact_lock(2027,805);
 due:=(((p_now at time zone 'Asia/Jerusalem')::date + time '08:00') at time zone 'Asia/Jerusalem');
 for c in select * from public.feedback_staff_auto_candidates(p_now)
   where status='eligible' and (eligibility_at>=ctl.activation_at or stage='pre') loop
   -- Accepted / ambiguous / in-flight deliveries block the entire merged row,
   -- including later renamed/split/merged groups sharing any historical member.
   if exists(select 1 from public.feedback_staff_auto_outbox o where o.stage=c.stage
     and (o.group_key=c.group_key or o.activity_row_id=any(c.member_row_ids))
     and o.status in ('accepted','unknown','sending')) then continue; end if;
   select * into existing from public.feedback_staff_auto_outbox o
     where o.stage=c.stage and o.group_key=c.group_key
     order by o.created_at limit 1 for update;
   if existing.id is not null then
     -- Recheck recoverable pre-send failures when source details are corrected.
     -- Never retry a failed or ambiguous delivery after a Graph attempt.
     if existing.status in ('failed','needs_attention') and existing.graph_started_at is not null then continue; end if;
     update public.feedback_staff_auto_outbox set
       group_key=c.group_key,activity_row_id=c.representative_row_id,
       member_row_ids=c.member_row_ids,
       program_key=c.program_key,contact_id=c.contact_id,recipient_email=c.contact_email,
       eligibility_at=c.eligibility_at,send_after=due,status='pending',last_error=null,
       snapshot=private.feedback_staff_auto_snapshot(to_jsonb(c)),updated_at=p_now
     where id=existing.id;
   else
     insert into public.feedback_staff_auto_outbox(group_key,stage,activity_row_id,member_row_ids,
       program_key,contact_id,recipient_email,eligibility_at,send_after,snapshot)
     values(c.group_key,c.stage,c.representative_row_id,c.member_row_ids,c.program_key,c.contact_id,
       c.contact_email,c.eligibility_at,due,private.feedback_staff_auto_snapshot(to_jsonb(c)));
   end if;
   n:=n+1;
 end loop;
 return jsonb_build_object('prepared',n,'send_after',due);
end $function$
;

CREATE OR REPLACE FUNCTION public.feedback_staff_auto_claim(p_now timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   if not found or c.status<>'eligible' or (c.eligibility_at<ctl.activation_at and o.stage<>'pre')
     or private.feedback_staff_auto_snapshot(to_jsonb(c))<>o.snapshot then
     update public.feedback_staff_auto_outbox set status='cancelled',last_error='source_changed',updated_at=p_now where id=o.id;
     continue;
   end if;
   if exists(select 1 from public.feedback_staff_auto_outbox x where x.id<>o.id and x.stage=o.stage
     and (x.group_key=o.group_key or x.activity_row_id=any(o.member_row_ids))
       and x.status in ('accepted','sending','unknown')) then
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
end $function$
;

CREATE OR REPLACE FUNCTION public.feedback_staff_auto_status()
 RETURNS TABLE(activity_row_id text, stage text, status text, reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not private.feedback_can_view_results() then raise exception 'feedback_forbidden' using errcode='42501'; end if;
 return query select c.representative_row_id,c.stage,
   case when o.status='accepted' then 'sent'
     when o.status='failed' then 'failed'
     when o.status in ('unknown','cancelled','needs_attention') then 'needs_attention'
     when c.status not in ('eligible','not_due','unscheduled') then 'needs_attention'
     when o.status in ('pending','sending') then 'pending'
     when c.status='eligible' and c.stage in ('pre','mid')
       and extract(isodow from now() at time zone 'Asia/Jerusalem')=4
       and extract(hour from now() at time zone 'Asia/Jerusalem')<8
       then 'scheduled'
     when c.status='eligible' then 'needs_attention' else 'not_due' end,
   case when o.id is not null then coalesce(o.last_error,o.status)
     when c.status='eligible' then 'automation_disabled_or_not_prepared' else c.status end
 from public.feedback_staff_auto_candidates(now()) c
 left join lateral(select x.* from public.feedback_staff_auto_outbox x where x.stage=c.stage
   and (x.group_key=c.group_key or x.activity_row_id=any(c.member_row_ids))
   order by case x.status when 'accepted' then 0 when 'unknown' then 1 when 'sending' then 2 else 3 end,x.updated_at desc limit 1) o on true;
end $function$
;

CREATE OR REPLACE FUNCTION public.feedback_staff_admin_schedule(p_activity_row_id text, p_stage text, p_send_on date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c record; v_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
 if not private.feedback_is_admin() then
   raise exception 'feedback_forbidden' using errcode='42501';
 end if;
 if p_stage not in ('pre','mid','final') then
   raise exception 'feedback_invalid_stage' using errcode='22023';
 end if;
 -- Serialize with the existing 08:00 delivery claim.
 perform pg_advisory_xact_lock(2027,805);
 select * into c from public.feedback_staff_auto_candidates(now()) k
 where p_activity_row_id=any(k.member_row_ids) and k.stage=p_stage limit 1;
 if not found then raise exception 'feedback_staff_group_not_found' using errcode='22023'; end if;
 if exists(select 1 from public.feedback_staff_auto_outbox o
   where o.stage=p_stage and (o.group_key=c.group_key or o.activity_row_id=any(c.member_row_ids))
   and o.status in ('accepted','sending','unknown')) then
   raise exception 'feedback_staff_already_dispatched' using errcode='22023';
 end if;
 if p_send_on is null then
   delete from public.feedback_staff_send_schedules where group_key=c.group_key and stage=p_stage;
   return jsonb_build_object('group_key',c.group_key,'stage',p_stage,'mode','automatic');
 end if;
 if p_send_on <= v_today or p_send_on > v_today+365 then
   raise exception 'feedback_invalid_future_date' using errcode='22023';
 end if;
 -- Opening invites use the weekly automatic cohort only (no out-of-window postponement).
 if p_stage='pre' then
   raise exception 'feedback_pre_weekly_automatic_only' using errcode='22023';
 end if;
 insert into public.feedback_staff_send_schedules(group_key,stage,send_on,created_by)
 values(c.group_key,p_stage,p_send_on,auth.uid())
 on conflict (group_key,stage) do update set send_on=excluded.send_on, updated_at=now(), created_by=auth.uid();
 -- An already prepared but not dispatched row must not bypass a postponement.
 update public.feedback_staff_auto_outbox o
 set send_after=greatest(o.send_after,(p_send_on + time '08:00') at time zone 'Asia/Jerusalem'),
     updated_at=now()
 where o.stage=p_stage
   and (o.group_key=c.group_key or o.activity_row_id=any(c.member_row_ids))
   and o.status='pending';
 return jsonb_build_object('group_key',c.group_key,'stage',p_stage,'send_on',p_send_on,'mode','scheduled');
end $function$
;
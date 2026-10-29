-- Keep the authorised staff mail status read only.
-- A weekly cohort eligible on Thursday before 08:00 is scheduled, not failed.
-- This only changes the display RPC; no mail is enqueued or dispatched.
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
   and (x.group_key=c.group_key or x.member_row_ids && c.member_row_ids)
   order by case x.status when 'accepted' then 0 when 'unknown' then 1 when 'sending' then 2 else 3 end,x.updated_at desc limit 1) o on true;
end $function$
;
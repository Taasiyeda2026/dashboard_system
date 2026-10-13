-- Activate already-deployed unified feedback planner only for newly earned eligibility.
-- Do not catch up on pre-activation student meetings or final-course dates.
-- Existing 43 instructor training emails are excluded by last_shared_at and absent pre requests.
do $body$
declare def text; src text := 'where a.eligible_at<=p_now'; dst text := 'where a.eligible_at<=p_now
     and a.eligible_at>=ctl.activated_at';
begin
 select pg_get_functiondef(p.oid) into def from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='feedback_auto_prepare';
 if def is null then raise exception 'feedback_auto_prepare_not_found'; end if;
 if position(dst in def)=0 then
   if position(src in def)=0 then raise exception 'eligibility_activation_guard_anchor_missing'; end if;
   def:=replace(def,src,dst);
   execute def;
 end if;
end $body$;

-- Keep the existing staff scheduler untouched. All delivery cron tasks use its
-- existing Vault secret; never embed credentials in a migration or repository.
select cron.schedule('feedback-auto-daily-prepare','30 * * * *',$cron$
select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json',
   'x-staff-dry-run-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"daily_prepare"}'::jsonb,timeout_milliseconds:=120000
) where extract(hour from now() at time zone 'Asia/Jerusalem')=5
  and extract(minute from now() at time zone 'Asia/Jerusalem')=30
  and exists(select 1 from public.feedback_auto_control where singleton and enabled)
$cron$);

select cron.schedule('feedback-auto-daily-dispatch','* * * * *',$cron$
select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json',
   'x-staff-dry-run-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"daily_dispatch"}'::jsonb,timeout_milliseconds:=120000
) where (now() at time zone 'Asia/Jerusalem')::time >=time '09:15'
  and (now() at time zone 'Asia/Jerusalem')::time <time '09:45'
  and exists(select 1 from public.feedback_auto_control where singleton and enabled)
  and exists(select 1 from public.feedback_auto_delivery where status='pending'
    and send_after<=now() and audience in ('student','instructor')
    and not(audience='instructor' and stage='pre'))
$cron$);

-- Explicitly scheduled training feedback is dispatched separately and never
-- inherits the student/final daily schedule.
select cron.schedule('feedback-auto-instructor-training','* * * * *',$cron$
select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json',
   'x-staff-dry-run-secret',(select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"manual"}'::jsonb,timeout_milliseconds:=120000
) where exists(select 1 from public.feedback_auto_control where singleton and enabled)
  and exists(
     select 1 from public.feedback_auto_pre_requests req
     where req.status='scheduled' and req.send_at<=now()
       and not exists (
         select 1 from public.feedback_campaigns c
         join public.feedback_recipients r on r.campaign_id=c.id
         where c.audience='instructor' and c.stage='pre'
           and c.program_key=req.program_key and c.academic_year=req.academic_year
           and c.instructor_emp_id=req.instructor_emp_id
           and (r.last_shared_at is not null or r.completed_at is not null)
       )
  )
$cron$);

update public.feedback_auto_control
set enabled=true,activated_at=coalesce(activated_at,now())
where singleton and not enabled;

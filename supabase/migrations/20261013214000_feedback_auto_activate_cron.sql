
-- Installed only after DB rollback tests and GitHub CI pass.
-- pg_cron uses UTC system time, so gate actual execution by Asia/Jerusalem clock.
-- Do not modify existing 05:00/08:00 educational-staff schedules.

select cron.schedule('feedback-auto-daily-prepare','30 * * * *',$cron$
 select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','x-staff-dry-run-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"daily_prepare"}'::jsonb,timeout_milliseconds:=120000
 )
 where extract(hour from now() at time zone 'Asia/Jerusalem')=5
 and (select enabled from public.feedback_auto_control where singleton)
$cron$);

select cron.schedule('feedback-auto-daily-dispatch','* * * * *',$cron$
 select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','x-staff-dry-run-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"daily_dispatch"}'::jsonb,timeout_milliseconds:=120000
 )
 where extract(hour from now() at time zone 'Asia/Jerusalem')=9
   and extract(minute from now() at time zone 'Asia/Jerusalem') between 15 and 44
   and (select enabled from public.feedback_auto_control where singleton)
   and exists(select 1 from public.feedback_auto_delivery d
     where d.status='pending' and d.send_after<=now()
       and not(d.audience='instructor' and d.stage='pre'))
$cron$);

select cron.schedule('feedback-auto-manual-pre','* * * * *',$cron$
 select net.http_post(
  url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-auto-delivery',
  headers:=jsonb_build_object('Content-Type','application/json','x-staff-dry-run-secret',
      (select decrypted_secret from vault.decrypted_secrets where name='feedback_staff_automation_secret')),
  body:='{"action":"manual"}'::jsonb,timeout_milliseconds:=120000
 )
 where (select enabled from public.feedback_auto_control where singleton)
 and (
  exists(select 1 from public.feedback_auto_delivery d where d.status='pending'
   and d.audience='instructor' and d.stage='pre' and d.send_after<=now())
  or exists(
   select 1 from public.feedback_auto_pre_requests r
   where r.status='scheduled' and r.send_at<=now()
     and r.send_at>=now()-interval '14 days'
     and not exists (
       select 1 from public.feedback_auto_delivery d
       where d.delivery_key='instructor:pre:'||r.program_key||':'||r.instructor_emp_id
         and d.status in ('accepted','claimed','sending','unknown','failed','needs_attention')
     )
  )
 )
$cron$);

update public.feedback_auto_control set enabled=true,activated_at=now()
where singleton and enabled=false;

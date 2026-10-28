-- Every 14 days, Thursday 08:30 Asia/Jerusalem, starting 2026-11-12.
-- The separate first dispatch was requested for Wednesday 2026-10-28.
-- DST-safe: schedule both candidate UTC hours, and only one local 08:30 passes.
select cron.schedule(
 'feedback-expiry-weekly-managers',
 '30 5,6 * * 4',
 $job$
 select net.http_post(
   url:='https://szinlhjuwyiyszdpsdop.supabase.co/functions/v1/feedback-expiry-weekly',
   headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-staff-dry-run-secret',(
        select decrypted_secret from vault.decrypted_secrets
        where name='feedback_staff_automation_secret'
      )
   ),
   body:='{"action":"scheduled"}'::jsonb,
   timeout_milliseconds:=120000
 )
 where (now() at time zone 'Asia/Jerusalem')::time >= time '08:30:00'
   and (now() at time zone 'Asia/Jerusalem')::time < time '08:31:00'
   and (now() at time zone 'Asia/Jerusalem')::date >= date '2026-11-12'
   and mod(((now() at time zone 'Asia/Jerusalem')::date-date '2026-11-12'),14)=0
 $job$
);
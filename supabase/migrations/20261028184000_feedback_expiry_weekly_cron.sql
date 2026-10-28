-- Weekly Sunday 08:30 Israel time; UTC 05:30 in summer, 06:30 in winter.
select cron.schedule(
 'feedback-expiry-weekly-managers',
 '30 5,6 * * 0',
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
   body:='{"action":"weekly"}'::jsonb,
   timeout_milliseconds:=120000
 )
 where extract(isodow from (now() at time zone 'Asia/Jerusalem'))=7
   and (now() at time zone 'Asia/Jerusalem')::time >= time '08:30:00'
   and (now() at time zone 'Asia/Jerusalem')::time < time '08:31:00'
 $job$
);
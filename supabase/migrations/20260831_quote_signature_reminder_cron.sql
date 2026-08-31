-- Hourly reminder for pending quote signatures.
-- The Edge Function performs the Asia/Jerusalem 09:00-16:00 time-window check.
-- Runtime credentials are stored in Supabase Vault and are intentionally not committed.

DO $$
DECLARE
  existing_job record;
BEGIN
  FOR existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'quote-signature-reminder-hourly'
  LOOP
    PERFORM cron.unschedule(existing_job.jobid);
  END LOOP;
END
$$;

SELECT cron.schedule(
  'quote-signature-reminder-hourly',
  '0 * * * *',
  $cron$
    SELECT net.http_post(
      url := (
        SELECT decrypted_secret
        FROM vault.decrypted_secrets
        WHERE name = 'quote_signature_reminder_project_url'
        LIMIT 1
      ) || '/functions/v1/quote-signature-reminder',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'quote_signature_reminder_anon_key'
          LIMIT 1
        ),
        'x-cron-secret', (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'quote_signature_reminder_cron_secret'
          LIMIT 1
        )
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'scheduled_at', now()
      )
    );
  $cron$
);

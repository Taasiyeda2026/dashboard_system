-- Keep only 14 days of completed pg_cron run history.
-- Production cleanup on 2026-10-25 removed 39,915 completed run rows older than 14 days.
-- All previous cron.job definitions and incomplete/running runs are preserved.
-- Cron timezone is GMT; at 00:10 UTC in summer and 01:10 UTC in winter,
-- 03:10 Asia/Jerusalem is reached exactly once. The SQL condition is DST-safe.
--
-- This is idempotent because the schedule was first installed directly on
-- the production project as a Supabase migration.
DO $cron_history_retention$
DECLARE
  existing_job record;
BEGIN
  SELECT jobid,schedule,active,command INTO existing_job
  FROM cron.job WHERE jobname='cron-history-retention-14d';
  IF NOT FOUND THEN
    PERFORM cron.schedule(
      'cron-history-retention-14d',
      '10 0,1 * * *',
      $job$
        DELETE FROM cron.job_run_details
        WHERE end_time < now() - interval '14 days'
          AND extract(hour FROM clock_timestamp() AT TIME ZONE 'Asia/Jerusalem') = 3;
      $job$
    );
  ELSIF existing_job.schedule <> '10 0,1 * * *'
     OR existing_job.active IS DISTINCT FROM true
     OR position('end_time < now() - interval ''14 days''' in existing_job.command)=0
     OR position('Asia/Jerusalem' in existing_job.command)=0
  THEN
    RAISE EXCEPTION 'Existing cron-history-retention-14d job differs from intended settings';
  END IF;
END
$cron_history_retention$;

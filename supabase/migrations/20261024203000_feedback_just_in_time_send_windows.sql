-- Align preparation with feedback delivery while preserving existing send hours.
-- Staff: prepare 07:59, dispatch from 08:00, Israel local time.
-- Students and instructor final feedback: prepare 09:14, dispatch 09:15-09:45.
-- Cron runs in GMT; duplicate UTC hours cover both Israeli DST offsets.
-- SQL guards check Asia/Jerusalem and allow only the desired local window.
-- All updates are idempotent to account for projects already updated in production.
DO $body$
DECLARE
  def text;
  cmd text;
  jid bigint;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_auto_prepare';
  IF def IS NULL THEN RAISE EXCEPTION 'feedback_auto_prepare missing'; END IF;
  IF position('extract(hour from p_now at time zone ''Asia/Jerusalem'')<>5' IN def)>0 THEN
    IF position('extract(minute from p_now at time zone ''Asia/Jerusalem'')<>30' IN def)=0
    THEN RAISE EXCEPTION 'Unexpected general feedback minute gate'; END IF;
    def:=replace(def,'extract(hour from p_now at time zone ''Asia/Jerusalem'')<>5',
      'extract(hour from p_now at time zone ''Asia/Jerusalem'')<>9');
    def:=replace(def,'extract(minute from p_now at time zone ''Asia/Jerusalem'')<>30',
      'extract(minute from p_now at time zone ''Asia/Jerusalem'')<>14');
    EXECUTE def;
  ELSIF position('extract(hour from p_now at time zone ''Asia/Jerusalem'')<>9' IN def)=0
     OR position('extract(minute from p_now at time zone ''Asia/Jerusalem'')<>14' IN def)=0
  THEN RAISE EXCEPTION 'Unexpected general feedback prepare function'; END IF;

  SELECT pg_get_functiondef(p.oid) INTO def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='feedback_staff_auto_prepare';
  IF def IS NULL THEN RAISE EXCEPTION 'feedback_staff_auto_prepare missing'; END IF;
  IF position('if extract(hour from p_now at time zone ''Asia/Jerusalem'')<>5 then' IN def)>0 THEN
    def:=replace(def,
      'if extract(hour from p_now at time zone ''Asia/Jerusalem'')<>5 then',
      'if extract(hour from p_now at time zone ''Asia/Jerusalem'')<>7 or extract(minute from p_now at time zone ''Asia/Jerusalem'')<>59 then');
    EXECUTE def;
  ELSIF position('extract(hour from p_now at time zone ''Asia/Jerusalem'')<>7' IN def)=0
     OR position('extract(minute from p_now at time zone ''Asia/Jerusalem'')<>59' IN def)=0
  THEN RAISE EXCEPTION 'Unexpected staff feedback prepare function'; END IF;

  SELECT jobid,command INTO jid,cmd FROM cron.job WHERE jobname='feedback-staff-prepare';
  IF jid IS NULL THEN RAISE EXCEPTION 'Staff prepare cron missing'; END IF;
  IF position('extract(hour from now() at time zone ''Asia/Jerusalem'')=5' IN cmd)>0 THEN
    cmd:=replace(cmd,
      'extract(hour from now() at time zone ''Asia/Jerusalem'')=5',
      'extract(hour from now() at time zone ''Asia/Jerusalem'')=7 and extract(minute from now() at time zone ''Asia/Jerusalem'')=59');
  ELSIF position('extract(hour from now() at time zone ''Asia/Jerusalem'')=7' IN cmd)=0
  THEN RAISE EXCEPTION 'Unexpected staff prepare cron gate'; END IF;
  PERFORM cron.alter_job(job_id:=jid,schedule:='59 4,5 * * *',command:=cmd);

  SELECT jobid INTO jid FROM cron.job WHERE jobname='feedback-staff-dispatch';
  IF jid IS NULL THEN RAISE EXCEPTION 'Staff dispatch cron missing'; END IF;
  PERFORM cron.alter_job(job_id:=jid,schedule:='*/5 5,6 * * *');

  SELECT jobid,command INTO jid,cmd FROM cron.job WHERE jobname='feedback-auto-daily-prepare';
  IF jid IS NULL THEN RAISE EXCEPTION 'General feedback prepare cron missing'; END IF;
  IF position('extract(hour from now() at time zone ''Asia/Jerusalem'')=5' IN cmd)>0 THEN
    IF position('extract(minute from now() at time zone ''Asia/Jerusalem'')=30' IN cmd)=0
    THEN RAISE EXCEPTION 'Unexpected general prepare cron minute'; END IF;
    cmd:=replace(cmd,
      'extract(hour from now() at time zone ''Asia/Jerusalem'')=5',
      'extract(hour from now() at time zone ''Asia/Jerusalem'')=9');
    cmd:=replace(cmd,
      'extract(minute from now() at time zone ''Asia/Jerusalem'')=30',
      'extract(minute from now() at time zone ''Asia/Jerusalem'')=14');
  ELSIF position('extract(hour from now() at time zone ''Asia/Jerusalem'')=9' IN cmd)=0
     OR position('extract(minute from now() at time zone ''Asia/Jerusalem'')=14' IN cmd)=0
  THEN RAISE EXCEPTION 'Unexpected general prepare cron gate'; END IF;
  PERFORM cron.alter_job(job_id:=jid,schedule:='14 6,7 * * *',command:=cmd);

  SELECT jobid INTO jid FROM cron.job WHERE jobname='feedback-auto-daily-dispatch';
  IF jid IS NULL THEN RAISE EXCEPTION 'General feedback dispatch cron missing'; END IF;
  PERFORM cron.alter_job(job_id:=jid,schedule:='15-44 6,7 * * *');
END
$body$;

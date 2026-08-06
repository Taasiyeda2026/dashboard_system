-- Fix: trg_activities_sync_end_date_from_meetings calls
-- activities_calculated_end_date_from_meetings() which uses btrim() on date-type columns
-- (date_1..date_35). btrim(date) does not exist in PostgreSQL → server error on any
-- UPDATE to public.activities that includes date fields (e.g. saving from exceptions screen).
--
-- A correct trigger already exists: trg_sync_activity_end_date →
-- public.sync_activity_end_date() which computes max(date_1..date_35) properly.
--
-- Fix: drop the broken trigger. The correct one remains and handles end-date calculation.

DROP TRIGGER IF EXISTS trg_activities_sync_end_date_from_meetings ON public.activities;

-- Verify (run manually after applying):
-- SELECT tgname, pg_get_triggerdef(t.oid) AS def
-- FROM pg_trigger t
-- JOIN pg_class c ON c.oid = t.tgrelid
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relname = 'activities'
--   AND NOT t.tgisinternal
-- ORDER BY tgname;
--
-- Expected: trg_activities_sync_end_date_from_meetings NOT present,
--           trg_sync_activity_end_date IS present.

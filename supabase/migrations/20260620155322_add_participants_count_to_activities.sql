-- Restored from supabase/migrations/20260620_activities_participants_count.sql (stable commit 2c772f83).
-- Original migration version prefix: 20260620

-- Combined migration section from: 20260620_activities_participants_count.sql
-- Original migration version prefix: 20260620
-- ============================================================

alter table public.activities add column if not exists participants_count integer null;

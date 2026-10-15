-- Ensure a school-year scheduling activity cannot silently inherit Hebrew.
-- Applied live on 2026-10-15; this migration is intentionally idempotent.
-- Per-school language discrepancies require separate human verification.
ALTER TABLE public.activities ALTER COLUMN instruction_language DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.activities'::regclass
      AND conname = 'activities_school_2027_explicit_language_required'
  ) THEN
    ALTER TABLE public.activities
      ADD CONSTRAINT activities_school_2027_explicit_language_required
      CHECK (
        activity_season IS DISTINCT FROM 'school_2027'
        OR coalesce(instruction_language, '') IN ('he', 'ar')
      );
  END IF;
END
$$;

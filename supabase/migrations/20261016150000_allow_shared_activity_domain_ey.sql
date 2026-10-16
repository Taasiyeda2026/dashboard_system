-- 2027 activities may belong to both E and Y domains.
-- Proposal routing remains independent and continues to use E/Y only.
ALTER TABLE public.activities
  DROP CONSTRAINT IF EXISTS activities_activity_domain_check;
ALTER TABLE public.activities
  ADD CONSTRAINT activities_activity_domain_check
  CHECK (activity_domain IS NULL OR activity_domain IN ('E', 'Y', 'EY'));

-- Rename proposal domain values: A → Y, N → E.

BEGIN;

-- 1. Verify counts before update
-- SELECT proposal_domain, count(*) FROM public.proposals_agreements GROUP BY proposal_domain;

-- 2. Drop existing check constraint (allows A/N) before updating values
ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_proposal_domain_check;

-- 3. Update existing data
UPDATE public.proposals_agreements SET proposal_domain = 'Y' WHERE proposal_domain = 'A';
UPDATE public.proposals_agreements SET proposal_domain = 'E' WHERE proposal_domain = 'N';

-- 4. Update column default
ALTER TABLE public.proposals_agreements
  ALTER COLUMN proposal_domain SET DEFAULT 'Y';

-- 5. Normalise any stale / unexpected values to 'Y'
UPDATE public.proposals_agreements
SET proposal_domain = 'Y'
WHERE proposal_domain NOT IN ('Y', 'E');

-- 6. Add new check constraint
ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_proposal_domain_check
  CHECK (proposal_domain IN ('Y', 'E'));

COMMIT;

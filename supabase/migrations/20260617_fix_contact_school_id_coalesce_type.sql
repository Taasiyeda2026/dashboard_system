-- Fix: COALESCE types bigint and uuid cannot be matched
--
-- Root cause: proposals_agreements.contact_school_id was created as uuid
-- but contacts_schools.id is bigint. The proposals_agreements_directory_view
-- had a COALESCE between these two incompatible types.
--
-- Fix:
--   1. Ensure contacts_schools has authority_id uuid, school_id uuid, semel_mosad text
--   2. Change proposals_agreements.contact_school_id from uuid to bigint
--   3. Drop and recreate proposals_agreements_directory_view without type conflicts

-- ── 1. Add missing catalog-linkage columns to contacts_schools ────────────────

ALTER TABLE public.contacts_schools
  ADD COLUMN IF NOT EXISTS authority_id uuid,
  ADD COLUMN IF NOT EXISTS school_id   uuid,
  ADD COLUMN IF NOT EXISTS semel_mosad text;

-- ── 2. Fix contact_school_id column type on proposals_agreements ──────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'proposals_agreements'
      AND column_name  = 'contact_school_id'
      AND data_type    = 'uuid'
  ) THEN
    -- Column exists as uuid — convert to bigint (existing uuid values cannot be
    -- cast to bigint, so we reset them to NULL; the ensure_contact_school RPC
    -- will re-populate on the next save).
    ALTER TABLE public.proposals_agreements
      ALTER COLUMN contact_school_id TYPE bigint USING NULL;
    RAISE NOTICE 'contact_school_id: changed from uuid to bigint';

  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'proposals_agreements'
      AND column_name  = 'contact_school_id'
  ) THEN
    ALTER TABLE public.proposals_agreements
      ADD COLUMN contact_school_id bigint;
    RAISE NOTICE 'contact_school_id: added as bigint';

  ELSE
    RAISE NOTICE 'contact_school_id: already correct type — no change';
  END IF;
END $$;

-- ── 3. Recreate proposals_agreements_directory_view ───────────────────────────
-- Drop chain: outer view first, then inner view (if the 20260616 migration
-- had renamed the base view).

DROP VIEW IF EXISTS public.proposals_agreements_directory_view CASCADE;
DROP VIEW IF EXISTS public.proposals_agreements_directory_view_without_signature_meta_20260616 CASCADE;

CREATE VIEW public.proposals_agreements_directory_view AS
SELECT
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  COALESCE(a.authority_name, cs.authority, pa.client_authority)    AS authority_name,
  pa.client_authority                                               AS legacy_client_authority,
  cs.client_type                                                    AS contact_client_type,
  cs.client_name                                                    AS contact_client_name,
  COALESCE(s.school_name, cs.school, pa.school_framework)          AS school_name,
  pa.school_framework                                               AS legacy_school_framework,
  pa.document_type,
  pa.activity_type_group,
  pa.proposal_date,
  pa.activity_names,
  pa.contact_name,
  pa.contact_role,
  pa.phone,
  pa.email,
  pa.notes,
  pa.status,
  pa.approval_note,
  pa.total_amount,
  pa.custom_document_sections,
  pa.include_catalog,
  pa.signature_meta,
  pa.approved_by,
  pa.approved_at,
  pa.created_at,
  pa.updated_at
FROM public.proposals_agreements pa
LEFT JOIN public.authorities     a  ON a.id  = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools          s  ON s.id  = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;

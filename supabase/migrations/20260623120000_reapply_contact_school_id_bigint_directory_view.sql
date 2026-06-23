-- Re-apply the focused DB fix for:
--   COALESCE types bigint and uuid cannot be matched
--
-- The active database must have proposals_agreements.contact_school_id as bigint
-- because it references contacts_schools.id (bigint).  Any previous uuid values
-- are legacy invalid references and cannot be cast to bigint, so they are reset
-- to NULL during the type correction.

ALTER TABLE public.contacts_schools
  ADD COLUMN IF NOT EXISTS authority_id uuid,
  ADD COLUMN IF NOT EXISTS school_id uuid,
  ADD COLUMN IF NOT EXISTS semel_mosad text;

-- Drop the directory view chain before changing the column type so a stale view
-- cannot keep a uuid-typed contact_school_id dependency alive.
DROP VIEW IF EXISTS public.proposals_agreements_directory_view CASCADE;
DROP VIEW IF EXISTS public.proposals_agreements_directory_view_without_signature_meta_20260616 CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'contact_school_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE public.proposals_agreements
      ALTER COLUMN contact_school_id DROP DEFAULT,
      ALTER COLUMN contact_school_id TYPE bigint USING NULL;

    RAISE NOTICE 'proposals_agreements.contact_school_id changed from uuid to bigint and legacy uuid values reset to NULL';

  ELSIF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'contact_school_id'
  ) THEN
    ALTER TABLE public.proposals_agreements
      ADD COLUMN contact_school_id bigint;

    RAISE NOTICE 'proposals_agreements.contact_school_id added as bigint';

  ELSE
    RAISE NOTICE 'proposals_agreements.contact_school_id already exists; no type conversion applied';
  END IF;
END $$;

DO $$
DECLARE
  v_contact_school_type text;
  v_contacts_schools_id_type text;
BEGIN
  SELECT data_type INTO v_contact_school_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'proposals_agreements'
    AND column_name = 'contact_school_id';

  SELECT data_type INTO v_contacts_schools_id_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'contacts_schools'
    AND column_name = 'id';

  IF v_contact_school_type IS DISTINCT FROM 'bigint'
     OR v_contacts_schools_id_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION
      'Expected proposals_agreements.contact_school_id and contacts_schools.id to be bigint, got % and %',
      v_contact_school_type,
      v_contacts_schools_id_type;
  END IF;
END $$;

CREATE VIEW public.proposals_agreements_directory_view AS
SELECT
  pa.id,
  pa.authority_id,
  a.authority_code,
  pa.school_id,
  pa.contact_school_id,
  COALESCE(a.authority_name, cs.authority, pa.client_authority) AS authority_name,
  pa.client_authority AS legacy_client_authority,
  cs.client_type AS contact_client_type,
  cs.client_name AS contact_client_name,
  COALESCE(s.school_name, cs.school, pa.school_framework) AS school_name,
  pa.school_framework AS legacy_school_framework,
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
LEFT JOIN public.authorities a ON a.id = pa.authority_id
LEFT JOIN public.contacts_schools cs ON cs.id = pa.contact_school_id
LEFT JOIN public.schools s ON s.id = pa.school_id;

GRANT SELECT ON public.proposals_agreements_directory_view TO authenticated;

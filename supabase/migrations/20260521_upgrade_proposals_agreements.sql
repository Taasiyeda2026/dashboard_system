-- Upgrade proposals_agreements: align column names with API and add status/workflow fields.
-- Assumes 20260518_create_proposals_agreements.sql has already been applied.

-- 1. Rename activity_type → activity_type_group when the rename has not yet been done.
DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped activity_type rename';

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type_group'
  ) THEN
    ALTER TABLE public.proposals_agreements
      RENAME COLUMN activity_type TO activity_type_group;

    ALTER TABLE public.proposals_agreements
      DROP CONSTRAINT IF EXISTS proposals_agreements_activity_type_not_blank;

    ALTER TABLE public.proposals_agreements
      DROP CONSTRAINT IF EXISTS proposals_agreements_activity_type_group_not_blank;

    ALTER TABLE public.proposals_agreements
      ADD CONSTRAINT proposals_agreements_activity_type_group_not_blank
        CHECK (btrim(activity_type_group) <> '') NOT VALID;

    RAISE NOTICE 'Renamed activity_type to activity_type_group';
  ELSE
    RAISE NOTICE 'activity_type rename already done or not needed — skipped';
  END IF;
END $$;


-- 2. Rename contact_phone → phone.
DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped phone rename';

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'contact_phone'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.proposals_agreements
      RENAME COLUMN contact_phone TO phone;

    RAISE NOTICE 'Renamed contact_phone to phone';
  ELSE
    RAISE NOTICE 'phone rename already done or not needed — skipped';
  END IF;
END $$;


-- 3. Rename contact_email → email.
DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped email rename';

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'contact_email'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'email'
  ) THEN
    ALTER TABLE public.proposals_agreements
      RENAME COLUMN contact_email TO email;

    RAISE NOTICE 'Renamed contact_email to email';
  ELSE
    RAISE NOTICE 'email rename already done or not needed — skipped';
  END IF;
END $$;


-- 4. Add proposal_date and activity_names.
ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS proposal_date date,
  ADD COLUMN IF NOT EXISTS activity_names jsonb NOT NULL DEFAULT '[]'::jsonb;


-- 5. Add status and workflow audit fields.
ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS quote_number text,
  ADD COLUMN IF NOT EXISTS total_amount numeric,
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS contact_id uuid,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_note text NOT NULL DEFAULT '';


-- 6. Status check constraint.
ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_status_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_status_check
    CHECK (status IN ('draft', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled')) NOT VALID;


-- 7. Indexes for the new filterable columns.
CREATE INDEX IF NOT EXISTS proposals_agreements_status_idx
  ON public.proposals_agreements (status);

CREATE INDEX IF NOT EXISTS proposals_agreements_proposal_date_idx
  ON public.proposals_agreements (proposal_date);

CREATE INDEX IF NOT EXISTS proposals_agreements_quote_number_idx
  ON public.proposals_agreements (quote_number);


-- 8. Recreate sort indexes safely.
-- activity_type was renamed to activity_type_group. Some preview databases may already have only the new column.
DROP INDEX IF EXISTS proposals_agreements_default_sort_idx;
DROP INDEX IF EXISTS proposals_agreements_activity_type_idx;
DROP INDEX IF EXISTS proposals_agreements_activity_type_group_idx;

DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped proposal indexes';

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type_group'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS proposals_agreements_default_sort_idx
      ON public.proposals_agreements (
        client_authority,
        school_framework,
        document_type,
        activity_type_group
      )
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS proposals_agreements_activity_type_group_idx
      ON public.proposals_agreements (activity_type_group)
    ';

    RAISE NOTICE 'Created proposals_agreements indexes with activity_type_group';

  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type'
  ) THEN
    EXECUTE '
      CREATE INDEX IF NOT EXISTS proposals_agreements_default_sort_idx
      ON public.proposals_agreements (
        client_authority,
        school_framework,
        document_type,
        activity_type
      )
    ';

    EXECUTE '
      CREATE INDEX IF NOT EXISTS proposals_agreements_activity_type_idx
      ON public.proposals_agreements (activity_type)
    ';

    RAISE NOTICE 'Created proposals_agreements indexes with legacy activity_type';

  ELSE
    RAISE NOTICE 'Neither activity_type_group nor activity_type exists — skipped proposal sort indexes';
  END IF;
END $$;


-- 9. proposal_agreement_items: future line-item table.
CREATE TABLE IF NOT EXISTS public.proposal_agreement_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_agreement_id uuid NOT NULL REFERENCES public.proposals_agreements(id) ON DELETE CASCADE,
  item_name             text NOT NULL,
  item_type             text NOT NULL DEFAULT '',
  gefen_number          text NOT NULL DEFAULT '',
  meetings_count        numeric,
  hours_count           numeric,
  quantity              numeric NOT NULL DEFAULT 1,
  unit_price            numeric,
  total_price           numeric,
  description           text NOT NULL DEFAULT '',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_agreement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS proposal_agreement_items_select ON public.proposal_agreement_items;
DROP POLICY IF EXISTS proposal_agreement_items_insert ON public.proposal_agreement_items;
DROP POLICY IF EXISTS proposal_agreement_items_update ON public.proposal_agreement_items;

CREATE POLICY proposal_agreement_items_select
  ON public.proposal_agreement_items
  FOR SELECT
  TO authenticated
  USING (public.app_can_use_proposals_agreements());

CREATE POLICY proposal_agreement_items_insert
  ON public.proposal_agreement_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.app_can_use_proposals_agreements());

CREATE POLICY proposal_agreement_items_update
  ON public.proposal_agreement_items
  FOR UPDATE
  TO authenticated
  USING (public.app_can_use_proposals_agreements())
  WITH CHECK (public.app_can_use_proposals_agreements());

REVOKE ALL ON public.proposal_agreement_items FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.proposal_agreement_items TO authenticated;
REVOKE DELETE ON public.proposal_agreement_items FROM authenticated;


-- updated_at trigger for proposal_agreement_items.
CREATE OR REPLACE FUNCTION public.touch_proposal_agreement_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_proposal_agreement_items_updated_at ON public.proposal_agreement_items;

CREATE TRIGGER trg_touch_proposal_agreement_items_updated_at
BEFORE UPDATE ON public.proposal_agreement_items
FOR EACH ROW
EXECUTE FUNCTION public.touch_proposal_agreement_items_updated_at();
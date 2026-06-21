-- ============================================================
-- Combined migration section from: 20260616_next_year_template_name_programs.sql
-- Original migration version prefix: 20260616
-- ============================================================

-- next_year proposal document title: "קורסי" → "תוכניות"
DO $$
BEGIN
  IF to_regclass('public.proposal_template_sections') IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposal_template_sections'
      AND column_name = 'updated_at'
  ) THEN
    UPDATE public.proposal_template_sections
    SET template_name = 'הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז',
        updated_at = now()
    WHERE template_key = 'next_year';
  ELSE
    UPDATE public.proposal_template_sections
    SET template_name = 'הצעת מחיר לתוכניות תעשיידע | שנת הלימודים תשפ״ז'
    WHERE template_key = 'next_year';
  END IF;
END $$;


-- ============================================================
-- Combined migration section from: 20260616_proposals_agreements_approval_guard.sql
-- Original migration version prefix: 20260616
-- ============================================================

-- Enforce proposal/agreement approval permissions at the database layer.
-- UI checks are not sufficient because the frontend talks directly to Supabase.

alter table public.users
  add column if not exists approve_proposals_agreements boolean;

create or replace function public.app_can_approve_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_current_role() = 'admin'
    or public.app_has_permission('approve_proposals_agreements'),
    false
  )
$$;

revoke all on function public.app_can_approve_proposals_agreements() from public;
grant execute on function public.app_can_approve_proposals_agreements() to authenticated;

create or replace function public.guard_proposals_agreements_approval_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.app_can_approve_proposals_agreements() and (
    new.status = 'approved'
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.signature_meta is distinct from old.signature_meta
  ) then
    raise exception 'proposals_agreements_approval_forbidden'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_proposals_agreements_approval_update() from public;

drop trigger if exists trg_guard_proposals_agreements_approval_update on public.proposals_agreements;
create trigger trg_guard_proposals_agreements_approval_update
before update on public.proposals_agreements
for each row
execute function public.guard_proposals_agreements_approval_update();


-- ============================================================
-- Combined migration section from: 20260616_proposals_agreements_directory_view_signature_meta.sql
-- Original migration version prefix: 20260616
-- ============================================================

-- Keep proposals_agreements_directory_view aligned with the fields selected by the proposals screen.
-- signature_meta is stored on the source proposals_agreements row and is required to render
-- the saved approval signature placement for approved proposals/agreements.
do $$
begin
  if to_regclass('public.proposals_agreements_directory_view') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'proposals_agreements_directory_view'
         and column_name = 'signature_meta'
     ) then
    drop view if exists public.proposals_agreements_directory_view_without_signature_meta_20260616;

    alter view public.proposals_agreements_directory_view
      rename to proposals_agreements_directory_view_without_signature_meta_20260616;

    create view public.proposals_agreements_directory_view as
      select
        directory_row.*,
        coalesce(pa.signature_meta, '{}'::jsonb) as signature_meta
      from public.proposals_agreements_directory_view_without_signature_meta_20260616 directory_row
      left join public.proposals_agreements pa on pa.id = directory_row.id;

    grant select on public.proposals_agreements_directory_view to authenticated;
  end if;
end $$;


-- ============================================================
-- Combined migration section from: 20260616_proposals_agreements_sent_status.sql
-- Original migration version prefix: 20260616
-- ============================================================

-- Add the business "sent" status for proposals/agreements while preserving legacy statuses.
ALTER TABLE public.proposals_agreements
  DROP CONSTRAINT IF EXISTS proposals_agreements_status_check;

ALTER TABLE public.proposals_agreements
  ADD CONSTRAINT proposals_agreements_status_check
  CHECK (status IN ('draft', 'sent', 'pending_approval', 'returned_for_changes', 'approved', 'cancelled'));


-- ============================================================
-- Combined migration section from: 20260616_proposals_agreements_signature_meta.sql
-- Original migration version prefix: 20260616
-- ============================================================

-- Store admin-selected proposal signature placement as JSON percentages relative to the A4 page.
ALTER TABLE public.proposals_agreements
  ADD COLUMN IF NOT EXISTS signature_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.proposals_agreements.signature_meta IS
  'Proposal approval signature metadata, including image path and x/y/width percentages relative to the A4 page.';

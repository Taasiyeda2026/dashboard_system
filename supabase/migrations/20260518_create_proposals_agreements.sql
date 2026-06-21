create extension if not exists pgcrypto;

-- Base proposals/agreement table.
-- The canonical column is activity_type_group. Older databases may still have activity_type;
-- this migration normalizes the table safely before creating indexes.
create table if not exists public.proposals_agreements (
  id uuid primary key default gen_random_uuid(),
  client_authority text not null default '',
  school_framework text not null default '',
  document_type text not null default '',
  activity_type_group text not null default '',
  contact_name text not null default '',
  contact_role text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_agreements_client_authority_not_blank check (btrim(client_authority) <> ''),
  constraint proposals_agreements_school_framework_not_blank check (btrim(school_framework) <> ''),
  constraint proposals_agreements_document_type_not_blank check (btrim(document_type) <> ''),
  constraint proposals_agreements_activity_type_group_not_blank check (btrim(activity_type_group) <> '')
);

-- Compatibility for existing databases / Preview branches created from older migrations.
DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped compatibility normalization';

  ELSE
    ALTER TABLE public.proposals_agreements
      ADD COLUMN IF NOT EXISTS client_authority text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS school_framework text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_name text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_role text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_phone text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'proposals_agreements'
        AND column_name = 'activity_type'
    ) AND NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'proposals_agreements'
        AND column_name = 'activity_type_group'
    ) THEN
      ALTER TABLE public.proposals_agreements
        RENAME COLUMN activity_type TO activity_type_group;

      RAISE NOTICE 'Renamed legacy activity_type to activity_type_group';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'proposals_agreements'
        AND column_name = 'activity_type_group'
    ) THEN
      ALTER TABLE public.proposals_agreements
        ADD COLUMN activity_type_group text NOT NULL DEFAULT '';

      RAISE NOTICE 'Added missing activity_type_group column';
    END IF;

    ALTER TABLE public.proposals_agreements
      DROP CONSTRAINT IF EXISTS proposals_agreements_activity_type_not_blank;

    ALTER TABLE public.proposals_agreements
      DROP CONSTRAINT IF EXISTS proposals_agreements_activity_type_group_not_blank;

    ALTER TABLE public.proposals_agreements
      ADD CONSTRAINT proposals_agreements_activity_type_group_not_blank
        CHECK (btrim(activity_type_group) <> '') NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.proposals_agreements') IS NULL THEN
    RAISE NOTICE 'Table public.proposals_agreements does not exist — skipped proposals_agreements_default_sort_idx';

  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type_group'
  ) THEN
    EXECUTE '
      create index if not exists proposals_agreements_default_sort_idx
      on public.proposals_agreements (client_authority, school_framework, document_type, activity_type_group)
    ';

    EXECUTE '
      create index if not exists proposals_agreements_activity_type_group_idx
      on public.proposals_agreements (activity_type_group)
    ';

    RAISE NOTICE 'Created proposals_agreements indexes with activity_type_group';

  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'proposals_agreements'
      AND column_name = 'activity_type'
  ) THEN
    EXECUTE '
      create index if not exists proposals_agreements_default_sort_idx
      on public.proposals_agreements (client_authority, school_framework, document_type, activity_type)
    ';

    EXECUTE '
      create index if not exists proposals_agreements_activity_type_idx
      on public.proposals_agreements (activity_type)
    ';

    RAISE NOTICE 'Created proposals_agreements indexes with legacy activity_type';

  ELSE
    RAISE NOTICE 'Neither activity_type_group nor activity_type exists — skipped proposal sort indexes';
  END IF;
END $$;

create index if not exists proposals_agreements_document_type_idx
  on public.proposals_agreements (document_type);

create or replace function public.touch_proposals_agreements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_proposals_agreements_updated_at on public.proposals_agreements;
create trigger trg_touch_proposals_agreements_updated_at
before update on public.proposals_agreements
for each row
execute function public.touch_proposals_agreements_updated_at();

create or replace function public.app_can_use_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('domain_manager', 'operation_manager', 'admin'), false)
$$;

revoke all on function public.app_can_use_proposals_agreements() from public;
grant execute on function public.app_can_use_proposals_agreements() to authenticated;

alter table public.proposals_agreements enable row level security;

drop policy if exists proposals_agreements_select_allowed_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_insert_allowed_roles on public.proposals_agreements;
drop policy if exists proposals_agreements_update_allowed_roles on public.proposals_agreements;

create policy proposals_agreements_select_allowed_roles
on public.proposals_agreements
for select
to authenticated
using (public.app_can_use_proposals_agreements());

create policy proposals_agreements_insert_allowed_roles
on public.proposals_agreements
for insert
to authenticated
with check (public.app_can_use_proposals_agreements());

create policy proposals_agreements_update_allowed_roles
on public.proposals_agreements
for update
to authenticated
using (public.app_can_use_proposals_agreements())
with check (public.app_can_use_proposals_agreements());

revoke all on public.proposals_agreements from anon;
grant select, insert, update on public.proposals_agreements to authenticated;
revoke delete on public.proposals_agreements from authenticated;

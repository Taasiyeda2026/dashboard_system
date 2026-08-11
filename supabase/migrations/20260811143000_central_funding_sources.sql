-- Central funding catalog. This migration is deliberately non-destructive:
-- activities.funding is retained and no legacy text is split, merged, or rewritten.
create table if not exists public.funding_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists funding_sources_name_unique_ci
  on public.funding_sources ((lower(btrim(name))));

create table if not exists public.activity_funding_sources (
  activity_id uuid not null references public.activities(id) on delete restrict,
  funding_source_id uuid not null references public.funding_sources(id) on delete restrict,
  amount numeric(14,2) null check (amount is null or amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (activity_id, funding_source_id)
);
create index if not exists activity_funding_sources_source_idx
  on public.activity_funding_sources (funding_source_id, activity_id);

create or replace function public.set_funding_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists funding_sources_updated_at on public.funding_sources;
create trigger funding_sources_updated_at before update on public.funding_sources
for each row execute function public.set_funding_updated_at();
drop trigger if exists activity_funding_sources_updated_at on public.activity_funding_sources;
create trigger activity_funding_sources_updated_at before update on public.activity_funding_sources
for each row execute function public.set_funding_updated_at();

alter table public.funding_sources enable row level security;
alter table public.activity_funding_sources enable row level security;

drop policy if exists funding_sources_read_authenticated on public.funding_sources;
create policy funding_sources_read_authenticated on public.funding_sources for select to authenticated using (true);
drop policy if exists funding_sources_admin_insert on public.funding_sources;
create policy funding_sources_admin_insert on public.funding_sources for insert to authenticated
with check (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active and u.role = 'admin'));
drop policy if exists funding_sources_admin_update on public.funding_sources;
create policy funding_sources_admin_update on public.funding_sources for update to authenticated
using (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active and u.role = 'admin'))
with check (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active and u.role = 'admin'));

-- Association permissions intentionally mirror direct activity management roles.
drop policy if exists activity_funding_read_authenticated on public.activity_funding_sources;
create policy activity_funding_read_authenticated on public.activity_funding_sources for select to authenticated using (true);
drop policy if exists activity_funding_write_managers on public.activity_funding_sources;
create policy activity_funding_write_managers on public.activity_funding_sources for all to authenticated
using (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active and u.role in ('admin','operation_manager')))
with check (exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active and u.role in ('admin','operation_manager')));

grant select on public.funding_sources, public.activity_funding_sources to authenticated;
grant insert, update on public.funding_sources to authenticated;
grant insert, update, delete on public.activity_funding_sources to authenticated;

-- Audit-only view: operators can inspect exact legacy values and likely variants.
-- No value is automatically converted into a catalog item or association.
create or replace view public.funding_legacy_audit as
select btrim(funding) as legacy_value, count(*)::bigint as activity_count,
       lower(regexp_replace(btrim(funding), '[[:space:]\-־״׳''"]+', '', 'g')) as comparison_key,
       position('+' in funding) > 0 as contains_separator
from public.activities
where nullif(btrim(funding), '') is not null
group by btrim(funding), lower(regexp_replace(btrim(funding), '[[:space:]\-־״׳''"]+', '', 'g')), position('+' in funding) > 0;
grant select on public.funding_legacy_audit to authenticated;

create extension if not exists pgcrypto;

create table if not exists public.proposals_agreements (
  id uuid primary key default gen_random_uuid(),
  client_authority text not null,
  school_framework text not null,
  document_type text not null,
  activity_type text not null,
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
  constraint proposals_agreements_activity_type_not_blank check (btrim(activity_type) <> '')
);

create index if not exists proposals_agreements_default_sort_idx
  on public.proposals_agreements (client_authority, school_framework, document_type, activity_type);

create index if not exists proposals_agreements_document_type_idx
  on public.proposals_agreements (document_type);

create index if not exists proposals_agreements_activity_type_idx
  on public.proposals_agreements (activity_type);

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

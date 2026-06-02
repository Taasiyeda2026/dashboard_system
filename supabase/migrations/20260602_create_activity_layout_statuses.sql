-- Store manual send status for summer activity-layout documents per school + authority.

create table if not exists public.activity_layout_statuses (
  season text not null,
  authority text not null,
  school text not null,
  sent boolean not null default false,
  sent_at timestamptz,
  sent_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activity_layout_statuses_pk primary key (season, authority, school),
  constraint activity_layout_statuses_season_not_blank check (btrim(season) <> ''),
  constraint activity_layout_statuses_authority_not_blank check (btrim(authority) <> ''),
  constraint activity_layout_statuses_school_not_blank check (btrim(school) <> '')
);

create or replace function public.set_activity_layout_statuses_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists activity_layout_statuses_set_updated_at on public.activity_layout_statuses;
create trigger activity_layout_statuses_set_updated_at
before update on public.activity_layout_statuses
for each row execute function public.set_activity_layout_statuses_updated_at();

alter table public.activity_layout_statuses enable row level security;

drop policy if exists activity_layout_statuses_select_ops on public.activity_layout_statuses;
drop policy if exists activity_layout_statuses_insert_ops on public.activity_layout_statuses;
drop policy if exists activity_layout_statuses_update_ops on public.activity_layout_statuses;

create policy activity_layout_statuses_select_ops
on public.activity_layout_statuses
for select
to authenticated
using (public.app_is_admin_or_operation_manager());

create policy activity_layout_statuses_insert_ops
on public.activity_layout_statuses
for insert
to authenticated
with check (public.app_is_admin_or_operation_manager());

create policy activity_layout_statuses_update_ops
on public.activity_layout_statuses
for update
to authenticated
using (public.app_is_admin_or_operation_manager())
with check (public.app_is_admin_or_operation_manager());

revoke all on public.activity_layout_statuses from anon;
grant select, insert, update on public.activity_layout_statuses to authenticated;

-- Minimal finance collection tracking layer.
-- Does not copy activity name, school, authority, price, funding, or type.
-- Activities remain the source of truth; this table stores only collection fields.

create or replace function public.app_can_access_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(trim(coalesce(public.app_current_role(), ''))) in ('admin', 'finance')
    or public.app_has_permission('finance_access')
    or public.app_has_permission('view_finance'),
    false
  )
$$;

revoke all on function public.app_can_access_finance() from public, anon;
grant execute on function public.app_can_access_finance() to authenticated;

create table if not exists public.finance_collection_tracking (
  activity_row_id text not null
    references public.activities(row_id) on delete cascade,
  collection_status text not null default 'open'
    check (collection_status in ('open', 'closed')),
  expected_collection_date date,
  finance_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid,
  primary key (activity_row_id)
);

comment on table public.finance_collection_tracking is
  'Finance-only collection fields keyed by the canonical activities.row_id. Activity attributes are never stored here.';
comment on column public.finance_collection_tracking.activity_row_id is
  'Stable activity identifier used by allActivities/saveActivity (activities.row_id).';
comment on column public.finance_collection_tracking.collection_status is
  'Collection status only (open/closed). Independent of operational activity status.';

create index if not exists finance_collection_tracking_status_idx
  on public.finance_collection_tracking (collection_status);

create or replace function public.set_finance_collection_tracking_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_collection_tracking_updated_at on public.finance_collection_tracking;
create trigger finance_collection_tracking_updated_at
before update on public.finance_collection_tracking
for each row execute function public.set_finance_collection_tracking_updated_at();

alter table public.finance_collection_tracking enable row level security;

drop policy if exists finance_collection_tracking_select on public.finance_collection_tracking;
create policy finance_collection_tracking_select
on public.finance_collection_tracking
for select
to authenticated
using ((select public.app_can_access_finance()));

drop policy if exists finance_collection_tracking_insert on public.finance_collection_tracking;
create policy finance_collection_tracking_insert
on public.finance_collection_tracking
for insert
to authenticated
with check ((select public.app_can_access_finance()));

drop policy if exists finance_collection_tracking_update on public.finance_collection_tracking;
create policy finance_collection_tracking_update
on public.finance_collection_tracking
for update
to authenticated
using ((select public.app_can_access_finance()))
with check ((select public.app_can_access_finance()));

drop policy if exists finance_collection_tracking_delete on public.finance_collection_tracking;
create policy finance_collection_tracking_delete
on public.finance_collection_tracking
for delete
to authenticated
using ((select public.app_can_access_finance()));

revoke all on table public.finance_collection_tracking from public, anon;
grant select, insert, update, delete on table public.finance_collection_tracking to authenticated;

create or replace function public.list_finance_collection_tracking()
returns setof public.finance_collection_tracking
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.app_can_access_finance() then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  return query
  select *
  from public.finance_collection_tracking
  order by updated_at desc;
end;
$$;

create or replace function public.upsert_finance_collection_tracking(
  p_activity_row_id text,
  p_collection_status text,
  p_expected_collection_date date default null,
  p_finance_note text default ''
)
returns public.finance_collection_tracking
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_id text := btrim(coalesce(p_activity_row_id, ''));
  v_status text := lower(btrim(coalesce(p_collection_status, 'open')));
  v_saved public.finance_collection_tracking%rowtype;
begin
  if not public.app_can_access_finance() then
    raise exception 'finance_permission_denied' using errcode = '42501';
  end if;
  if v_row_id = '' then
    raise exception 'finance_activity_row_id_required' using errcode = '22023';
  end if;
  if v_status not in ('open', 'closed') then
    raise exception 'finance_invalid_collection_status' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.activities a where a.row_id = v_row_id
  ) then
    raise exception 'finance_activity_not_found' using errcode = '22023';
  end if;

  insert into public.finance_collection_tracking (
    activity_row_id,
    collection_status,
    expected_collection_date,
    finance_note,
    updated_by_user_id
  )
  values (
    v_row_id,
    v_status,
    p_expected_collection_date,
    coalesce(p_finance_note, ''),
    auth.uid()
  )
  on conflict (activity_row_id)
  do update
  set
    collection_status = excluded.collection_status,
    expected_collection_date = excluded.expected_collection_date,
    finance_note = excluded.finance_note,
    updated_by_user_id = excluded.updated_by_user_id,
    updated_at = now()
  returning * into v_saved;

  return v_saved;
end;
$$;

revoke all on function public.list_finance_collection_tracking() from public, anon;
revoke all on function public.upsert_finance_collection_tracking(text, text, date, text) from public, anon;
grant execute on function public.list_finance_collection_tracking() to authenticated;
grant execute on function public.upsert_finance_collection_tracking(text, text, date, text) to authenticated;

-- Legacy payment_collected compatibility:
-- if the old column exists and contains real collected values, seed closed rows.
-- Do not rewrite activities and do not create tracking rows for empty/open defaults.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activities'
      and column_name = 'payment_collected'
  ) then
    if exists (
      select 1
      from public.activities
      where lower(btrim(coalesce(payment_collected::text, ''))) in ('yes', 'true', '1', 'נגבה')
    ) then
      insert into public.finance_collection_tracking (activity_row_id, collection_status, finance_note)
      select
        a.row_id,
        'closed',
        ''
      from public.activities a
      where coalesce(btrim(a.row_id), '') <> ''
        and lower(btrim(coalesce(a.payment_collected::text, ''))) in ('yes', 'true', '1', 'נגבה')
      on conflict (activity_row_id) do nothing;
    end if;
  end if;
end
$$;

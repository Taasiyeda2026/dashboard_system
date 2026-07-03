-- ============================================================
-- Combined migration section from: 20260602_add_business_development_manager_role.sql
-- Original migration version prefix: 20260602
-- ============================================================

-- Add the business_development_manager role without changing existing roles.

alter table public.users
  drop constraint if exists users_role_check;

alter table public.users
  add constraint users_role_check check (
    role in (
      'admin',
      'operation_manager',
      'authorized_user',
      'instructor',
      'finance',
      'activities_manager',
      'domain_manager',
      'instructor_manager',
      'business_development_manager'
    )
  );

-- Keep login RPC validation aligned with users_role_check so this role does not fail with invalid_role.
drop function if exists public.login_user_by_entry_code(text, text);

create function public.login_user_by_entry_code(p_login text, p_entry_code text)
returns table (
  status text,
  user_id text,
  email text,
  name text,
  role text,
  emp_id text,
  is_active boolean,
  permissions jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with input as (
    select trim(coalesce(p_login, '')) as login, trim(coalesce(p_entry_code, '')) as code
  ), candidate as (
    select u.*
    from public.users u
    cross join input i
    where u.user_id = i.login
       or u.email = i.login
       or u.emp_id = i.login
    order by case
      when u.user_id = i.login then 1
      when u.email = i.login then 2
      when u.emp_id = i.login then 3
      else 4
    end, u.created_at desc
    limit 1
  ), diagnostic as (
    select
      case
        when (select i.login from input i) = '' or (select i.code from input i) = '' then 'missing_user_id_or_entry_code'
        when not exists (select 1 from candidate) then 'user_not_found'
        when not (select c.is_active from candidate c) then 'inactive_user'
        when trim(coalesce((select c.entry_code from candidate c), '')) <> (select i.code from input i) then 'entry_code_mismatch'
        when coalesce((select c.role from candidate c), '') not in (
          'admin',
          'operation_manager',
          'authorized_user',
          'instructor',
          'finance',
          'activities_manager',
          'domain_manager',
          'instructor_manager',
          'business_development_manager'
        ) then 'invalid_role'
        else 'ok'
      end as status
  )
  select
    d.status,
    case when d.status = 'ok' then c.user_id end as user_id,
    case when d.status = 'ok' then c.email end as email,
    case when d.status = 'ok' then c.name end as name,
    case when d.status = 'ok' then c.role end as role,
    case when d.status = 'ok' then c.emp_id end as emp_id,
    case when d.status = 'ok' then c.is_active end as is_active,
    case when d.status = 'ok' then c.permissions end as permissions,
    case when d.status = 'ok' then c.created_at end as created_at,
    case when d.status = 'ok' then c.updated_at end as updated_at
  from diagnostic d
  left join candidate c on true;
$$;

revoke all on function public.login_user_by_entry_code(text, text) from public;

grant execute on function public.login_user_by_entry_code(text, text) to anon, authenticated;

-- Proposals/agreements currently use one role predicate for read and write RLS policies.
-- Add the new role to the existing predicate so the screen can load for this role.
create or replace function public.app_can_use_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('domain_manager', 'operation_manager', 'admin', 'business_development_manager'), false)
$$;

revoke all on function public.app_can_use_proposals_agreements() from public;

grant execute on function public.app_can_use_proposals_agreements() to authenticated;

-- Keep business_development_manager read-only in proposals/agreements at the database layer.
create or replace function public.app_can_manage_proposals_agreements()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.app_current_role() in ('domain_manager', 'operation_manager', 'admin'), false)
$$;

revoke all on function public.app_can_manage_proposals_agreements() from public;

grant execute on function public.app_can_manage_proposals_agreements() to authenticated;

drop policy if exists proposals_agreements_insert_allowed_roles on public.proposals_agreements;

drop policy if exists proposals_agreements_update_allowed_roles on public.proposals_agreements;

create policy proposals_agreements_insert_allowed_roles
on public.proposals_agreements
for insert
to authenticated
with check (public.app_can_manage_proposals_agreements());

create policy proposals_agreements_update_allowed_roles
on public.proposals_agreements
for update
to authenticated
using (public.app_can_manage_proposals_agreements())
with check (public.app_can_manage_proposals_agreements());

-- ============================================================
-- Combined migration section from: 20260602_create_activity_layout_statuses.sql
-- Original migration version prefix: 20260602
-- ============================================================

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

-- ============================================================
-- Combined migration section from: 20260602_normalize_one_day_activities.sql
-- Original migration version prefix: 20260602
-- ============================================================

-- Normalize existing one-day activities that have safe, non-conflicting type gaps.
-- Conflicting or missing-name rows are intentionally reported for manual review.

alter table public.activities add column if not exists item_type text;

-- Canonicalize one-day activity_type aliases. This is safe because these Hebrew labels
-- are only the general one-day type labels, not specific activity names.
update public.activities
set
  activity_family = 'one_day',
  activity_type = case
    when activity_type in ('סדנה', 'סדנאות', 'workshops') then 'workshop'
    when activity_type in ('סיור', 'סיורים', 'tours') then 'tour'
    when activity_type in ('חדר בריחה', 'חדרי בריחה', 'חדר_בריחה', 'חדרי_בריחה', 'escaperoom') then 'escape_room'
    else activity_type
  end,
  updated_at = now()
where activity_type in ('סדנה', 'סדנאות', 'workshops', 'סיור', 'סיורים', 'tours', 'חדר בריחה', 'חדרי בריחה', 'חדר_בריחה', 'חדרי_בריחה', 'escaperoom');

update public.activities
set
  item_type = 'tour',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'tour'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

update public.activities
set
  item_type = 'workshop',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'workshop'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

update public.activities
set
  item_type = 'escape_room',
  status = case when status = 'פעיל' then 'פתוח' else status end,
  updated_at = now()
where activity_family = 'one_day'
  and activity_type = 'escape_room'
  and nullif(btrim(coalesce(item_type, '')), '') is null;

-- Status conversion is safe and automatic for all one-day rows, including rows
-- that still need manual review for names or item_type conflicts.
update public.activities
set
  status = 'פתוח',
  updated_at = now()
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and status = 'פעיל';

create or replace view public.one_day_activity_exceptions as
select
  row_id,
  activity_family,
  activity_type,
  item_type,
  activity_name,
  status,
  start_date,
  end_date,
  date_1,
  updated_at,
  array_remove(array[
    case when nullif(btrim(coalesce(activity_name, '')), '') is null then 'missing_activity_name' end,
    case when activity_name in ('סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה') then 'generic_activity_name' end,
    case when nullif(btrim(coalesce(item_type, '')), '') is null then 'missing_item_type' end,
    case when nullif(btrim(coalesce(item_type, '')), '') is not null and item_type <> activity_type then 'item_type_conflict' end,
    case when status = 'פעיל' then 'legacy_active_status' end
  ], null) as exception_reasons
from public.activities
where activity_family = 'one_day'
  and activity_type in ('tour', 'workshop', 'escape_room')
  and (
    nullif(btrim(coalesce(activity_name, '')), '') is null
    or activity_name in ('סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה')
    or nullif(btrim(coalesce(item_type, '')), '') is null
    or item_type <> activity_type
    or status = 'פעיל'
  );

comment on view public.one_day_activity_exceptions is
  'Manual-review report for one-day activities with missing/generic activity_name, missing or conflicting item_type, or legacy active status. The migration only auto-fixes safe type/status/item_type-null cases.';

create or replace view public.one_day_activity_type_conflicts as
select
  row_id,
  activity_family,
  activity_type,
  item_type,
  activity_name,
  status,
  start_date,
  end_date,
  date_1,
  updated_at
from public.one_day_activity_exceptions
where 'item_type_conflict' = any(exception_reasons);

comment on view public.one_day_activity_type_conflicts is
  'Manual-review list for one-day activities whose activity_type and item_type conflict; migration does not auto-fix these rows.';

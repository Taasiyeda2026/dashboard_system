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

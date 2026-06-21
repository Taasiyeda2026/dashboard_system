-- Keep public.users.role aligned with the role codes used by imported user data.
-- instructor_manager is the canonical internal code; legacy manager_instructor values
-- are migrated before the constraint is tightened.

update public.users
set role = 'instructor_manager'
where role = 'manager_instructor';

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
  ) not valid;

-- Login validates entry_code server-side and allows the same canonical role set
-- as the users_role_check constraint.
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
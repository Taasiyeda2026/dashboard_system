create or replace function public.get_manager_team_roster(
  p_manager_name text default null,
  p_school_year text default '2027'
)
returns table (
  emp_id bigint,
  full_name text,
  employment_type text,
  direct_manager text,
  folder_web_url text,
  intro_call_completed boolean,
  contract_confirmed boolean,
  observation_completed boolean,
  feedback_completed boolean,
  police_clearance_confirmed boolean,
  followup_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
  v_manager_name text;
begin
  select
    trim(coalesce(u.role, '')),
    coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role is null then
    raise exception 'manager_workspace_auth_required' using errcode = '42501';
  end if;

  if v_role = 'activities_manager' then
    v_manager_name := v_own_name;
  elsif v_role in ('admin', 'operation_manager', 'finance') then
    v_manager_name := nullif(trim(coalesce(p_manager_name, '')), '');
  else
    raise exception 'manager_workspace_permission_denied' using errcode = '42501';
  end if;

  if v_manager_name is null or v_manager_name = '' then
    raise exception 'manager_workspace_manager_required' using errcode = '22023';
  end if;

  if coalesce(p_school_year, '') !~ '^[0-9]{4}$' then
    raise exception 'manager_workspace_school_year_invalid' using errcode = '22023';
  end if;

  return query
  select
    ci.emp_id,
    ci.full_name,
    ci.employment_type,
    ci.direct_manager,
    ef.folder_web_url,
    coalesce(f.intro_call_completed, false),
    coalesce(f.contract_confirmed, false),
    coalesce(f.observation_completed, false),
    coalesce(f.feedback_completed, false),
    coalesce(f.police_clearance_confirmed, false),
    f.updated_at
  from public.contacts_instructors ci
  left join public.manager_instructor_followup f
    on f.emp_id = ci.emp_id and f.school_year = p_school_year
  left join public.instructor_employee_folders ef
    on ef.emp_id = ci.emp_id and ef.school_year = p_school_year
  where lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(v_manager_name))
    and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
  order by ci.full_name nulls last, ci.emp_id;
end
$$;

create or replace function public.update_manager_instructor_followup(
  p_emp_id bigint,
  p_school_year text,
  p_field text,
  p_value boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_own_name text;
  v_allowed boolean := false;
  v_row public.manager_instructor_followup;
begin
  select
    trim(coalesce(u.role, '')),
    coalesce(nullif(trim(coalesce(u.full_name, '')), ''), nullif(trim(coalesce(u.name, '')), ''), nullif(trim(coalesce(u.username, '')), ''))
  into v_role, v_own_name
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_role in ('admin', 'operation_manager', 'finance') then
    v_allowed := true;
  elsif v_role = 'activities_manager' then
    select exists (
      select 1
      from public.contacts_instructors ci
      where ci.emp_id = p_emp_id
        and lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(coalesce(v_own_name, '')))
        and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
    ) into v_allowed;
  end if;

  if not coalesce(v_allowed, false) then
    raise exception 'manager_workspace_permission_denied' using errcode = '42501';
  end if;

  if coalesce(p_school_year, '') !~ '^[0-9]{4}$' then
    raise exception 'manager_workspace_school_year_invalid' using errcode = '22023';
  end if;

  if p_field not in (
    'intro_call_completed',
    'contract_confirmed',
    'observation_completed',
    'feedback_completed',
    'police_clearance_confirmed'
  ) then
    raise exception 'manager_workspace_field_invalid' using errcode = '22023';
  end if;

  if not exists (select 1 from public.contacts_instructors ci where ci.emp_id = p_emp_id) then
    raise exception 'manager_workspace_instructor_not_found' using errcode = '22023';
  end if;

  insert into public.manager_instructor_followup (emp_id, school_year, updated_at, updated_by)
  values (p_emp_id, p_school_year, now(), auth.uid())
  on conflict (emp_id, school_year) do nothing;

  update public.manager_instructor_followup
  set
    intro_call_completed = case when p_field = 'intro_call_completed' then coalesce(p_value, false) else intro_call_completed end,
    contract_confirmed = case when p_field = 'contract_confirmed' then coalesce(p_value, false) else contract_confirmed end,
    observation_completed = case when p_field = 'observation_completed' then coalesce(p_value, false) else observation_completed end,
    feedback_completed = case when p_field = 'feedback_completed' then coalesce(p_value, false) else feedback_completed end,
    police_clearance_confirmed = case when p_field = 'police_clearance_confirmed' then coalesce(p_value, false) else police_clearance_confirmed end,
    updated_at = now(),
    updated_by = auth.uid()
  where emp_id = p_emp_id and school_year = p_school_year
  returning * into v_row;

  return jsonb_build_object(
    'emp_id', v_row.emp_id,
    'school_year', v_row.school_year,
    'intro_call_completed', v_row.intro_call_completed,
    'contract_confirmed', v_row.contract_confirmed,
    'observation_completed', v_row.observation_completed,
    'feedback_completed', v_row.feedback_completed,
    'police_clearance_confirmed', v_row.police_clearance_confirmed,
    'updated_at', v_row.updated_at
  );
end
$$;

revoke all on function public.get_manager_team_roster(text, text) from public, anon, authenticated;
revoke all on function public.update_manager_instructor_followup(bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.get_manager_team_roster(text, text) to authenticated;
grant execute on function public.update_manager_instructor_followup(bigint, text, text, boolean) to authenticated;

comment on function public.get_manager_team_roster(text, text) is 'Manager workspace roster: activities_manager is self-scoped; admin, operation_manager and finance can select an activity manager; all other roles are denied.';
comment on function public.update_manager_instructor_followup(bigint, text, text, boolean) is 'Updates one manager follow-up flag; activities_manager is self-scoped and admin, operation_manager and finance may manage selected teams.';

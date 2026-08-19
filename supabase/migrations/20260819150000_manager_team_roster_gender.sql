-- Pass the existing canonical gender field (instructor_scheduling_profiles.gender, already used for
-- course-scheduling matching) through the manager workspace roster, so the manager board can apply the
-- police-clearance/FEMALE display rule without inferring gender or introducing a new source.
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
  gender text,
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
    sp.gender,
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
  left join public.instructor_scheduling_profiles sp
    on sp.emp_id = ci.emp_id
  where lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(v_manager_name))
    and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
  order by ci.full_name nulls last, ci.emp_id;
end
$$;

revoke all on function public.get_manager_team_roster(text, text) from public, anon, authenticated;
grant execute on function public.get_manager_team_roster(text, text) to authenticated;

comment on function public.get_manager_team_roster(text, text) is 'Manager workspace roster: activities_manager is self-scoped; admin, operation_manager and finance can select an activity manager; all other roles are denied. Includes instructor_scheduling_profiles.gender for read-only display rules.';

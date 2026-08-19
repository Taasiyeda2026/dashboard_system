-- "אישור משטרה" becomes its own canonical employee-file component, scanned from SharePoint at
-- 01 הסכם ומסמכים/אישור משטרה (not merged into supporting_documents). Its completion (item count > 0)
-- becomes the single source of truth for police clearance — no manual boolean is kept for it.

-- 1) Allow the new component_key value on the existing document-status table (no new table/column).
alter table public.instructor_employee_document_status
  drop constraint if exists instructor_employee_document_status_component_key_check;
alter table public.instructor_employee_document_status
  add constraint instructor_employee_document_status_component_key_check
  check (component_key in (
    'signed_agreement', 'supporting_documents', 'intro_feedback', 'midyear_feedback',
    'year_end_feedback', 'observation_1', 'observation_2', 'payroll_reports', 'police_clearance'
  ));

-- 2) Pass the canonical gender (instructor_scheduling_profiles.gender) through the existing
-- per-instructor employee-file snapshot RPC, so both the employee-file modal and the onboarding-folder
-- function can read it from a call they already make, instead of guessing or trusting client input.
create or replace function public.get_instructor_employee_file_snapshot(
  p_emp_id bigint,
  p_school_year text default '2027'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_gender text;
begin
  if not public.app_can_view_employee_files() then
    raise exception 'employee_files_permission_denied' using errcode = '42501';
  end if;

  select sp.gender into v_gender from public.instructor_scheduling_profiles sp where sp.emp_id = p_emp_id;

  if not exists (
    select 1
    from public.contacts_instructors
    where emp_id = p_emp_id
      and lower(trim(coalesce(active::text,''))) not in ('no','false','0')
  ) then
    return jsonb_build_object(
      'mapped', false,
      'components', '[]'::jsonb,
      'can_edit_folder_url', public.app_is_employee_files_admin(),
      'gender', v_gender
    );
  end if;

  select jsonb_build_object(
    'mapped', true,
    'folder_web_url', f.folder_web_url,
    'can_edit_folder_url', public.app_is_employee_files_admin(),
    'gender', v_gender,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'component_key', s.component_key,
        'completed', s.completed,
        'item_count', s.item_count,
        'updated_at', s.updated_at
      ) order by s.component_key)
      from public.instructor_employee_document_status s
      where s.folder_mapping_id = f.id
    ), '[]'::jsonb)
  ) into result
  from public.instructor_employee_folders f
  where f.emp_id = p_emp_id and f.school_year = p_school_year;

  return coalesce(
    result,
    jsonb_build_object(
      'mapped', false,
      'components', '[]'::jsonb,
      'can_edit_folder_url', public.app_is_employee_files_admin(),
      'gender', v_gender
    )
  );
end
$$;

-- 3) The manager board's read-only "מעקב צוות" shows one team at a time, so it reads police clearance
-- in bulk from the same SharePoint-derived component (via instructor_employee_document_status), not the
-- manual manager_instructor_followup.police_clearance_confirmed field, which this column replaces for display.
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
  police_clearance_file_completed boolean,
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
    coalesce(ds.completed, false),
    f.updated_at
  from public.contacts_instructors ci
  left join public.manager_instructor_followup f
    on f.emp_id = ci.emp_id and f.school_year = p_school_year
  left join public.instructor_employee_folders ef
    on ef.emp_id = ci.emp_id and ef.school_year = p_school_year
  left join public.instructor_scheduling_profiles sp
    on sp.emp_id = ci.emp_id
  left join public.instructor_employee_document_status ds
    on ds.folder_mapping_id = ef.id and ds.component_key = 'police_clearance'
  where lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(v_manager_name))
    and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
  order by ci.full_name nulls last, ci.emp_id;
end
$$;

revoke all on function public.get_manager_team_roster(text, text) from public, anon, authenticated;
grant execute on function public.get_manager_team_roster(text, text) to authenticated;

comment on function public.get_manager_team_roster(text, text) is 'Manager workspace roster: activities_manager is self-scoped; admin, operation_manager and finance can select an activity manager; all other roles are denied. Includes instructor_scheduling_profiles.gender and the SharePoint-derived police_clearance_file_completed status (source of truth for the police-clearance column).';
comment on function public.get_instructor_employee_file_snapshot(bigint, text) is 'Per-instructor employee-file snapshot, including instructor_scheduling_profiles.gender so callers (employee-file modal, onboarding-folder provisioning) never have to guess or infer gender.';

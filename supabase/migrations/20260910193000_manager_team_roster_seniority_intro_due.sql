-- Extend manager team roster with contacts_instructors.seniority_years and
-- seniority-based intro / opening-year call due dates for school_year=2027.
-- Rules:
--   seniority_years > 1  -> veteran opening-year call due 2026-10-20
--   seniority_years <= 1 -> new-hire intro call due employee_created_at + 1 month
--   seniority_years IS NULL / invalid -> intro_feedback_due_date is NULL
-- Observation due-date rules are unchanged.

drop function if exists public.get_manager_team_roster(text, text);

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
  seniority_years smallint,
  intro_call_completed boolean,
  contract_confirmed boolean,
  observation_completed boolean,
  feedback_completed boolean,
  police_clearance_confirmed boolean,
  police_clearance_file_completed boolean,
  followup_updated_at timestamptz,
  signed_agreement_completed boolean,
  supporting_documents_completed boolean,
  police_clearance_completed boolean,
  intro_feedback_completed boolean,
  midyear_feedback_completed boolean,
  year_end_feedback_completed boolean,
  observation_1_completed boolean,
  observation_2_completed boolean,
  employee_created_at timestamptz,
  first_activity_date date,
  intro_feedback_completed_at timestamptz,
  intro_feedback_due_date date,
  observation_1_completed_at timestamptz,
  observation_1_due_date date,
  observation_2_completed_at timestamptz,
  observation_2_due_date date
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
  v_school_year integer;
begin
  select
    trim(coalesce(u.role, '')),
    coalesce(
      nullif(trim(coalesce(u.full_name, '')), ''),
      nullif(trim(coalesce(u.name, '')), ''),
      nullif(trim(coalesce(u.username, '')), '')
    )
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
  v_school_year := p_school_year::integer;

  return query
  select
    ci.emp_id,
    ci.full_name,
    ci.employment_type,
    ci.direct_manager,
    ef.folder_web_url,
    sp.gender,
    ci.seniority_years,
    coalesce(ds.intro_feedback_completed, false) as intro_call_completed,
    coalesce(ds.signed_agreement_completed, false) as contract_confirmed,
    coalesce(ds.observation_1_completed, false) or coalesce(ds.observation_2_completed, false) as observation_completed,
    coalesce(ds.intro_feedback_completed, false)
      or coalesce(ds.midyear_feedback_completed, false)
      or coalesce(ds.year_end_feedback_completed, false) as feedback_completed,
    coalesce(ds.police_clearance_completed, false) as police_clearance_confirmed,
    coalesce(ds.police_clearance_completed, false) as police_clearance_file_completed,
    ds.updated_at as followup_updated_at,
    coalesce(ds.signed_agreement_completed, false) as signed_agreement_completed,
    coalesce(ds.supporting_documents_completed, false) as supporting_documents_completed,
    coalesce(ds.police_clearance_completed, false) as police_clearance_completed,
    coalesce(ds.intro_feedback_completed, false) as intro_feedback_completed,
    coalesce(ds.midyear_feedback_completed, false) as midyear_feedback_completed,
    coalesce(ds.year_end_feedback_completed, false) as year_end_feedback_completed,
    coalesce(ds.observation_1_completed, false) as observation_1_completed,
    coalesce(ds.observation_2_completed, false) as observation_2_completed,
    coalesce(usr.employee_created_at, ef.created_at) as employee_created_at,
    act.first_activity_date,
    ds.intro_feedback_completed_at,
    case
      when ci.seniority_years is null then null
      when v_school_year = 2027 and ci.seniority_years > 1 then date '2026-10-20'
      when ci.seniority_years <= 1
        and coalesce(usr.employee_created_at, ef.created_at) is not null
        then (coalesce(usr.employee_created_at, ef.created_at)::date + interval '1 month')::date
      else null
    end as intro_feedback_due_date,
    ds.observation_1_completed_at,
    case
      when act.first_activity_date is null then null
      else (act.first_activity_date + interval '1 month')::date
    end as observation_1_due_date,
    ds.observation_2_completed_at,
    case
      when ds.observation_1_completed_at is null then null
      else (ds.observation_1_completed_at::date + interval '1 month')::date
    end as observation_2_due_date
  from public.contacts_instructors ci
  left join public.instructor_employee_folders ef
    on ef.emp_id = ci.emp_id
   and ef.school_year = p_school_year
  left join public.instructor_scheduling_profiles sp
    on sp.emp_id = ci.emp_id
  left join lateral (
    select min(u.created_at) as employee_created_at
    from public.users u
    where trim(coalesce(u.emp_id, '')) = ci.emp_id::text
  ) usr on true
  left join lateral (
    select min(d.meeting_date) as first_activity_date
    from public.activities a
    cross join lateral unnest(array[
      a.start_date,
      a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,a.date_7,a.date_8,a.date_9,a.date_10,
      a.date_11,a.date_12,a.date_13,a.date_14,a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,a.date_20,
      a.date_21,a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,a.date_27,a.date_28,a.date_29,a.date_30,
      a.date_31,a.date_32,a.date_33,a.date_34,a.date_35
    ]) as d(meeting_date)
    where (
      a.emp_id = ci.emp_id
      or trim(coalesce(a.emp_id_2, '')) = ci.emp_id::text
    )
      and d.meeting_date is not null
      and d.meeting_date between make_date(v_school_year - 1, 9, 1) and make_date(v_school_year, 8, 31)
      and lower(trim(coalesce(a.status, ''))) not in ('בוטל','מבוטל','נמחק','סגור','cancelled','canceled','deleted','closed','inactive')
  ) act on true
  left join lateral (
    select
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'signed_agreement'), false) as signed_agreement_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'supporting_documents'), false) as supporting_documents_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'police_clearance'), false) as police_clearance_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'intro_feedback'), false) as intro_feedback_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'midyear_feedback'), false) as midyear_feedback_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'year_end_feedback'), false) as year_end_feedback_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'observation_1'), false) as observation_1_completed,
      coalesce(bool_or((s.completed or coalesce(s.item_count, 0) > 0)) filter (where s.component_key = 'observation_2'), false) as observation_2_completed,
      max(s.updated_at) filter (where s.component_key = 'intro_feedback' and (s.completed or coalesce(s.item_count, 0) > 0)) as intro_feedback_completed_at,
      max(s.updated_at) filter (where s.component_key = 'observation_1' and (s.completed or coalesce(s.item_count, 0) > 0)) as observation_1_completed_at,
      max(s.updated_at) filter (where s.component_key = 'observation_2' and (s.completed or coalesce(s.item_count, 0) > 0)) as observation_2_completed_at,
      max(s.updated_at) as updated_at
    from public.instructor_employee_document_status s
    where s.folder_mapping_id = ef.id
  ) ds on true
  where lower(trim(coalesce(ci.direct_manager, ''))) = lower(trim(v_manager_name))
    and lower(trim(coalesce(ci.active::text, ''))) not in ('no', 'false', '0', 'לא')
  order by ci.full_name nulls last, ci.emp_id;
end
$$;

revoke all on function public.get_manager_team_roster(text, text) from public, anon, authenticated;
grant execute on function public.get_manager_team_roster(text, text) to authenticated;

comment on function public.get_manager_team_roster(text, text) is
  'Manager tracking roster with employee-file completion flags, contacts_instructors.seniority_years, and seniority-based intro/opening-year due dates for 2027; observation due dates remain one month after their anchors.';

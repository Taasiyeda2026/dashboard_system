-- Permit a member to commit an existing server-calculated planning option directly
-- through the ordinary scheduling validators. No free-form dates or instructor IDs.
-- This does NOT start or mutate the planning engine, change settings, approve
-- exceptions, or override a confirmed course.
create or replace function public.scheduling_agent_team_confirm_planning_option(
  p_activity_id text,
  p_option_index integer,
  p_workspace_revision bigint,
  p_source_revision bigint,
  p_allow_date_change boolean default false
) returns jsonb
language plpgsql security definer
set search_path=public,pg_temp
as $$
declare
  a public.activities;
  assigned public.activities;
  w public.scheduling_planning_workspaces;
  r public.scheduling_planning_rows;
  option_data jsonb;
  proposed_meetings jsonb;
  emp bigint;
  name_from_db text;
  i integer;
  old_date date;
  new_date date;
  old_start time;
  old_end time;
  new_start time;
  new_end time;
begin
  perform public.scheduling_agent_team_assert_member();
  if p_activity_id is null or length(btrim(p_activity_id)) not between 1 and 200
    or p_option_index is null or p_option_index not between 0 and 50
    or p_workspace_revision is null or p_source_revision is null
  then raise exception 'scheduling_agent_invalid_selection'; end if;

  select * into w from public.scheduling_planning_workspaces
  where period_key='year' and district='' for update;
  if not found or w.revision is distinct from p_workspace_revision
    or w.validated_source_revision is distinct from p_source_revision
    or (select revision from public.scheduling_planning_source_state where singleton)
       is distinct from p_source_revision
  then raise exception 'scheduling_agent_revision_conflict' using errcode='PT409'; end if;

  select * into a from public.activities where row_id=p_activity_id for update;
  if not found or a.activity_season <> 'school_2027'
    or a.activity_type <> 'course' or a.status <> 'פתוח'
  then raise exception 'scheduling_agent_team_course_only'; end if;
  if a.emp_id is not null or a.instructor_assignment_locked
    or nullif(btrim(coalesce(a.emp_id_2,'')), '') is not null
    or nullif(btrim(coalesce(a.draft_emp_id,'')), '') is not null
  then raise exception 'scheduling_assignment_protected'; end if;

  select * into r from public.scheduling_planning_rows
  where workspace_id=w.id and activity_id=p_activity_id for update;
  if not found or r.needs_recalc
    or r.activity_updated_at is distinct from a.updated_at
    or r.locked_option is not null
  then raise exception 'scheduling_agent_stale_planning'; end if;

  option_data := r.row_data->'options'->p_option_index;
  if jsonb_typeof(option_data) is distinct from 'object'
    or option_data->>'eligible' is distinct from 'true'
    or option_data->>'routeVerified' is distinct from 'true'
    or coalesce(option_data->>'instructorEmpId','') !~ '^[0-9]+$'
  then raise exception 'scheduling_agent_invalid_option'; end if;
  proposed_meetings := option_data->'meetings';
  if jsonb_typeof(proposed_meetings) is distinct from 'array'
    or jsonb_array_length(proposed_meetings) not between 1 and 35
    or exists(
      select 1 from jsonb_array_elements(proposed_meetings) mt
      where coalesce(mt->>'substituteEmpId','') <> ''
    )
  then raise exception 'scheduling_agent_invalid_meetings'; end if;

  -- Never alter already elapsed official sessions, and do not quietly change
  -- agreed future school times/dates. Changed plans require explicit consent.
  old_start := a.start_time::time;
  old_end := a.end_time::time;
  for i in 1..35 loop
    old_date := nullif(to_jsonb(a)->>('date_'||i),'')::date;
    if old_date is null then continue; end if;
    if i > jsonb_array_length(proposed_meetings)
    then raise exception 'scheduling_agent_existing_dates_protected'; end if;
    new_date := nullif(proposed_meetings->(i-1)->>'date','')::date;
    new_start := nullif(proposed_meetings->(i-1)->>'start_time','')::time;
    new_end := nullif(proposed_meetings->(i-1)->>'end_time','')::time;
    if new_date is distinct from old_date
       or (old_start is not null and new_start is distinct from old_start)
       or (old_end is not null and new_end is distinct from old_end)
    then
      if old_date <= (now() at time zone 'Asia/Jerusalem')::date
      then raise exception 'scheduling_agent_elapsed_meeting_protected'; end if;
      if p_allow_date_change is distinct from true
      then raise exception 'scheduling_agent_date_change_requires_explicit_consent'; end if;
    end if;
  end loop;

  if a.start_date is null
    and (proposed_meetings->0->>'date')::date
      < ((now() at time zone 'Asia/Jerusalem')::date+7)
  then raise exception 'scheduling_agent_start_too_soon'; end if;

  emp := (option_data->>'instructorEmpId')::bigint;
  select full_name into name_from_db from public.contacts_instructors where emp_id=emp;
  if not found then raise exception 'instructor_not_found'; end if;

  -- Built-in meeting validator / eligibility gates run transactionally and
  -- roll back meeting changes when instructor assignment fails.
  assigned := public.assign_activity_instructor_with_dates(
    p_activity_id,emp,name_from_db,proposed_meetings,
    null,null,null,'approved','הצעת תכנון קיימת שאושרה בשיחת סוכן השיבוצים'
  );
  return jsonb_build_object(
    'activityId',assigned.row_id,
    'instructorId',assigned.emp_id,
    'instructorName',assigned.instructor_name,
    'startDate',assigned.start_date,
    'endDate',assigned.end_date,
    'state','confirmed_planning_option'
  );
end
$$;

revoke all on function public.scheduling_agent_team_confirm_planning_option(text,integer,bigint,bigint,boolean)
from public,anon;
grant execute on function public.scheduling_agent_team_confirm_planning_option(text,integer,bigint,bigint,boolean)
to authenticated;

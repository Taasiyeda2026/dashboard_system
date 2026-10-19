-- Disposable PostgreSQL fixture for permanent availability approvals.
create extension if not exists pgcrypto;
create schema if not exists auth;
do $$ begin
 if not exists (select from pg_roles where rolname='anon') then create role anon; end if;
 if not exists (select from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('test.uid',true),'')::uuid
$$;
create table public.users (auth_user_id uuid primary key,is_active boolean not null);
create table public.scheduling_agent_control (approver_id uuid primary key);
create function public.app_current_role() returns text language sql stable as $$
 select current_setting('test.role',true)
$$;
create function public.app_is_admin_or_operation_manager() returns boolean language sql stable as $$
 select public.app_current_role() in ('admin','operation_manager')
$$;
create function public.app_has_permission(p_name text) returns boolean language sql stable as $$
 select auth.uid() is not null and p_name='view_operations_scheduling'
$$;
create table public.contacts_instructors (
 emp_id bigint primary key,full_name text not null,active text not null
);
create table public.activities (
 row_id text primary key,
 activity_season text default 'school_2027',
 activity_type text default 'course',
 status text default 'פתוח',
 school text,
 school_id bigint,
 authority text,
 authority_id bigint,
 activity_name text,
 instructor_assignment_locked boolean default false,
 instructor_assignment_status text,
 emp_id bigint,
 emp_id_2 text,
 instructor_name text,
 instructor_name_2 text,
 draft_emp_id text,
 draft_proposed_meetings jsonb,
 start_time time,
 end_time time,
 updated_at timestamptz default clock_timestamp(),
 date_1 date,date_2 date,date_3 date,date_4 date,date_5 date,date_6 date,
 date_7 date,date_8 date,date_9 date,date_10 date,date_11 date,date_12 date,
 date_13 date,date_14 date,date_15 date,date_16 date,date_17 date,date_18 date,
 date_19 date,date_20 date,date_21 date,date_22 date,date_23 date,date_24 date,
 date_25 date,date_26 date,date_27 date,date_28 date,date_29 date,date_30 date,
 date_31 date,date_32 date,date_33 date,date_34 date,date_35 date
);
create table public.instructor_availability_exceptions (
 emp_id bigint not null references public.contacts_instructors(emp_id),
 exception_date date not null, available boolean, start_time time,end_time time,
 unique (emp_id,exception_date)
);
create table public.course_meeting_cancellations (
 activity_id text not null,meeting_date date not null
);
create table public.course_meeting_instructor_history (
 id uuid primary key default gen_random_uuid(),
 activity_id text not null references public.activities(row_id),
 meeting_date date not null,
 emp_id text not null,
 instructor_name text,
 assignment_kind text not null default 'history',
 recorded_at timestamptz not null default now(),
 recorded_by uuid, reason text, previous_emp_id text, previous_instructor_name text,
 replaces_history boolean default false,
 constraint course_meeting_instructor_history_assignment_kind_check
   check (assignment_kind in ('history','single_meeting_substitution')),
 constraint course_meeting_instructor_history_activity_id_meeting_date_key
   unique (activity_id,meeting_date)
);
alter table public.course_meeting_instructor_history enable row level security;
create function public.scheduling_activity_official_meetings(a public.activities)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('date',d.meeting_date)
                  order by d.meeting_date),'[]'::jsonb)
  from unnest(array[a.date_1,a.date_2,a.date_3,a.date_4,a.date_5,a.date_6,
    a.date_7,a.date_8,a.date_9,a.date_10,a.date_11,a.date_12,
    a.date_13,a.date_14,a.date_15,a.date_16,a.date_17,a.date_18,a.date_19,
    a.date_20,a.date_21,a.date_22,a.date_23,a.date_24,a.date_25,a.date_26,
    a.date_27,a.date_28,a.date_29,a.date_30,a.date_31,a.date_32,a.date_33,
    a.date_34,a.date_35]) d(meeting_date) where d.meeting_date is not null
$$;
create function public.scheduling_effective_end_time(p_activity_id text,p_date date,p_default time)
returns time language sql stable as $$select p_default$$;
create function public.scheduling_lock_instructor_for_write(p_emp_id bigint) returns void
language plpgsql as $$begin if p_emp_id is null then raise exception 'missing_id';end if;end $$;
create function public.scheduling_validate_proposed_meetings(p_activity_id text,p_meetings jsonb)
returns jsonb language plpgsql stable as $$
declare a public.activities; n int;
begin
 select * into a from public.activities where row_id=p_activity_id;
 select jsonb_array_length(public.scheduling_activity_official_meetings(a)) into n;
 if jsonb_typeof(p_meetings)<>'array' or jsonb_array_length(p_meetings)<>n
 then raise exception 'scheduling_proposed_meeting_count_mismatch';end if;
 return p_meetings;
end $$;
create function public.scheduling_course_instructor_violations(
 p_activity_id text,p_emp_id bigint,p_expect_unassigned boolean default true,
 p_skip_meeting_dates date[] default null
) returns text[] language plpgsql stable as $$
declare a public.activities; m jsonb; d date;
begin
 select * into a from public.activities where row_id=p_activity_id;
 for m in select value from jsonb_array_elements(public.scheduling_effective_meetings(a,p_emp_id)) loop
   d:=(m->>'date')::date;
   if p_skip_meeting_dates is not null and d=any(p_skip_meeting_dates) then continue;end if;
   if exists(select 1 from public.instructor_availability_exceptions e
    where e.emp_id=p_emp_id and e.exception_date=d and e.available is false)
   then return array['scheduling_instructor_unavailable']; end if;
 end loop;
 return '{}'::text[];
end $$;
create function public.scheduling_assert_proposed_eligibility(
 p_activity_id text,p_emp_id bigint,p_meetings jsonb
) returns void language plpgsql as $$
declare m jsonb;
begin
 for m in select value from jsonb_array_elements(p_meetings) loop
  if exists(select 1 from public.instructor_availability_exceptions e
    where e.emp_id=p_emp_id and e.exception_date=(m->>'date')::date
      and e.available is false)
  then raise exception 'scheduling_instructor_unavailable'; end if;
 end loop;
end $$;
create function public.scheduling_assert_assignment_calendar(
 p_activity_id text,p_emp_id bigint,p_meetings jsonb
) returns void language plpgsql as $$
declare target public.activities; meeting jsonb;
begin
 select * into target from public.activities where row_id=p_activity_id;
  p_meetings := public.scheduling_validate_proposed_meetings(p_activity_id, p_meetings);
 for meeting in select value from jsonb_array_elements(p_meetings) loop
  if meeting->>'date' is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
 end loop;
end $$;
create function public.assign_activity_instructor(
 p_activity_id text,p_emp_id bigint,p_instructor_name text,p_top_emp_id bigint,
 p_selected_score integer,p_top_score integer,p_decision_type text,p_reason text default null
) returns public.activities language plpgsql as $$
declare a public.activities; v text[];
begin
 select * into a from public.activities where row_id=p_activity_id for update;
 if a.emp_id is not null then raise exception 'scheduling_assignment_locked';end if;
 v:=public.scheduling_course_instructor_violations(p_activity_id,p_emp_id,true);
 if cardinality(v)>0 then raise exception '%',v[1]; end if;
 update public.activities set emp_id=p_emp_id,instructor_name=p_instructor_name,
   instructor_assignment_locked=true,instructor_assignment_status='שובץ'
 where row_id=p_activity_id returning * into a;
 return a;
end $$;
create function public.scheduling_dashboard_assignment(
 p_rpc text,p_args jsonb,p_expected_updated_at timestamptz,
 p_expected_source_revision bigint default null,p_expected_workspace_revision bigint default null
) returns public.activities language plpgsql as $$
declare result public.activities;
begin
 if p_rpc='dummy' then
  select * into result from public.activities where row_id=p_args->>'p_activity_id';
 else raise exception 'scheduling_action_not_allowed' using errcode='42501'; end if;
 return result;
end $$;
create function public.set_scheduling_planning_lock(
 p_period text,p_district text,p_activity text,p_lock jsonb,p_rev bigint
) returns void language plpgsql as $$begin null;end $$;
-- Synthetic representative signature and patch anchors from deployed confirm.
create function public.confirm_scheduling_planning_draft(
 p_period_key text,p_district text,p_activity_id text,p_expected_revision bigint default null
) returns public.activities language plpgsql as $$
declare
  v_activity_id text:=p_activity_id;
  v_emp_id bigint:=1550;
  meetings jsonb:='[]'::jsonb;
  option jsonb;
  item jsonb;
  meeting_date date;
  meeting_start time;
  meeting_end time;
  selected_instructor public.contacts_instructors;
  skip_dates date[] := '{}'::date[];
  main_meetings jsonb := '[]'::jsonb;
  idx integer:=1;
  violations text[];
  result public.activities;
  workspace record;
  scope_period text:=p_period_key;
  scope_district text:=p_district;
begin
  for item in select value from jsonb_array_elements(meetings) loop
    meeting_date := (item->>'date')::date;
    meeting_start := (item->>'start_time')::time;
    meeting_end := (item->>'end_time')::time;
    if coalesce(item->>'substituteEmpId', '') ~ '^[0-9]+$' then
      skip_dates:=array_append(skip_dates,meeting_date);
    else
      main_meetings := main_meetings || jsonb_build_array(jsonb_build_object(
        'date', meeting_date,
        'meeting_no', idx,
        'start_time', meeting_start,
        'end_time', meeting_end
      ));
    end if;
  end loop;
  violations := public.scheduling_course_instructor_violations(v_activity_id, v_emp_id, true, skip_dates);
  perform public.set_scheduling_planning_lock(scope_period,scope_district,v_activity_id,null,null);
  return result;
end $$;
create function public.set_course_meeting_substitute(
 p_activity_id text,p_meeting_date date,p_substitute_emp_id bigint
) returns table(meeting_date date,emp_id text,instructor_name text,recorded_at timestamptz)
language plpgsql as $$
declare
 v_activity public.activities;
 v_existing public.course_meeting_instructor_history;
 v_existing_found boolean:=false;
 v_previous_emp_id text;
 v_previous_instructor_name text;
 v_replaces_history boolean:=false;
 v_current_meeting_emp_id text;
 v_sub public.contacts_instructors;
begin
 select * into v_activity from public.activities where row_id=p_activity_id for update;
 if v_activity.emp_id is null then raise exception 'scheduling_no_existing_assignment';end if;
 if not exists(select 1 from jsonb_array_elements(
   public.scheduling_effective_meetings(v_activity, v_activity.emp_id)) item
   where item->>'date'=p_meeting_date::text)
 then raise exception 'scheduling_meeting_not_found'; end if;
 select * into v_sub from public.contacts_instructors ci where ci.emp_id=p_substitute_emp_id;
 if not found then raise exception 'instructor_not_found';end if;
  select *
    into v_existing
  from public.course_meeting_instructor_history h
  where h.activity_id=p_activity_id and h.meeting_date=p_meeting_date
  for update;
 v_existing_found:=found;
  if v_existing_found and v_existing.assignment_kind = 'single_meeting_substitution' then
   v_previous_emp_id:=coalesce(v_existing.previous_emp_id,v_activity.emp_id::text);
   v_previous_instructor_name:=coalesce(v_existing.previous_instructor_name,v_activity.instructor_name);
   v_replaces_history:=coalesce(v_existing.replaces_history,false);
   v_current_meeting_emp_id:=v_existing.emp_id;
 elsif v_existing_found then
   v_previous_emp_id:=v_existing.emp_id;
   v_previous_instructor_name:=v_existing.instructor_name;
   v_replaces_history:=true;
   v_current_meeting_emp_id:=v_existing.emp_id;
 else
   v_previous_emp_id:=v_activity.emp_id::text;
   v_previous_instructor_name:=v_activity.instructor_name;
   v_current_meeting_emp_id:=v_activity.emp_id::text;
 end if;
 if v_current_meeting_emp_id=p_substitute_emp_id::text then raise exception 'scheduling_substitute_already_assigned';end if;
 insert into public.course_meeting_instructor_history(
 activity_id,meeting_date,emp_id,instructor_name,assignment_kind,recorded_by,
 previous_emp_id,previous_instructor_name,replaces_history)
 values (p_activity_id,p_meeting_date,p_substitute_emp_id::text,v_sub.full_name,
 'single_meeting_substitution',auth.uid(),v_previous_emp_id,v_previous_instructor_name,v_replaces_history)
 on conflict on constraint course_meeting_instructor_history_activity_id_meeting_date_key do update set
 emp_id=excluded.emp_id,instructor_name=excluded.instructor_name,
 assignment_kind='single_meeting_substitution',
 previous_emp_id=excluded.previous_emp_id,
 previous_instructor_name=excluded.previous_instructor_name,
 replaces_history=excluded.replaces_history;
  return query
  select h.meeting_date, h.emp_id, h.instructor_name, h.recorded_at
  from public.course_meeting_instructor_history h where h.activity_id=p_activity_id and h.meeting_date=p_meeting_date;
end $$;
create function public.clear_course_meeting_substitute(p_activity_id text,p_meeting_date date)
returns boolean language plpgsql as $$
declare
  v_activity public.activities;
  v_existing public.course_meeting_instructor_history;
  v_restore_history boolean;
begin
  select * into v_activity from public.activities where row_id=p_activity_id for update;
  select * into v_existing from public.course_meeting_instructor_history
    where activity_id=p_activity_id and meeting_date=p_meeting_date and assignment_kind='single_meeting_substitution'
    for update;
  if not found then return false; end if;
  v_restore_history := coalesce(v_existing.replaces_history,false);
  if v_restore_history then
    update public.course_meeting_instructor_history
      set emp_id=v_existing.previous_emp_id,instructor_name=v_existing.previous_instructor_name,
      assignment_kind='history'
    where id=v_existing.id;
  else
    delete from public.course_meeting_instructor_history where id=v_existing.id;
  end if;
  return true;
end $$;
create function public.scheduling_locked_course_validation_reason(p_activity_id text)
returns text language plpgsql as $$
declare violations text[];
begin
 violations:=public.scheduling_course_instructor_violations(p_activity_id,
   (select emp_id from public.activities where row_id=p_activity_id),false);
  if coalesce(array_length(violations, 1), 0) = 0 then return null; end if;
  return violations[1];
end $$;

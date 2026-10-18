-- Disposable Postgres fixture only. No production data, tokens or secrets.
create extension if not exists pgcrypto;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid',true),'')::uuid
$$;
create table public.users(auth_user_id uuid primary key,is_active boolean not null);
create table public.contacts_instructors(emp_id bigint primary key,full_name text,active text);
create table public.activities(
 row_id text primary key,
 sessions text,
 school_id bigint default 1,
 school text default 'Test school',
 authority text default 'Test city',
 activity_name text default 'Space Technologies',
 activity_no text default 'ST',
 grade text, class_group text,
 activity_season text default 'school_2027',
 activity_type text default 'course',
 status text default 'פתוח',
 emp_id bigint,emp_id_2 text,
 instructor_name text,instructor_assignment_locked boolean default false,
 instructor_assignment_status text,
 draft_emp_id text,draft_instructor_name text,draft_created_at timestamptz,
 draft_created_by uuid,draft_proposed_meetings jsonb,
 start_time time default '12:00',end_time time default '14:00',
 start_date date,end_date date,
 updated_at timestamptz default clock_timestamp(),
 date_1 date,date_2 date,date_3 date,date_4 date,date_5 date,
 date_6 date,date_7 date,date_8 date,date_9 date,date_10 date,
 date_11 date,date_12 date,date_13 date,date_14 date,date_15 date,
 date_16 date,date_17 date,date_18 date,date_19 date,date_20 date,
 date_21 date,date_22 date,date_23 date,date_24 date,date_25 date,
 date_26 date,date_27 date,date_28 date,date_29 date,date_30 date,
 date_31 date,date_32 date,date_33 date,date_34 date,date_35 date
);
create table public.school_calendar(
 start_date date,end_date date,is_active boolean,blocks_scheduling boolean,calendar_sector text
);
create table public.test_guard(
 activity_id text primary key references public.activities(row_id),
 fail_code text,approval_status text default 'approved'
);
create table public.scheduling_planning_workspaces(id uuid,period_key text,district text,revision bigint);
create table public.scheduling_planning_rows(workspace_id uuid,activity_id text,needs_recalc boolean,row_data jsonb);
create table public.scheduling_planning_source_state(singleton boolean,revision bigint);
create function public.app_current_role() returns text language sql stable as $$
 select coalesce(current_setting('test.role',true),'admin')
$$;
create function public.app_has_permission(name text) returns boolean language sql stable as $$
 select auth.uid() is not null and name='view_operations_scheduling'
$$;
create function public.scheduling_agent_team_assert_member() returns void language plpgsql as $$
begin
 if auth.uid() is null or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active)
 then raise exception 'scheduling_permission_denied'; end if;
end $$;
create function public.scheduling_agent_team_planning_status() returns jsonb language sql stable as $$
 select '{"planningCurrent":false}'::jsonb
$$;
create function public.school_calendar_sector_for_school_id(school_id bigint) returns text language sql stable as $$
 select 'jewish'::text
$$;
create function public.school_calendar_activity_exception_exists(p_id text,p_day date) returns boolean language sql stable as $$
 select false
$$;
create function public.school_calendar_event_applies(a text,b text) returns boolean language sql stable as $$
 select a=b
$$;
create function public.scheduling_effective_end_time(p_id text,p_date date,p_default time) returns time language sql stable as $$
 select p_default
$$;
create function public.scheduling_lock_instructor_for_write(p_emp_id bigint) returns void language plpgsql as $$
begin if p_emp_id is null or p_emp_id<1 then raise exception 'instructor_not_found'; end if; end $$;
create function public.course_assignment_manager_approval_state(p_id text) returns jsonb language sql stable as $$
 select jsonb_build_object('approval_required',true,
   'request_status',coalesce((select g.approval_status from public.test_guard g
                             where g.activity_id=p_id),'pending'))
$$;
create function public.scheduling_agent_team_draft_policy_applies(p_id text,p_emp bigint) returns boolean language sql stable as $$
 select false
$$;
create function public.scheduling_agent_team_draft_approval_details(p_id text,p_emp bigint) returns jsonb language sql stable as $$
 select '{"blocking_violations":[]}'::jsonb
$$;
-- These two existing server functions are fixture-level stubs, not bypasses
-- installed into production. They force real failure/rollback after date writes.
create function public.scheduling_set_activity_meetings(p_id text,p_meetings jsonb)
 returns public.activities language plpgsql as $$
declare idx integer:=1; m jsonb; result public.activities; first_date date; last_date date;
begin
 for m in select value from jsonb_array_elements(p_meetings) loop
   execute format('update public.activities set date_%s=$1 where row_id=$2',idx)
     using (m->>'date')::date,p_id;
   first_date:=coalesce(first_date,(m->>'date')::date);
   last_date:=(m->>'date')::date;
   idx:=idx+1;
 end loop;
 while idx<=35 loop
  execute format('update public.activities set date_%s=null where row_id=$1',idx) using p_id;
  idx:=idx+1;
 end loop;
 update public.activities set start_date=first_date,end_date=last_date,
   updated_at=clock_timestamp() where row_id=p_id returning * into result;
 return result;
end $$;
create function public.assign_activity_instructor(
 p_id text,p_emp bigint,p_name text,p_top bigint,p_score integer,
 p_top_score integer,p_decision text,p_reason text default null
) returns public.activities language plpgsql as $$
declare result public.activities; code text;
begin
 select * into result from public.activities where row_id=p_id for update;
 if result.emp_id is not null or result.instructor_assignment_locked
 then raise exception 'scheduling_assignment_locked'; end if;
 select g.fail_code into code from public.test_guard g where g.activity_id=p_id;
 if code is not null then raise exception '%',code; end if;
 update public.activities set emp_id=p_emp,instructor_name=p_name,
   instructor_assignment_locked=true,instructor_assignment_status='שובץ',
   draft_emp_id=null,draft_instructor_name=null,draft_created_at=null,
   draft_created_by=null,updated_at=clock_timestamp()
 where row_id=p_id returning * into result;
 return result;
end $$;

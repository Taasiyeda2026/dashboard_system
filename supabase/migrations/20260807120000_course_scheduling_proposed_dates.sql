-- Store proposed meeting dates separately from official activity dates and apply them atomically on approval.
alter table public.activities add column if not exists draft_proposed_meetings jsonb;
comment on column public.activities.draft_proposed_meetings is 'Ordered proposed meeting rows [{date,start_time,end_time}] held by a scheduling draft; official dates remain unchanged until approval.';

create or replace function public.scheduling_set_activity_meetings(p_activity_id text, p_meetings jsonb)
returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; item jsonb; idx integer := 1; first_date date; last_date date;
begin
  if jsonb_typeof(p_meetings) <> 'array' or jsonb_array_length(p_meetings) = 0 or jsonb_array_length(p_meetings) > 35 then raise exception 'scheduling_proposed_dates_invalid'; end if;
  for item in select value from jsonb_array_elements(p_meetings) loop
    if nullif(item->>'date','') is null then raise exception 'scheduling_proposed_dates_invalid'; end if;
    if extract(dow from (item->>'date')::date) = 6 then raise exception 'scheduling_saturday_blocked'; end if;
    if exists (select 1 from public.school_calendar c where c.is_active and c.blocks_scheduling and (item->>'date')::date between c.start_date and coalesce(c.end_date,c.start_date)) then
      raise exception 'scheduling_school_calendar_blocked';
    end if;
    if last_date is not null and (item->>'date')::date <= last_date then raise exception 'scheduling_proposed_dates_invalid'; end if;
    execute format('update public.activities set date_%s=$1 where row_id=$2', idx) using (item->>'date')::date, p_activity_id;
    first_date := coalesce(first_date, (item->>'date')::date); last_date := (item->>'date')::date; idx := idx + 1;
  end loop;
  while idx <= 35 loop execute format('update public.activities set date_%s=null where row_id=$1', idx) using p_activity_id; idx := idx + 1; end loop;
  update public.activities set start_date=first_date, end_date=last_date where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.scheduling_set_activity_meetings(text,jsonb) from public;

create or replace function public.scheduling_assert_proposed_draft_conflicts(p_activity_id text, p_emp_id bigint, p_meetings jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare meeting jsonb;
begin
  for meeting in select value from jsonb_array_elements(p_meetings) loop
    if exists (
      select 1 from public.activities a, lateral jsonb_array_elements(coalesce(a.draft_proposed_meetings,'[]'::jsonb)) proposed
      where a.row_id <> p_activity_id and a.draft_emp_id=p_emp_id::text
        and proposed->>'date'=meeting->>'date'
        and coalesce((proposed->>'start_time')::time,a.start_time) < coalesce((meeting->>'end_time')::time,'23:59'::time)
        and coalesce((meeting->>'start_time')::time,'00:00'::time) < coalesce((proposed->>'end_time')::time,a.end_time)
    ) then raise exception 'scheduling_conflict_detected'; end if;
  end loop;
end $$;
revoke all on function public.scheduling_assert_proposed_draft_conflicts(text,bigint,jsonb) from public;

create or replace function public.save_course_assignment_draft_with_dates(
  p_activity_id text, p_emp_id bigint, p_instructor_name text, p_proposed_meetings jsonb,
  p_top_emp_id bigint default null, p_selected_score integer default null, p_top_score integer default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare original public.activities; result public.activities; original_meetings jsonb;
begin
  select * into original from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  select jsonb_agg(jsonb_build_object('date',to_jsonb(original)->>('date_'||n),'start_time',original.start_time,'end_time',original.end_time) order by n)
    into original_meetings from generate_series(1,35)n where nullif(to_jsonb(original)->>('date_'||n),'') is not null;
  perform public.scheduling_assert_proposed_draft_conflicts(p_activity_id,p_emp_id,p_proposed_meetings);
  perform public.scheduling_set_activity_meetings(p_activity_id,p_proposed_meetings);
  result := public.save_course_assignment_draft(p_activity_id,p_emp_id,p_instructor_name,p_top_emp_id,p_selected_score,p_top_score);
  perform public.scheduling_set_activity_meetings(p_activity_id,original_meetings);
  update public.activities set draft_proposed_meetings=p_proposed_meetings where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) to authenticated;

create or replace function public.assign_activity_instructor_with_dates(
  p_activity_id text, p_emp_id bigint, p_instructor_name text, p_proposed_meetings jsonb,
  p_top_emp_id bigint default null, p_selected_score integer default null, p_top_score integer default null,
  p_decision_type text default 'approved', p_reason text default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities;
begin
  perform 1 from public.activities where row_id=p_activity_id for update;
  perform public.scheduling_set_activity_meetings(p_activity_id,p_proposed_meetings);
  result := public.assign_activity_instructor(p_activity_id,p_emp_id,p_instructor_name,p_top_emp_id,p_selected_score,p_top_score,p_decision_type,p_reason);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) to authenticated;

create or replace function public.cancel_course_assignment_draft_with_dates(p_activity_id text)
returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities;
begin
  result := public.cancel_course_assignment_draft(p_activity_id);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.cancel_course_assignment_draft_with_dates(text) from public;
grant execute on function public.cancel_course_assignment_draft_with_dates(text) to authenticated;

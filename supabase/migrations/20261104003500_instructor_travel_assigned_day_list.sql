-- Return only this instructor's assigned or already-reported physical work days.
-- The UI presents these dates as a selection list, not as an editable calendar.
create or replace function public.av2_list_instructor_travel_days(
  p_from date default null, p_to date default null
) returns jsonb language plpgsql stable security definer
set search_path=public as $fn$
declare v_emp bigint; v_result jsonb; v_from date; v_to date;
begin
  select u.emp_id::bigint into v_emp from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true and u.role='instructor'
  limit 1;
  if v_emp is null then
    raise exception 'attendance_travel_instructor_required' using errcode='42501';
  end if;
  v_to:=least(coalesce(p_to,current_date),current_date);
  v_from:=greatest(coalesce(p_from,v_to - interval '62 days')::date,date '2026-11-04');
  if v_to < v_from or v_to > v_from+interval '125 days' then
    raise exception 'attendance_travel_day_range_invalid' using errcode='22023';
  end if;
  with assigned as (
    select distinct chosen.travel_date, a.activity_name as label
    from public.activities a
    cross join lateral (values
        (a.date_1),
        (a.date_2),
        (a.date_3),
        (a.date_4),
        (a.date_5),
        (a.date_6),
        (a.date_7),
        (a.date_8),
        (a.date_9),
        (a.date_10),
        (a.date_11),
        (a.date_12),
        (a.date_13),
        (a.date_14),
        (a.date_15),
        (a.date_16),
        (a.date_17),
        (a.date_18),
        (a.date_19),
        (a.date_20),
        (a.date_21),
        (a.date_22),
        (a.date_23),
        (a.date_24),
        (a.date_25),
        (a.date_26),
        (a.date_27),
        (a.date_28),
        (a.date_29),
        (a.date_30),
        (a.date_31),
        (a.date_32),
        (a.date_33),
        (a.date_34),
        (a.date_35)
    ) chosen(travel_date)
    where (a.emp_id=v_emp or a.emp_id_2=v_emp::text)
      and chosen.travel_date between v_from and v_to
      and coalesce(a.activity_type,'') not in ('זום','ביטול זמן')
  ), recorded as (
    select ar.report_date travel_date,
      count(*)::integer physical_count,
      string_agg(distinct coalesce(nullif(ar.school_name_snapshot,''),nullif(ar.activity_name_snapshot,''),'פעילות'),', ') labels
    from public.attendance_records ar
    where ar.emp_id=v_emp and ar.report_date between v_from and v_to
      and ar.generation_kind is null
      and ar.activity_type not in ('זום','ביטול זמן')
      and coalesce(ar.training_mode::text,'physical')<>'online'
      and coalesce(ar.operation_meeting_mode,'physical')<>'online'
    group by ar.report_date
  ), days as (
    select travel_date from assigned
    union
    select travel_date from recorded
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'date', d.travel_date,
    'activity_count',coalesce(r.physical_count,0),
    'activities',coalesce(r.labels,(
      select string_agg(distinct nullif(btrim(a.label),''),', ') from assigned a
      where a.travel_date=d.travel_date
    ),'פעילות משויכת'),
    'ready',coalesce(r.physical_count,0)>0,
    'review_status',coalesce(t.review_status,'missing'),
    'no_travel',coalesce(t.no_travel,false)
  ) order by d.travel_date desc),'[]'::jsonb) into v_result
  from days d
  left join recorded r on r.travel_date=d.travel_date
  left join public.attendance_daily_travel_reports t
    on t.emp_id=v_emp and t.travel_date=d.travel_date;
  return coalesce(v_result,'[]'::jsonb);
end $fn$;
revoke all on function public.av2_list_instructor_travel_days(date,date) from public,anon;
grant execute on function public.av2_list_instructor_travel_days(date,date) to authenticated;

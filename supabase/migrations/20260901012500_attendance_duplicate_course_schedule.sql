create or replace function public.av2_get_activity_meeting_dates(
  p_emp_id bigint,
  p_activity_row_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current_emp_id bigint;
  v_result jsonb;
begin
  select u.emp_id::bigint
    into v_current_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;

  if v_current_emp_id is null or v_current_emp_id <> p_emp_id then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'meeting_no', meeting_row.meeting_no,
        'date', to_char(meeting_row.meeting_date, 'YYYY-MM-DD')
      )
      order by meeting_row.meeting_no
    ),
    '[]'::jsonb
  )
  into v_result
  from public.activities a
  cross join lateral (
    values
      (1, a.date_1),(2, a.date_2),(3, a.date_3),(4, a.date_4),(5, a.date_5),
      (6, a.date_6),(7, a.date_7),(8, a.date_8),(9, a.date_9),(10, a.date_10),
      (11, a.date_11),(12, a.date_12),(13, a.date_13),(14, a.date_14),(15, a.date_15),
      (16, a.date_16),(17, a.date_17),(18, a.date_18),(19, a.date_19),(20, a.date_20),
      (21, a.date_21),(22, a.date_22),(23, a.date_23),(24, a.date_24),(25, a.date_25),
      (26, a.date_26),(27, a.date_27),(28, a.date_28),(29, a.date_29),(30, a.date_30),
      (31, a.date_31),(32, a.date_32),(33, a.date_33),(34, a.date_34),(35, a.date_35)
  ) as meeting_row(meeting_no, meeting_date)
  where a.row_id = trim(coalesce(p_activity_row_id, ''))
    and (
      a.emp_id = p_emp_id
      or btrim(coalesce(a.emp_id_2, '')) = p_emp_id::text
    )
    and meeting_row.meeting_date is not null;

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_activity_meeting_dates(bigint, text) from public, anon;
grant execute on function public.av2_get_activity_meeting_dates(bigint, text) to authenticated;

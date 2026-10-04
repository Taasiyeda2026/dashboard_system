-- Attendance course picker: resolve the instructor's exact dashboard rows for a date
-- and expose grade/class_group only as disambiguation metadata in the existing picker.

create or replace function public.av2_get_current_instructor_activity_choices_for_date(
  p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_rows jsonb;
  v_result jsonb;
begin
  if p_date is null then
    return '[]'::jsonb;
  end if;

  select u.emp_id::bigint
    into v_emp_id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
    and u.role = 'instructor'
  limit 1;

  if v_emp_id is null then
    return '[]'::jsonb;
  end if;

  -- Reuse the existing date-specific attendance RPC so substitutions, cancellations
  -- and meeting ownership remain governed by the same source of truth.
  v_rows := public.av2_get_instructor_activities_for_date(v_emp_id, p_date);

  select coalesce(
    jsonb_agg(
      item || jsonb_build_object(
        'grade', a.grade,
        'class_group', a.class_group
      )
      order by
        coalesce(item->>'start_time', ''),
        coalesce(item->>'activity_name', ''),
        coalesce(item->>'row_id', '')
    ),
    '[]'::jsonb
  )
  into v_result
  from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) as item
  left join public.activities a
    on a.row_id = item->>'row_id';

  return coalesce(v_result, '[]'::jsonb);
end
$$;

revoke all on function public.av2_get_current_instructor_activity_choices_for_date(date) from public, anon;
grant execute on function public.av2_get_current_instructor_activity_choices_for_date(date) to authenticated;

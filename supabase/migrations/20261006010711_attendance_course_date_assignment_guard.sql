-- Enforce course ownership at write time using the existing dashboard date RPC.
-- No policies/grants are widened; other report types and back-office writes are unchanged.
create or replace function public.av2_guard_course_date_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_role text;
  v_expected jsonb;
begin
  if new.activity_type not in ('קורס', 'course') or new.generation_kind is not null then
    return new;
  end if;

  select u.emp_id::bigint, u.role into v_emp_id, v_role
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  -- Existing RLS continues to govern manager/admin, service and unauthenticated writes.
  if v_role is distinct from 'instructor' then
    return new;
  end if;

  -- Expense/notes/travel corrections do not alter the dashboard assignment.
  if tg_op = 'UPDATE' then
    if old.emp_id is not distinct from new.emp_id
       and old.report_date is not distinct from new.report_date
       and old.activity_row_id is not distinct from new.activity_row_id
       and old.activity_type is not distinct from new.activity_type
       and old.school_id is not distinct from new.school_id
       and old.authority_id is not distinct from new.authority_id then
      return new;
    end if;
  end if;

  if new.emp_id is distinct from v_emp_id then
    raise exception using errcode = '42501', message = 'לא ניתן לדווח קורס עבור מדריך אחר';
  end if;

  select item into v_expected
  from jsonb_array_elements(public.av2_get_current_instructor_activity_choices_for_date(new.report_date)) item
  where item->>'row_id' = btrim(coalesce(new.activity_row_id, ''))
    and lower(btrim(item->>'activity_type')) in ('course', 'קורס');

  if v_expected is null then
    raise exception using errcode = '42501', message = 'הקורס אינו משויך למדריך בתאריך המדווח בדשבורד';
  end if;

  if nullif(v_expected->>'single_school_id', '') is not null then
    if new.school_id is distinct from (v_expected->>'single_school_id')::bigint then
      raise exception using errcode = '42501', message = 'בית הספר אינו תואם לפעילות בדשבורד';
    end if;
  elsif jsonb_array_length(coalesce(nullif(v_expected->'linked_schools_json', 'null'::jsonb), '[]'::jsonb)) > 0 then
    if not exists (
      select 1 from jsonb_array_elements(v_expected->'linked_schools_json') school
      where (school->>'id')::bigint = new.school_id
    ) then
      raise exception using errcode = '42501', message = 'בית הספר אינו תואם לפעילות בדשבורד';
    end if;
  end if;

  if new.authority_id is distinct from nullif(v_expected->>'authority_id', '')::bigint then
    raise exception using errcode = '42501', message = 'הרשות אינה תואמת לפעילות בדשבורד';
  end if;
  return new;
end
$$;

-- Trigger functions need no direct API EXECUTE permission.
revoke all on function public.av2_guard_course_date_assignment() from public, anon, authenticated;
drop trigger if exists av2_guard_course_date_assignment on public.attendance_records;
create trigger av2_guard_course_date_assignment
before insert or update on public.attendance_records
for each row execute function public.av2_guard_course_date_assignment();

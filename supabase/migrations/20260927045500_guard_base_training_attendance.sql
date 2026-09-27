-- Base training was held only on 15-17 September 2026.
-- Keep this rule server-side so stale clients cannot create another base-training report.

create or replace function public.av2_guard_base_training_attendance()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_is_base_training boolean;
begin
  v_is_base_training :=
    trim(coalesce(new.activity_name_snapshot, '')) = 'הכשרת בסיס'
    or trim(coalesce(new.program_name_snapshot, '')) = 'הכשרת בסיס'
    or trim(coalesce(new.program_name, '')) = 'הכשרת בסיס';

  if v_is_base_training
     and (
       new.report_date is null
       or new.report_date < date '2026-09-15'
       or new.report_date > date '2026-09-17'
     )
  then
    raise exception using
      errcode = '23514',
      message = 'base_training_date_not_allowed',
      detail = 'Base training attendance is restricted to 2026-09-15 through 2026-09-17.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_attendance_records_guard_base_training on public.attendance_records;

create trigger trg_attendance_records_guard_base_training
before insert or update of report_date, activity_type, activity_name_snapshot, program_name, program_name_snapshot
on public.attendance_records
for each row
execute function public.av2_guard_base_training_attendance();

create unique index if not exists attendance_records_base_training_emp_date_unique
on public.attendance_records (emp_id, report_date)
where
  trim(coalesce(activity_name_snapshot, '')) = 'הכשרת בסיס'
  or trim(coalesce(program_name_snapshot, '')) = 'הכשרת בסיס'
  or trim(coalesce(program_name, '')) = 'הכשרת בסיס';

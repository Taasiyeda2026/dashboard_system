create or replace function attendance_private.sync_course_paid_hours()
returns trigger language plpgsql set search_path = public, attendance_private as $$
declare s jsonb; paid jsonb; month_state record;
begin
  if new.activity_type <> 'קורס' or new.generation_kind is not null
     or jsonb_typeof(new.course_dashboard_sources) is distinct from 'array'
     or jsonb_array_length(new.course_dashboard_sources) <> 1 then return new; end if;
  s := new.course_dashboard_sources->0;
  if s->>'activity_type' <> 'course'
    or s->>'report_date' is distinct from new.report_date::text
    or s->>'resolved_emp_id' is distinct from new.emp_id::text
    or coalesce(s->>'start_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or coalesce(s->>'end_time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    then return new; end if;
  paid := attendance_private.course_work(new.course_dashboard_sources);
  if paid is null or (paid->>'paid_minutes')::int <> 120 then return new; end if;
  if tg_op = 'UPDATE' and exists
    (select 1 from public.attendance_manager_record_reviews v where v.record_id=new.id and v.status='approved') then return new; end if;
  if exists (select 1 from public.attendance_month_approvals a
    where a.emp_id=new.emp_id and a.month_key=to_char(new.report_date,'YYYY-MM')
      and (a.manager_approved_at is not null or a.status='locked')) then return new; end if;
  new.total_hours := 2;
  return new;
end $$;

drop trigger if exists trg_attendance_course_paid_hours on public.attendance_records;
create trigger trg_attendance_course_paid_hours
before insert or update of total_hours, course_dashboard_sources, start_time, end_time, report_date on public.attendance_records
for each row execute function attendance_private.sync_course_paid_hours();

update public.attendance_records r
set total_hours=2
where r.activity_type='קורס' and r.generation_kind is null
 and jsonb_typeof(r.course_dashboard_sources)='array'
 and jsonb_array_length(r.course_dashboard_sources)=1
 and (r.course_dashboard_sources->0->>'report_date')=r.report_date::text
 and (r.course_dashboard_sources->0->>'activity_type')='course'
 and (r.course_dashboard_sources->0->>'resolved_emp_id')=r.emp_id::text
 and (r.course_dashboard_sources->0->>'start_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and (r.course_dashboard_sources->0->>'end_time') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
 and (attendance_private.course_work(r.course_dashboard_sources)->>'paid_minutes')::int=120
 and r.total_hours is distinct from 2
 and not exists (select 1 from public.attendance_manager_record_reviews v where v.record_id=r.id and v.status='approved')
 and not exists (select 1 from public.attendance_month_approvals a where a.emp_id=r.emp_id
   and a.month_key=to_char(r.report_date,'YYYY-MM')
   and (a.manager_approved_at is not null or a.status='locked'));
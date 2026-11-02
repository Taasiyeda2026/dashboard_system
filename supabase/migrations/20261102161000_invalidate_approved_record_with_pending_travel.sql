-- A record approval is valid only while every linked travel cancellation is resolved.
-- Also correct historical records approved before the guard was introduced.
create or replace function public.invalidate_attendance_record_review_for_open_travel()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.review_status in ('awaiting_report','pending_review','auto_matched') then
    delete from public.attendance_manager_record_reviews
    where record_id = new.source_attendance_record_id;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_attendance_travel_invalidates_record_review on public.attendance_travel_compensations;
create trigger trg_attendance_travel_invalidates_record_review
after insert or update of review_status, source_attendance_record_id
on public.attendance_travel_compensations
for each row execute function public.invalidate_attendance_record_review_for_open_travel();
delete from public.attendance_manager_record_reviews r
using public.attendance_travel_compensations tc
where r.record_id = tc.source_attendance_record_id
  and tc.review_status in ('awaiting_report','pending_review','auto_matched');

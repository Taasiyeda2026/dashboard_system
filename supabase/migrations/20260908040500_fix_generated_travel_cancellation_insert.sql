-- Allow only trusted, server-generated travel-cancellation attendance rows to bypass
-- the normal auth.uid() emp_id rewrite. The reconciliation RPC sets this transaction-
-- local flag before inserting/upserting the generated child row.
create or replace function public.av2_attendance_record_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_emp_id bigint;
  v_internal_compensation_write boolean := coalesce(current_setting('app.av2_compensation_write', true), '') = '1';
begin
  if v_internal_compensation_write
     and new.generation_kind = 'travel_time_cancellation'
     and new.source_attendance_record_id is not null then
    if new.emp_id is null or not exists (
      select 1
      from public.attendance_records source_row
      where source_row.id = new.source_attendance_record_id
        and source_row.emp_id = new.emp_id
        and source_row.generation_kind is null
    ) then
      raise exception 'Invalid generated travel cancellation source';
    end if;
    return new;
  end if;

  -- Normal instructor-created rows keep the original server-side protection:
  -- emp_id always comes from the authenticated user and never from frontend input.
  select emp_id::bigint
    into v_emp_id
  from public.users
  where auth_user_id = auth.uid()
  limit 1;

  if v_emp_id is null then
    raise exception 'No authenticated user or missing users mapping';
  end if;

  new.emp_id := v_emp_id;
  return new;
end;
$$;

grant execute on function public.av2_attendance_record_before_insert() to authenticated;

-- Scheduling exception approvals are reviewed by admins only.
-- Operation managers keep the separate submit/status RPCs used from the scheduling screen.
create or replace function public.course_assignment_manager_approval_requests()
returns setof public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.app_current_role();
begin
  if caller_role is distinct from 'admin'
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;

  return query
  select er.*
  from public.edit_requests er
  where er.request_type='course_assignment_exception'
    and er.status='pending'
    and coalesce(er.active, 'yes')<>'no'
  order by er.created_at desc, er.id desc;
end
$$;

revoke all on function public.course_assignment_manager_approval_requests() from public;
grant execute on function public.course_assignment_manager_approval_requests() to authenticated;

create or replace function public.review_course_assignment_manager_approval(
  p_request_id text,
  p_status text
) returns public.edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.app_current_role();
  request_row public.edit_requests;
  target public.activities;
  reviewer_id text := public.app_current_user_id();
  reviewer_name text;
  hard_violations text[];
  next_status text := btrim(coalesce(p_status, ''));
begin
  if caller_role is distinct from 'admin'
    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)
  then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if next_status not in ('approved','rejected') then raise exception 'invalid_review_status'; end if;

  select * into request_row
  from public.edit_requests
  where request_id=p_request_id and request_type='course_assignment_exception'
  for update;
  if not found then raise exception 'edit_request_not_found'; end if;
  if request_row.status<>'pending' then raise exception 'edit_request_already_reviewed'; end if;

  select * into target
  from public.activities
  where row_id=request_row.source_row_id
  for update;

  if not found
    or nullif(btrim(coalesce(target.draft_emp_id,'')),'') is null
    or target.draft_created_at is null
    or target.draft_emp_id<>coalesce(request_row.requested_payload->>'draft_emp_id','')
    or target.draft_created_at<>nullif(request_row.requested_payload->>'draft_created_at','')::timestamptz
  then
    update public.edit_requests
    set status='conflict',
        reviewer_user_id=reviewer_id,
        reviewed_by=reviewer_id,
        reviewed_at=to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        review_note='הטיוטה השתנתה או בוטלה לאחר שליחת הבקשה'
    where id=request_row.id
    returning * into request_row;
    return request_row;
  end if;

  if next_status='approved' then
    hard_violations := public.scheduling_manual_assignment_hard_violations(target.row_id, target.draft_emp_id::bigint);
    if coalesce(array_length(hard_violations,1),0)>0 then
      raise exception '%', hard_violations[1];
    end if;
  end if;

  select coalesce(nullif(btrim(u.full_name),''), nullif(btrim(u.name),''), nullif(btrim(u.email),''), reviewer_id)
  into reviewer_name
  from public.users u
  where u.auth_user_id=auth.uid()
  limit 1;

  update public.edit_requests
  set status=next_status,
      reviewer_user_id=reviewer_id,
      reviewed_by=coalesce(reviewer_name, reviewer_id),
      reviewed_at=to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  where id=request_row.id
  returning * into request_row;

  return request_row;
end
$$;

revoke all on function public.review_course_assignment_manager_approval(text,text) from public;
grant execute on function public.review_course_assignment_manager_approval(text,text) to authenticated;

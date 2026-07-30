-- Corrective hardening for environments where the original migration may already have run.
alter table public.activities
  add column if not exists instructor_assignment_locked boolean not null default false,
  add column if not exists instructor_assignment_status text;

alter table public.activities drop constraint if exists activities_instructor_assignment_status_check;
alter table public.activities add constraint activities_instructor_assignment_status_check
  check (instructor_assignment_status is null or instructor_assignment_status in ('שובץ','נדרש טיפול'));

alter table public.instructor_assignment_audit
  add column if not exists previous_status text,
  add column if not exists new_status text;

drop policy if exists instructor_assignment_audit_read on public.instructor_assignment_audit;
drop policy if exists instructor_assignment_audit_authorized_read on public.instructor_assignment_audit;
create policy instructor_assignment_audit_authorized_read
  on public.instructor_assignment_audit for select to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

drop policy if exists scheduling_travel_cache_read on public.scheduling_travel_cache;
drop policy if exists scheduling_travel_cache_authorized_read on public.scheduling_travel_cache;
create policy scheduling_travel_cache_authorized_read
  on public.scheduling_travel_cache for select to authenticated
  using (public.app_current_role() = any (array['admin'::text, 'operation_manager'::text]));

-- Keep the existing RPC signature so deployed clients upgrade atomically.
create or replace function public.assign_activity_instructor(
  p_activity_id text, p_emp_id bigint, p_instructor_name text, p_top_emp_id bigint,
  p_selected_score integer, p_top_score integer, p_decision_type text, p_reason text default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; selected_instructor public.contacts_instructors; caller_role text := public.app_current_role(); prior_status text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;
  if (p_decision_type in ('overridden','exception_approved') or p_emp_id is distinct from p_top_emp_id) and nullif(btrim(p_reason),'') is null then raise exception 'scheduling_reason_required'; end if;
  select * into selected_instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text,'yes')) in ('no','false','0','לא פעיל') then raise exception 'instructor_inactive'; end if;
  if btrim(coalesce(selected_instructor.full_name,'')) <> btrim(coalesce(p_instructor_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season <> 'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text,''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null or nullif(btrim(coalesce(result.instructor_name,'')),'') is not null then raise exception 'scheduling_assignment_locked'; end if;
  if exists (select 1 from public.activities a where a.row_id<>p_activity_id and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text) and lower(coalesce(a.status::text,'')) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled') and exists (select 1 from generate_series(1,35) n where nullif(to_jsonb(a)->>('date_'||n),'')=any(array(select nullif(to_jsonb(result)->>('date_'||m),'') from generate_series(1,35) m)) and a.start_time<result.end_time and result.start_time<a.end_time)) then raise exception 'scheduling_conflict_detected'; end if;
  prior_status := result.instructor_assignment_status;
  update public.activities set emp_id=p_emp_id, instructor_name=selected_instructor.full_name, instructor_assignment_locked=true, instructor_assignment_status='שובץ' where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,top_recommended_emp_id,selected_score,top_score,decision_type,reason,previous_status,new_status)
  values(p_activity_id,p_emp_id::text,selected_instructor.full_name,p_top_emp_id::text,p_selected_score,p_top_score,p_decision_type,nullif(btrim(p_reason),''),prior_status,'שובץ');
  return result;
end $$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

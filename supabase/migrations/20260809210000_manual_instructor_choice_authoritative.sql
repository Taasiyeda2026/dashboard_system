-- Manual instructor choices are authoritative. Recommendation constraints remain
-- available for ranking, but do not block a persisted decision by admin or operation_manager.
-- This migration is data-free and preserves recommendation/audit metadata.

-- The before-write identity guard continues to synchronize assignment state. The
-- former after-write validator rejected manual activity edits for availability,
-- travel, or recommendation constraints, contrary to the admin/operation_manager override policy.
drop trigger if exists activities_validate_direct_assignment_after_write on public.activities;

create or replace function public.scheduling_clear_draft_on_manual_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.app_current_role() not in ('admin', 'operation_manager') then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;
  new.draft_emp_id := null;
  new.draft_instructor_name := null;
  new.draft_created_at := null;
  new.draft_created_by := null;
  new.draft_proposed_meetings := null;
  return new;
end
$$;

revoke all on function public.scheduling_clear_draft_on_manual_assignment() from public;

drop trigger if exists aaa_activities_clear_draft_on_manual_assignment on public.activities;
create trigger aaa_activities_clear_draft_on_manual_assignment
before update of emp_id, emp_id_2, instructor_name, instructor_name_2
on public.activities
for each row
when (
  old.emp_id is distinct from new.emp_id
  or old.emp_id_2 is distinct from new.emp_id_2
  or old.instructor_name is distinct from new.instructor_name
  or old.instructor_name_2 is distinct from new.instructor_name_2
)
execute function public.scheduling_clear_draft_on_manual_assignment();

create or replace function public.assign_activity_instructor(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
  final_status text;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);

  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  prior_status := result.instructor_assignment_status;
  final_status := 'שובץ';

  update public.activities
  set emp_id = p_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = final_status,
      draft_emp_id = null,
      draft_instructor_name = null,
      draft_created_at = null,
      draft_created_by = null
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status,
    bypassed_constraints, meetings_completed_at_decision
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, final_status,
    '{}', 0
  );
  return result;
end
$$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

create or replace function public.reassign_locked_course_instructor(
  p_activity_id text,
  p_new_emp_id bigint,
  p_new_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
  prior_status text;
  prior_emp_id text;
  prior_instructor_name text;
  final_status text;
  meetings_done integer;
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(result.emp_id::text, '') is null then raise exception 'scheduling_no_existing_assignment'; end if;

  meetings_done := public.scheduling_course_meetings_completed(p_activity_id);
  perform public.scheduling_lock_instructor_for_write(p_new_emp_id);

  select * into selected_instructor from public.contacts_instructors where emp_id = p_new_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_new_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  prior_status := result.instructor_assignment_status;
  prior_emp_id := result.emp_id::text;
  prior_instructor_name := result.instructor_name;
  final_status := 'שובץ';

  update public.activities
  set emp_id = p_new_emp_id,
      instructor_name = selected_instructor.full_name,
      instructor_assignment_locked = true,
      instructor_assignment_status = final_status
  where row_id = p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status,
    bypassed_constraints, meetings_completed_at_decision, previous_emp_id, previous_instructor_name
  ) values (
    p_activity_id, p_new_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''), prior_status, final_status,
    '{}', meetings_done, prior_emp_id, prior_instructor_name
  );
  return result;
end
$$;
revoke all on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

-- Drafts persist the exact operational choice. Matching checks still run in the
-- recommendation engine, but are deliberately not write gates for these RPCs.
create or replace function public.save_course_assignment_draft(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint default null,
  p_selected_score integer default null,
  p_top_score integer default null
) returns public.activities
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into selected_instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name,''))<>btrim(coalesce(p_instructor_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text,''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null then raise exception 'scheduling_assignment_locked'; end if;
  if nullif(btrim(coalesce(result.draft_emp_id,'')),'') is not null then raise exception 'הקורס כבר נשמר כטיוטה'; end if;
  update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=selected_instructor.full_name,
    draft_created_at=now(),draft_created_by=auth.uid(),draft_proposed_meetings=null
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,top_recommended_emp_id,selected_score,top_score,decision_type,reason,previous_status,new_status)
  values(p_activity_id,p_emp_id::text,selected_instructor.full_name,p_top_emp_id::text,p_selected_score,p_top_score,'draft',null,result.instructor_assignment_status,result.instructor_assignment_status);
  return result;
end $$;
revoke all on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) to authenticated;

create or replace function public.save_course_assignment_draft_with_dates(
  p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,
  p_top_emp_id bigint default null,p_selected_score integer default null,p_top_score integer default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; selected_instructor public.contacts_instructors; canonical jsonb; caller_role text:=public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  select * into selected_instructor from public.contacts_instructors where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if btrim(coalesce(selected_instructor.full_name,''))<>btrim(coalesce(p_instructor_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into result from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if result.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(result.activity_type::text,''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(result.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  if result.instructor_assignment_locked or nullif(result.emp_id::text,'') is not null then raise exception 'scheduling_assignment_locked'; end if;
  if nullif(btrim(coalesce(result.draft_emp_id,'')),'') is not null then raise exception 'הקורס כבר נשמר כטיוטה'; end if;
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  update public.activities set draft_emp_id=p_emp_id::text,draft_instructor_name=selected_instructor.full_name,
    draft_created_at=now(),draft_created_by=auth.uid(),draft_proposed_meetings=canonical
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(activity_id,selected_emp_id,selected_instructor_name,top_recommended_emp_id,selected_score,top_score,decision_type,reason,previous_status,new_status)
  values(p_activity_id,p_emp_id::text,selected_instructor.full_name,p_top_emp_id::text,p_selected_score,p_top_score,'draft',null,result.instructor_assignment_status,result.instructor_assignment_status);
  return result;
end $$;
revoke all on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) to authenticated;

-- Proposed dates retain their existing structural validation, but instructor
-- recommendation constraints do not block final approval of the stored choice.
create or replace function public.assign_activity_instructor_with_dates(
  p_activity_id text,p_emp_id bigint,p_instructor_name text,p_proposed_meetings jsonb,
  p_top_emp_id bigint default null,p_selected_score integer default null,p_top_score integer default null,
  p_decision_type text default 'approved',p_reason text default null
) returns public.activities language plpgsql security definer set search_path=public as $$
declare result public.activities; target public.activities; canonical jsonb; caller_role text:=public.app_current_role();
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') or not exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  perform public.scheduling_lock_instructor_for_write(p_emp_id);
  select * into target from public.activities where row_id=p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if target.activity_season<>'school_2027' then raise exception 'scheduling_activity_not_school_2027'; end if;
  if lower(btrim(coalesce(target.activity_type::text,''))) not in ('קורס','course','program') then raise exception 'scheduling_activity_not_course'; end if;
  if lower(btrim(coalesce(target.status::text,''))) not in ('פתוח','open') then raise exception 'scheduling_activity_not_open'; end if;
  canonical:=public.scheduling_validate_proposed_meetings(p_activity_id,p_proposed_meetings);
  perform public.scheduling_set_activity_meetings(p_activity_id,canonical);
  result:=public.assign_activity_instructor(p_activity_id,p_emp_id,p_instructor_name,p_top_emp_id,p_selected_score,p_top_score,p_decision_type,p_reason);
  update public.activities set draft_proposed_meetings=null where row_id=p_activity_id returning * into result;
  return result;
end $$;
revoke all on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor_with_dates(text,bigint,text,jsonb,bigint,integer,integer,text,text) to authenticated;

-- Revalidation may refresh warnings elsewhere, but an already persisted operational
-- choice remains approved. Unassigned courses continue through the recommendation engine.
create or replace function public.scheduling_apply_course_assignment_revalidation(
  p_activity_id text,
  p_change_reason text default 'activity_requirements_changed'
) returns text
language plpgsql
security definer
set search_path=public
as $$
declare target public.activities;
begin
  select * into target from public.activities where row_id=p_activity_id for update;
  if not found then return null; end if;
  if target.instructor_assignment_locked is true
    and (target.emp_id is not null or target.emp_id_2 is not null)
    and target.instructor_assignment_status is distinct from 'שובץ'
  then
    update public.activities set instructor_assignment_status='שובץ' where row_id=p_activity_id;
    return 'שובץ';
  end if;
  return target.instructor_assignment_status;
end $$;
revoke all on function public.scheduling_apply_course_assignment_revalidation(text,text) from public;

-- Keep identity and source-of-truth synchronization on every write, without turning
-- recommendation checks into write gates.
create or replace function public.scheduling_guard_activity_calendar_write()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare canonical_name text; official_assignment_changed boolean;
begin
  if new.activity_season is distinct from 'school_2027'
    or lower(btrim(coalesce(new.activity_type::text,''))) not in ('קורס','course','program')
  then return new; end if;

  official_assignment_changed := old.emp_id is distinct from new.emp_id
    or old.emp_id_2 is distinct from new.emp_id_2
    or old.instructor_name is distinct from new.instructor_name
    or old.instructor_name_2 is distinct from new.instructor_name_2;

  if new.emp_id is null then
    if nullif(btrim(coalesce(new.instructor_name,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select full_name into canonical_name from public.contacts_instructors where emp_id=new.emp_id;
    if not found then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;
  if new.emp_id_2 is null then
    if nullif(btrim(coalesce(new.instructor_name_2,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select full_name into canonical_name from public.contacts_instructors where emp_id=new.emp_id_2;
    if not found then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.instructor_name_2,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;
  if new.draft_emp_id is null then
    if nullif(btrim(coalesce(new.draft_instructor_name,'')),'') is not null then raise exception 'scheduling_instructor_identity_incomplete'; end if;
  else
    select full_name into canonical_name from public.contacts_instructors where emp_id=new.draft_emp_id::bigint;
    if not found then raise exception 'instructor_not_found'; end if;
    if btrim(coalesce(new.draft_instructor_name,''))<>btrim(coalesce(canonical_name,'')) then raise exception 'instructor_name_mismatch'; end if;
  end if;

  if official_assignment_changed then
    if new.emp_id is null and new.emp_id_2 is null then
      new.instructor_assignment_locked:=false;
      new.instructor_assignment_status:=null;
    else
      new.instructor_assignment_locked:=true;
      new.instructor_assignment_status:='שובץ';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.scheduling_guard_activity_calendar_write() from public;

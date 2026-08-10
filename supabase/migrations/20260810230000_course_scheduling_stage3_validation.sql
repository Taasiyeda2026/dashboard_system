-- Stage 3: Restore scheduling validation gates for Draft / Confirm / Final assign paths.
--
-- Admin override applies ONLY to post-edit activity changes (the edit is never blocked).
-- Draft save, draft confirmation, and final assignment must validate against fresh DB state
-- before writing.  If the instructor is no longer eligible at the moment the RPC is called,
-- the write is rejected — regardless of whether the instructor was eligible when the draft
-- was created.
--
-- Concretely:
--   • save_course_assignment_draft    – was stripped of violations in 20260809210000; restored.
--   • save_course_assignment_draft_with_dates – same; restored.
--   • assign_activity_instructor      – same; restored.
--   • reassign_locked_course_instructor – same; restored.
--   • scheduling_apply_course_assignment_revalidation – was made non-validating; restored
--     to produce 'נדרש טיפול' when scheduling_locked_course_validation_reason() returns a
--     non-null reason; emp_id / instructor_name are NEVER cleared.

-- ── 1. save_course_assignment_draft ──────────────────────────────────────────────────────

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
  violations text[];
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
  -- Fresh validation: reject the draft if the instructor is not currently eligible.
  -- p_expect_unassigned=false because we already verified the activity is unassigned above.
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, false);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  update public.activities
  set draft_emp_id=p_emp_id::text,
      draft_instructor_name=selected_instructor.full_name,
      draft_created_at=now(),
      draft_created_by=auth.uid(),
      draft_proposed_meetings=null
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, 'draft', null,
    result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end $$;
revoke all on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft(text,bigint,text,bigint,integer,integer) to authenticated;

-- ── 2. save_course_assignment_draft_with_dates ────────────────────────────────────────────

create or replace function public.save_course_assignment_draft_with_dates(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_proposed_meetings jsonb,
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
  canonical jsonb;
  caller_role text := public.app_current_role();
  violations text[];
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
  canonical := public.scheduling_validate_proposed_meetings(p_activity_id, p_proposed_meetings);
  -- Fresh validation using the proposed (canonical) meetings.
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, false);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;
  update public.activities
  set draft_emp_id=p_emp_id::text,
      draft_instructor_name=selected_instructor.full_name,
      draft_created_at=now(),
      draft_created_by=auth.uid(),
      draft_proposed_meetings=canonical
  where row_id=p_activity_id returning * into result;
  insert into public.instructor_assignment_audit(
    activity_id, selected_emp_id, selected_instructor_name, top_recommended_emp_id,
    selected_score, top_score, decision_type, reason, previous_status, new_status
  ) values (
    p_activity_id, p_emp_id::text, selected_instructor.full_name, p_top_emp_id::text,
    p_selected_score, p_top_score, 'draft', null,
    result.instructor_assignment_status, result.instructor_assignment_status
  );
  return result;
end $$;
revoke all on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) from public;
grant execute on function public.save_course_assignment_draft_with_dates(text,bigint,text,jsonb,bigint,integer,integer) to authenticated;

-- ── 3. assign_activity_instructor (confirm-draft + final assign) ─────────────────────────

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
  violations text[];
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

  -- Fresh validation at the moment of confirmation.
  -- p_expect_unassigned=true: also verifies the activity is not already locked/assigned,
  -- which prevents double-confirmation races (draft_emp_id is not part of this check).
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_emp_id, true);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

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
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''),
    prior_status, final_status,
    '{}', 0
  );
  return result;
end
$$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

-- ── 4. reassign_locked_course_instructor ─────────────────────────────────────────────────

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
  violations text[];
begin
  if caller_role is null or caller_role not in ('admin','operation_manager') then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if not exists (select 1 from public.users u where u.auth_user_id = auth.uid() and u.is_active is true) then raise exception 'scheduling_permission_denied' using errcode='42501'; end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then raise exception 'invalid_decision_type'; end if;

  select * into result from public.activities where row_id = p_activity_id for update;
  if not found then raise exception 'activity_not_found'; end if;
  if nullif(result.emp_id::text, '') is null then raise exception 'scheduling_no_existing_assignment'; end if;

  meetings_done := public.scheduling_course_meetings_completed(p_activity_id);
  if (p_decision_type in ('overridden','exception_approved') or p_new_emp_id is distinct from p_top_emp_id)
    and nullif(btrim(p_reason), '') is null
  then raise exception 'scheduling_reason_required'; end if;

  perform public.scheduling_lock_instructor_for_write(p_new_emp_id);

  select * into selected_instructor from public.contacts_instructors where emp_id = p_new_emp_id;
  if btrim(coalesce(selected_instructor.full_name, '')) <> btrim(coalesce(p_new_instructor_name, '')) then raise exception 'instructor_name_mismatch'; end if;

  -- Fresh validation for the new instructor.
  -- p_expect_unassigned=false: activity is locked (existing assignment), not unassigned.
  violations := public.scheduling_course_instructor_violations(p_activity_id, p_new_emp_id, false);
  if coalesce(array_length(violations, 1), 0) > 0 then
    raise exception '%', violations[1];
  end if;

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
    p_selected_score, p_top_score, p_decision_type, nullif(btrim(p_reason), ''),
    prior_status, final_status,
    '{}', meetings_done, prior_emp_id, prior_instructor_name
  );
  return result;
end
$$;
revoke all on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.reassign_locked_course_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

-- ── 5. scheduling_apply_course_assignment_revalidation ───────────────────────────────────
--
-- Restored to the full validating version.  Reads scheduling_locked_course_validation_reason()
-- which queries live tables (instructor_availability_rules, activities, etc.) so the result
-- always reflects current DB state, not the state at draft-creation time.
--
-- Post-edit policy (admin override): the activity edit is never blocked (AFTER trigger).
-- This function runs after the edit is committed.  It may change instructor_assignment_status
-- to 'נדרש טיפול', but it NEVER clears emp_id or instructor_name.

create or replace function public.scheduling_apply_course_assignment_revalidation(
  p_activity_id text,
  p_change_reason text default 'activity_requirements_changed'
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  validation_reason text;
  prior_status text;
  next_status text;
  audit_reason text;
begin
  select * into target from public.activities where row_id = p_activity_id for update;
  if not found then return null; end if;

  -- Only locked 2027 courses with an assigned instructor are revalidated.
  if target.instructor_assignment_locked is not true
    or (target.emp_id is null and target.emp_id_2 is null)
  then
    return target.instructor_assignment_status;
  end if;

  prior_status := target.instructor_assignment_status;

  -- scheduling_locked_course_validation_reason reads live tables; the result reflects
  -- current availability rules, current conflicts, current travel data, etc.
  validation_reason := public.scheduling_locked_course_validation_reason(p_activity_id);
  next_status := case when validation_reason is null then 'שובץ' else 'נדרש טיפול' end;
  audit_reason := concat_ws(' · ', nullif(btrim(coalesce(p_change_reason, '')), ''), validation_reason);

  if prior_status is distinct from next_status then
    update public.activities
    set instructor_assignment_status = next_status
    where row_id = p_activity_id;

    insert into public.instructor_assignment_audit(
      activity_id, selected_emp_id, selected_instructor_name,
      decision_type, reason, previous_status, new_status,
      bypassed_constraints, meetings_completed_at_decision
    ) values (
      p_activity_id,
      coalesce(target.emp_id::text, target.emp_id_2::text),
      coalesce(target.instructor_name, target.instructor_name_2),
      'revalidated', audit_reason, prior_status, next_status,
      '{}', 0
    );
  end if;

  return next_status;
end
$$;
revoke all on function public.scheduling_apply_course_assignment_revalidation(text,text) from public;

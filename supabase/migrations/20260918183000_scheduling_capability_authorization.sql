-- Align course-scheduling authorization with the explicit capability used by the UI.
-- Users with view_operations_scheduling=yes may operate the scheduling workspace.
-- Admin-only manager-review RPCs remain unchanged.

drop policy if exists scheduling_travel_cache_read on public.scheduling_travel_cache;
drop policy if exists scheduling_travel_cache_authorized_read on public.scheduling_travel_cache;
create policy scheduling_travel_cache_authorized_read
  on public.scheduling_travel_cache
  for select
  to authenticated
  using (public.app_has_permission('view_operations_scheduling'));

drop policy if exists instructor_assignment_audit_read on public.instructor_assignment_audit;
drop policy if exists instructor_assignment_audit_authorized_read on public.instructor_assignment_audit;
create policy instructor_assignment_audit_authorized_read
  on public.instructor_assignment_audit
  for select
  to authenticated
  using (public.app_has_permission('view_operations_scheduling'));

do $$
declare
  fn record;
  before_def text;
  after_def text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname = any(array[
        'assign_activity_instructor',
        'assign_activity_instructor_with_dates',
        'cancel_confirmed_course_assignment',
        'cancel_course_assignment_draft',
        'course_assignment_manager_approval_state',
        'reassign_locked_course_instructor',
        'reject_activity_instructor_suggestion',
        'replace_locked_course_instructor',
        'revalidate_course_instructor_assignment',
        'save_activity_scheduling_requirements',
        'save_course_assignment_draft',
        'save_course_assignment_draft_with_dates',
        'save_course_assignment_manual_draft',
        'scheduling_clear_draft_on_manual_assignment',
        'set_course_meeting_cancelled',
        'submit_course_assignment_manager_approval'
      ])
  loop
    before_def := pg_get_functiondef(fn.oid);
    after_def := before_def;

    after_def := replace(
      after_def,
      'caller_role is null or caller_role not in (''admin'',''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'caller_role is null or caller_role not in (''admin'', ''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'public.app_current_role() is null or public.app_current_role() not in (''admin'',''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'public.app_current_role() is null or public.app_current_role() not in (''admin'', ''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'public.app_current_role() not in (''admin'', ''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'public.app_current_role() not in (''admin'',''operation_manager'')',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'caller_role <> all(array[''admin'', ''operation_manager''])',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );
    after_def := replace(
      after_def,
      'caller_role <> all(array[''admin'',''operation_manager''])',
      'not public.app_has_permission(''view_operations_scheduling'')'
    );

    if after_def = before_def then
      raise exception 'scheduling capability migration did not match permission guard in %', fn.proname;
    end if;

    execute after_def;
  end loop;
end
$$;

-- Manager review remains admin-only by design:
-- course_assignment_manager_approval_requests()
-- review_course_assignment_manager_approval(text,text)

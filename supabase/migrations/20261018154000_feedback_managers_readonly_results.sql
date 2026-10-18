-- Feedback read-only results access for activity managers and Eden Cohen.
-- Existing admin / Israa draft-editor scope and all template policies stay intact.
-- The broader helper is deliberately NOT used by feedback template RLS or write RPCs.
create or replace function private.feedback_can_view_results()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.feedback_can_view() or exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.is_active is true
      and (
        u.role = 'activities_manager'
        or (u.role = 'operation_manager' and u.user_id = '6000')
      )
  );
$$;
revoke all on function private.feedback_can_view_results() from public, anon;
grant execute on function private.feedback_can_view_results() to authenticated;

-- Two catalogs are needed for the four report tabs, not for template editing.
create policy feedback_metrics_results_view_select
  on public.feedback_metrics for select to authenticated
  using ((select private.feedback_can_view_results()));
create policy feedback_programs_results_view_select
  on public.feedback_programs for select to authenticated
  using ((select private.feedback_can_view_results()));

-- Only existing read-only results RPCs receive the new guard. Any missing or
-- unexpectedly changed source guard aborts the migration rather than broadening access.
do $feedback_results_readonly$
declare
  r record;
  definition text;
  changed integer := 0;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'feedback_admin_groups',
        'feedback_admin_course_summary',
        'feedback_admin_course_summary_for_half',
        'feedback_admin_instructor_assignments',
        'feedback_admin_answer_facts',
        'feedback_admin_instructor_review_items',
        'feedback_staff_auto_status'
      )
  loop
    definition := pg_get_functiondef(r.oid);
    if position('private.feedback_can_view()' in definition) = 0 then
      raise exception 'feedback_results_read_guard_changed: %', r.proname;
    end if;
    definition := replace(definition,
      'private.feedback_can_view()', 'private.feedback_can_view_results()');
    execute definition;
    changed := changed + 1;
  end loop;
  if changed <> 7 then
    raise exception 'feedback_results_expected_seven_read_functions: %', changed;
  end if;
end
$feedback_results_readonly$;

-- Read access MUST NOT grant template access or expand write privileges.
do $feedback_results_guard$
declare n integer;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname in (
    'feedback_admin_open_campaign',
    'feedback_admin_open_instructor_campaign',
    'feedback_admin_update_campaign',
    'feedback_admin_set_program',
    'feedback_admin_publish_draft',
    'feedback_admin_discard_draft',
    'feedback_auto_schedule_instructor_pre',
    'feedback_israa_update_wording'
  ) and position('private.feedback_can_view_results()' in pg_get_functiondef(p.oid)) > 0;
  if n > 0 then raise exception 'feedback_results_write_guard_expanded'; end if;

  select count(*) into n
  from pg_policies
  where (schemaname = 'public' and tablename in (
    'feedback_templates', 'feedback_template_versions',
    'feedback_template_questions', 'feedback_questions',
    'feedback_template_pdfs'
  )) or (schemaname = 'storage' and tablename = 'objects');
  -- A separate query guards only policies involving this helper.
  if exists (
    select 1 from pg_policies
    where ((schemaname = 'public' and tablename in (
      'feedback_templates', 'feedback_template_versions',
      'feedback_template_questions', 'feedback_questions',
      'feedback_template_pdfs'
    )) or (schemaname = 'storage' and tablename = 'objects'))
      and (
        coalesce(qual, '') like '%feedback_can_view_results%'
        or coalesce(with_check, '') like '%feedback_can_view_results%'
      )
  ) then raise exception 'feedback_results_template_exposure'; end if;
end
$feedback_results_guard$;

notify pgrst, 'reload schema';

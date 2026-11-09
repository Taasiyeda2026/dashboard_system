-- Association chair (public.users.user_id = '3090'): results/tracking read access only.
-- Do not widen template policies or mutating RPCs. Identity is user_id, not display_role.

create or replace function private.feedback_can_view_results()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.feedback_can_view() or exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and u.is_active is true
      and (
        u.role = 'activities_manager'
        or (u.role = 'operation_manager' and u.user_id = '6000')
        or u.user_id = '3090'
      )
  );
$$;

revoke all on function private.feedback_can_view_results() from public, anon;
grant execute on function private.feedback_can_view_results() to authenticated;

-- Defense in depth: results helper must never appear on write/template surfaces.
do $feedback_chair_results_guard$
declare n integer;
begin
  select count(*) into n
  from pg_proc p
  join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public'
    and p.proname in (
      'feedback_admin_open_campaign',
      'feedback_admin_open_instructor_campaign',
      'feedback_admin_update_campaign',
      'feedback_admin_set_program',
      'feedback_admin_publish_draft',
      'feedback_admin_discard_draft',
      'feedback_auto_schedule_instructor_pre',
      'feedback_israa_update_wording'
    )
    and position('private.feedback_can_view_results()' in pg_get_functiondef(p.oid)) > 0;
  if n > 0 then
    raise exception 'feedback_chair_results_write_guard_expanded';
  end if;

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
  ) then
    raise exception 'feedback_chair_results_template_exposure';
  end if;
end
$feedback_chair_results_guard$;

notify pgrst, 'reload schema';

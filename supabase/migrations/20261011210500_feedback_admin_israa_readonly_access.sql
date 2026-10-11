-- Temporary restricted impact-feedback access: system admins + the specific active
-- Israa employee account (public.users.user_id = '3030'). No other roles.
-- Read-only for Israa; all editing, publication, PDF mutations and campaign
-- creation/close/send operations remain guarded by private.feedback_is_admin().
-- Future wider rollout must be a separate explicitly reviewed change.

create or replace function private.feedback_can_view()
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and coalesce(u.is_active, false)
      and (
        lower(coalesce(u.role,'')) = 'admin'
        or (
          u.user_id = '3030'
          and u.role = 'business_development_manager'
        )
      )
  );
$$;
revoke all on function private.feedback_can_view() from public, anon;
grant execute on function private.feedback_can_view() to authenticated;

-- The tab definitions call SELECT on these two catalogs directly.
-- SELECT-only policies don't confer write access.
create policy feedback_metrics_authorized_view_select
  on public.feedback_metrics for select to authenticated
  using ((select private.feedback_can_view()));
create policy feedback_programs_authorized_view_select
  on public.feedback_programs for select to authenticated
  using ((select private.feedback_can_view()));

-- The other read-only dashboard datasets use SECURITY DEFINER RPCs.
-- Replace only their read guard. NEVER change private.feedback_is_admin().
do $adjust_read_functions$
declare r record; ddl text; changed integer:=0;
begin
 for r in
    select p.oid,p.proname
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'feedback_admin_groups',
      'feedback_admin_course_summary',
      'feedback_admin_course_summary_for_half',
      'feedback_admin_instructor_assignments',
      'feedback_admin_answer_facts'
    )
 loop
    ddl:=pg_get_functiondef(r.oid);
    if position('private.feedback_is_admin()' in ddl)=0 then
      raise exception 'Missing existing read-only feedback admin guard: %',r.proname;
    end if;
    ddl:=replace(ddl,'private.feedback_is_admin()','private.feedback_can_view()');
    execute ddl;
    changed:=changed+1;
 end loop;
 if changed<>5 then
   raise exception 'Expected exactly five read-only RPC functions; found %',changed;
 end if;
end $adjust_read_functions$;

-- Defense-in-depth: none of the mutating RPCs may refer to the viewer helper.
do $assert_admin_writes_only$
declare n integer;
begin
  select count(*) into n
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public'
  and p.proname in (
    'feedback_admin_open_campaign',
    'feedback_admin_open_instructor_campaign',
    'feedback_admin_update_campaign',
    'feedback_admin_set_program',
    'feedback_admin_publish_draft',
    'feedback_admin_discard_draft'
  )
  and pg_get_functiondef(p.oid) like '%private.feedback_can_view()%';
  if n>0 then raise exception 'Unsafe feedback write grants detected'; end if;
end $assert_admin_writes_only$;

notify pgrst, 'reload schema';

-- Defense-in-depth: only the designated scheduling-agent owner (Idan) may approve
-- manual scheduling exceptions in the existing dashboard queue.
-- Fail loudly if the deployed SQL function no longer matches the reviewed guard.
do $migration$
declare
  fn regprocedure := 'public.review_course_assignment_manager_approval(text,text)'::regprocedure;
  original_definition text;
  old_guard text;
  new_guard text;
begin
  original_definition := pg_get_functiondef(fn);
  old_guard := 'if caller_role is distinct from ''admin''' || E'\n' ||
               '    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)';
  new_guard := 'if caller_role is distinct from ''admin''' || E'\n' ||
               '    or auth.uid() is distinct from (select c.approver_id from public.scheduling_agent_control c where c.singleton)' || E'\n' ||
               '    or not exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active is true)';
  if position(old_guard in original_definition)=0 then
    raise exception 'review_course_assignment_manager_approval guard has changed: manual migration review required';
  end if;
  execute replace(original_definition, old_guard, new_guard);
end
$migration$;

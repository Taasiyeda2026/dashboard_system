-- Instructor PRE eligibility does not require a planned course END date; an instructor
-- only needs an existing, locked eligible course assignment and an admin send date.
do $$
declare source_sql text;
begin
 select pg_get_functiondef(p.oid) into source_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='feedback_auto_candidates';
 if source_sql is null then raise exception 'feedback_candidate_function_missing'; end if;
 if position('select 1 from instructor_assignment a' in source_sql)=0 then
   raise exception 'feedback_candidate_source_changed';
 end if;
 source_sql:=replace(source_sql,
   'select 1 from instructor_assignment a' || chr(10) ||
   '    where a.emp_id=req.instructor_emp_id and a.program_key=req.program_key',
   'select 1 from shaped a' || chr(10) ||
   '    where (a.emp_id::text=req.instructor_emp_id or a.emp_id_2=req.instructor_emp_id)' ||
   ' and a.program_key=req.program_key');
 if position('select 1 from shaped a' in source_sql)=0 then
   raise exception 'feedback_candidate_patch_not_applied';
 end if;
 execute source_sql;
end $$;
revoke all on function public.feedback_auto_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.feedback_auto_candidates(timestamptz) to service_role;
notify pgrst,'reload schema';

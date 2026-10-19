-- Keep permanent-course status "needs treatment" while an unstaffed
-- manager-approved lesson remains unresolved, even after independent edits.
do $$
declare definition text;
needle text:='  if coalesce(array_length(violations, 1), 0) = 0 then return null; end if;'||chr(10)||'  return violations[1];';
begin
 definition:=pg_get_functiondef('public.scheduling_locked_course_validation_reason(text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'locked_course_revalidation_patch_precondition_failed'; end if;
 definition:=replace(definition,needle,
   '  if coalesce(array_length(violations, 1), 0)>0 then return violations[1]; end if;'||chr(10)||
   '  if exists(select 1 from public.course_meeting_instructor_history h' ||chr(10)||
   '    where h.activity_id=p_activity_id and h.assignment_kind=''availability_blocked_pending'')' ||chr(10)||
   '  then return ''scheduling_blocked_meeting_pending''; end if;' ||chr(10)||
   '  return null;'
 );
 execute definition;
end $$;

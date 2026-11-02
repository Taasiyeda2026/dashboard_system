-- Guard individual attendance approval against unresolved travel-time cancellation.
-- Preserve the existing permission and month checks in the original function.
do $guard$
declare
  v_definition text;
  v_anchor text := '  insert into public.attendance_manager_record_reviews (';
  v_guard text := E'  if exists (select 1 from public.attendance_travel_compensations tc where tc.source_attendance_record_id = p_record_id and tc.review_status in (''awaiting_report'', ''pending_review'', ''auto_matched'')) then\n    raise exception ''attendance_travel_review_pending_for_record'' using errcode = ''22023'';\n  end if;\n\n';
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_manager_attendance_record_review'
  limit 1;
  if v_definition is null or position(v_anchor in v_definition) = 0 then
    raise exception 'set_manager_attendance_record_review_structure_changed';
  end if;
  if position('attendance_travel_review_pending_for_record' in v_definition) = 0 then
    execute replace(v_definition, v_anchor, v_guard || v_anchor);
  end if;
end
$guard$;

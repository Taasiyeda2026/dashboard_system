-- Keep the ordinary 40 km matching limit, while requiring manager approval for a
-- manual home-distance exception only at 60 km or above. Other manual exceptions
-- continue to require approval exactly as before.
create or replace function public.scheduling_manual_draft_requires_manager_approval(
  p_activity_id text,
  p_emp_id bigint,
  p_manual_reason text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.activities;
  selected_instructor public.contacts_instructors;
  target_location text;
  home_km numeric;
  exception_reason text := regexp_replace(btrim(coalesce(p_manual_reason, '')), '^בחירה ידנית:\s*', '');
  has_non_distance_exception boolean;
begin
  if btrim(coalesce(p_manual_reason, '')) = 'בחירה ידנית' then return false; end if;

  select * into target from public.activities where row_id = p_activity_id;
  select * into selected_instructor from public.contacts_instructors where emp_id = p_emp_id;

  select exists (
    select 1
    from unnest(regexp_split_to_array(exception_reason, '\s*·\s*')) reason
    where btrim(reason) <> ''
      and reason !~ 'מרחק הנסיעה לבית הספר.*מגבלה של 40 ק[״"]?מ'
  ) into has_non_distance_exception;
  if has_non_distance_exception then return true; end if;

  target_location := public.scheduling_school_location(
    target.school_id, target.school, target.authority_id, target.authority
  );
  if nullif(btrim(coalesce(selected_instructor.address, '')), '') is null
    or nullif(btrim(coalesce(target_location, '')), '') is null
  then return true; end if;

  home_km := public.scheduling_cached_travel_distance_km(selected_instructor.address, target_location);
  return home_km is null or home_km >= 60;
end
$$;

revoke all on function public.scheduling_manual_draft_requires_manager_approval(text,bigint,text) from public;
grant execute on function public.scheduling_manual_draft_requires_manager_approval(text,bigint,text) to authenticated;

-- Patch only the three active approval decisions. Function signatures, security,
-- request/audit handling and all unrelated hard validations remain unchanged.
do $migration$
declare
  fn record;
  definition text;
begin
  for fn in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'course_assignment_manager_approval_state',
        'submit_course_assignment_manager_approval',
        'scheduling_guard_manual_exception_approval'
      )
  loop
    definition := pg_get_functiondef(fn.oid);
    if fn.proname = 'course_assignment_manager_approval_state' then
      definition := replace(
        definition,
        'approval_required := btrim(coalesce(manual_reason, '''')) <> ''בחירה ידנית'';',
        'approval_required := public.scheduling_manual_draft_requires_manager_approval(target.row_id, target.draft_emp_id::bigint, manual_reason);'
      );
    elsif fn.proname = 'submit_course_assignment_manager_approval' then
      definition := replace(
        definition,
        'if btrim(coalesce(manual_reason, ''''))=''בחירה ידנית'' then',
        'if not public.scheduling_manual_draft_requires_manager_approval(target.row_id, target.draft_emp_id::bigint, manual_reason) then'
      );
    else
      definition := replace(
        definition,
        'if found and btrim(coalesce(manual_reason,''''))<>''בחירה ידנית'' then',
        'if found and public.scheduling_manual_draft_requires_manager_approval(old.row_id, old.draft_emp_id::bigint, manual_reason) then'
      );
    end if;
    if position('scheduling_manual_draft_requires_manager_approval' in definition) = 0 then
      raise exception 'manager approval threshold patch target not found: %', fn.proname;
    end if;
    execute definition;
  end loop;
end
$migration$;

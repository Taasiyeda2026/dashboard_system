-- Explicit planning invalidation after scheduling-sensitive activity edits.
-- Marks only the changed activity + real instructor/slot dependencies (needs_recalc),
-- never the full planning workspace.

create or replace function public.scheduling_planning_sensitive_changed(
  p_old public.activities,
  p_new public.activities
) returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  n integer;
begin
  if p_old.required_instructor_gender is distinct from p_new.required_instructor_gender
    or p_old.instruction_language is distinct from p_new.instruction_language
    or p_old.start_date is distinct from p_new.start_date
    or p_old.end_date is distinct from p_new.end_date
    or p_old.start_time is distinct from p_new.start_time
    or p_old.end_time is distinct from p_new.end_time
    or p_old.sessions is distinct from p_new.sessions
    or p_old.school is distinct from p_new.school
    or p_old.school_id is distinct from p_new.school_id
    or p_old.authority is distinct from p_new.authority
    or p_old.authority_id is distinct from p_new.authority_id
    or p_old.activity_name is distinct from p_new.activity_name
    or p_old.activity_no is distinct from p_new.activity_no
    or p_old.gefen_number is distinct from p_new.gefen_number
    or p_old.status is distinct from p_new.status
    or p_old.emp_id is distinct from p_new.emp_id
    or p_old.emp_id_2 is distinct from p_new.emp_id_2
    or p_old.instructor_name is distinct from p_new.instructor_name
    or p_old.instructor_name_2 is distinct from p_new.instructor_name_2
    or p_old.draft_emp_id is distinct from p_new.draft_emp_id
  then
    return true;
  end if;

  for n in 1..35 loop
    if to_jsonb(p_old)->>('date_' || n) is distinct from to_jsonb(p_new)->>('date_' || n) then
      return true;
    end if;
  end loop;
  return false;
end
$$;

create or replace function public.mark_scheduling_planning_needs_recalc(
  p_activity_id text,
  p_require_permission boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  activity_id text := nullif(btrim(coalesce(p_activity_id, '')), '');
  workspace_rec public.scheduling_planning_workspaces;
  marked_ids text[] := array[]::text[];
  instructor_ids text[] := array[]::text[];
  workspace_count integer := 0;
  affected_total integer := 0;
  row_affected integer := 0;
begin
  if activity_id is null then
    raise exception 'planning_activity_id_required';
  end if;

  if coalesce(p_require_permission, true)
    and not public.app_has_permission('view_operations_scheduling')
  then
    raise exception 'scheduling_permission_denied' using errcode = '42501';
  end if;

  if not exists(select 1 from public.activities a where a.row_id = activity_id) then
    raise exception 'activity_not_found';
  end if;

  for workspace_rec in
    select w.*
    from public.scheduling_planning_workspaces w
    where exists (
      select 1
      from public.scheduling_planning_rows r
      where r.workspace_id = w.id
        and r.activity_id = activity_id
    )
    for update
  loop
    workspace_count := workspace_count + 1;
    instructor_ids := array[]::text[];

    select coalesce(array_agg(distinct emp_id), array[]::text[])
      into instructor_ids
    from (
      select nullif(btrim(coalesce(r.row_data->>'instructorEmpId', '')), '') as emp_id
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.activity_id = activity_id
      union
      select nullif(btrim(coalesce(r.locked_option->>'instructorEmpId', '')), '')
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.activity_id = activity_id
      union
      select nullif(btrim(coalesce(option_row->>'instructorEmpId', '')), '')
      from public.scheduling_planning_rows r
      cross join lateral jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row
      where r.workspace_id = workspace_rec.id
        and r.activity_id = activity_id
      union
      select nullif(btrim(coalesce(a.emp_id::text, '')), '')
      from public.activities a
      where a.row_id = activity_id
      union
      select nullif(btrim(coalesce(a.emp_id_2::text, '')), '')
      from public.activities a
      where a.row_id = activity_id
      union
      select nullif(btrim(coalesce(a.draft_emp_id::text, '')), '')
      from public.activities a
      where a.row_id = activity_id
    ) instructors
    where emp_id is not null;

    update public.scheduling_planning_rows r
    set needs_recalc = true,
        updated_at = now()
    where r.workspace_id = workspace_rec.id
      and r.activity_id = activity_id
      and r.needs_recalc is distinct from true;
    get diagnostics row_affected = row_count;
    affected_total := affected_total + row_affected;

    if coalesce(cardinality(instructor_ids), 0) > 0 then
      update public.scheduling_planning_rows r
      set needs_recalc = true,
          updated_at = now()
      where r.workspace_id = workspace_rec.id
        and r.activity_id <> activity_id
        and r.locked_option is null
        and r.needs_recalc is distinct from true
        and (
          coalesce(r.row_data->>'instructorEmpId', '') = any(instructor_ids)
          or exists (
            select 1
            from jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row
            where coalesce(option_row->>'instructorEmpId', '') = any(instructor_ids)
          )
        );
      get diagnostics row_affected = row_count;
      affected_total := affected_total + row_affected;
    end if;

    select coalesce(array_agg(distinct merged.activity_id order by merged.activity_id), array[activity_id])
      into marked_ids
    from (
      select unnest(marked_ids) as activity_id
      union
      select r.activity_id
      from public.scheduling_planning_rows r
      where r.workspace_id = workspace_rec.id
        and r.needs_recalc is true
        and (
          r.activity_id = activity_id
          or (
            coalesce(cardinality(instructor_ids), 0) > 0
            and r.locked_option is null
            and (
              coalesce(r.row_data->>'instructorEmpId', '') = any(instructor_ids)
              or exists (
                select 1
                from jsonb_array_elements(coalesce(r.row_data->'options', '[]'::jsonb)) option_row
                where coalesce(option_row->>'instructorEmpId', '') = any(instructor_ids)
              )
            )
          )
        )
    ) merged;

    update public.scheduling_planning_workspaces
    set updated_at = now(),
        updated_by = auth.uid(),
        revision = revision + 1
    where id = workspace_rec.id;
  end loop;

  return jsonb_build_object(
    'activityId', activity_id,
    'markedActivityIds', to_jsonb(coalesce(marked_ids, array[]::text[])),
    'affectedCount', coalesce(cardinality(marked_ids), 0),
    'rowsTouched', affected_total,
    'workspaceCount', workspace_count
  );
end
$$;

create or replace function public.scheduling_invalidate_planning_after_activity_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.scheduling_planning_sensitive_changed(old, new) then
    return new;
  end if;
  perform public.mark_scheduling_planning_needs_recalc(new.row_id, false);
  return new;
end
$$;

drop trigger if exists activities_invalidate_planning_rows on public.activities;
create trigger activities_invalidate_planning_rows
  after update on public.activities
  for each row
  execute function public.scheduling_invalidate_planning_after_activity_change();

revoke all on function public.scheduling_planning_sensitive_changed(public.activities, public.activities) from public;
revoke all on function public.mark_scheduling_planning_needs_recalc(text, boolean) from public;
revoke all on function public.scheduling_invalidate_planning_after_activity_change() from public;
grant execute on function public.mark_scheduling_planning_needs_recalc(text, boolean) to authenticated;

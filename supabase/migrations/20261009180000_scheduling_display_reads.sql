-- Read-only display projection; apply only after separate deployment approval.
CREATE OR REPLACE FUNCTION public.get_scheduling_planning_display_workspace(p_period_key text, p_district text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  scope_period text := nullif(btrim(coalesce(p_period_key, '')), '');
  scope_district text := btrim(coalesce(p_district, ''));
  workspace public.scheduling_planning_workspaces;
  editor_name text;
  rows_json jsonb;
begin
  if not coalesce(public.app_has_permission('view_operations_scheduling'), false) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if scope_period is null then raise exception 'planning_period_required'; end if;

  select * into workspace
  from public.scheduling_planning_workspaces
  where period_key = scope_period and district = scope_district;

  if not found then
    return jsonb_build_object('workspace', null, 'rows', '[]'::jsonb);
  end if;

  select coalesce(u.full_name, u.name, u.email, '')
    into editor_name
  from public.users u
  where u.auth_user_id = workspace.updated_by
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'activityId', r.activity_id,
        'row', (r.row_data - 'options' - 'scheduleOptions' - 'packingOptions') || jsonb_build_object(
          'options', case when jsonb_array_length(coalesce(r.row_data->'options', '[]'::jsonb)) > 0
            then jsonb_build_array(r.row_data->'options'->0) || coalesce((select jsonb_agg(o) from jsonb_array_elements(r.row_data->'options') with ordinality as opts(o,n)
              where n > 1 and coalesce(o->>'instructorEmpId','') = coalesce(r.row_data->>'instructorEmpId','')
              and coalesce(o->>'startDate','') = coalesce(r.row_data->>'startDate','')
              and coalesce(o->>'startTime','') = coalesce(r.row_data->>'startTime','') limit 1), '[]'::jsonb)
            else '[]'::jsonb end,
          'scheduleOptions', '[]'::jsonb, 'packingOptions', '[]'::jsonb,
          'dependencyInstructorIds', to_jsonb(public.scheduling_planning_row_instructor_ids(r)),
          'dependencySlots', coalesce((select jsonb_agg(distinct jsonb_build_object('date', m->>'date', 'start_time', m->>'start_time', 'end_time', m->>'end_time'))
            from jsonb_array_elements(coalesce(r.row_data->'options','[]'::jsonb) || coalesce(r.row_data->'packingOptions','[]'::jsonb)) o
            cross join lateral jsonb_array_elements(coalesce(o->'meetings','[]'::jsonb)) m), '[]'::jsonb),
          'optionCount', jsonb_array_length(coalesce(r.row_data->'options', '[]'::jsonb)),
          'scheduleOptionCount', jsonb_array_length(coalesce(r.row_data->'scheduleOptions', '[]'::jsonb)),
          '_detailsDeferred', true),
        'activityUpdatedAt', r.activity_updated_at,
        'lockedOption', r.locked_option,
        'lockedAt', r.locked_at,
        'lockedBy', r.locked_by,
        'needsRecalc', r.needs_recalc,
        'needsRecalcMarkedAt', r.needs_recalc_marked_at
      )
      order by r.activity_id
    ),
    '[]'::jsonb
  ) into rows_json
  from public.scheduling_planning_rows r
  where r.workspace_id = workspace.id;

  return jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', workspace.id,
      'periodKey', workspace.period_key,
      'district', workspace.district,
      'engineVersion', workspace.engine_version,
      'dataFingerprint', workspace.data_fingerprint,
      'contextFingerprint', workspace.context_fingerprint,
      'calculatedAt', workspace.calculated_at,
      'updatedAt', workspace.updated_at,
      'updatedBy', workspace.updated_by,
      'updatedByName', coalesce(editor_name, ''),
      'revision', workspace.revision
    ),
    'rows', rows_json
  );
end
$function$
;


CREATE OR REPLACE FUNCTION public.get_scheduling_planning_row_details(
  p_workspace_id uuid, p_activity_id text, p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result jsonb;
BEGIN
  IF NOT coalesce(public.app_has_permission('view_operations_scheduling'), false) THEN
    RAISE EXCEPTION 'scheduling_permission_denied' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.scheduling_planning_workspaces WHERE id=p_workspace_id AND revision=p_expected_revision FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'planning_revision_conflict' USING ERRCODE='40001';
  END IF;
  SELECT row_data INTO result FROM public.scheduling_planning_rows WHERE workspace_id=p_workspace_id AND activity_id=p_activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'planning_row_not_found'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.get_scheduling_planning_display_workspace(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_scheduling_planning_row_details(uuid,text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduling_planning_display_workspace(text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_scheduling_planning_row_details(uuid,text,bigint) TO authenticated, service_role;

-- Scope-only cleanup. Do not touch underlying activities or accepted course assignments.
-- A removed, unapproved tour proposal is not a calendar assignment.
DO $cleanup$
DECLARE
  workspace public.scheduling_planning_workspaces%ROWTYPE;
  total_tour_rows integer;
  eligible_rows integer;
  deleted_rows integer;
BEGIN
  SELECT * INTO workspace FROM public.scheduling_planning_workspaces
   WHERE period_key='year' AND district='' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.scheduling_planning_run_leases
    WHERE period_key='year' AND district='' AND expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'course_only_cleanup_active_planning_run';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE r.locked_option IS NULL
    AND r.row_data->>'kind'='proposal' AND a.status='פתוח'
    AND a.emp_id IS NULL AND coalesce(a.draft_emp_id::text,'')=''
    AND a.activity_no::text='13990')
  INTO total_tour_rows,eligible_rows
  FROM public.scheduling_planning_rows r JOIN public.activities a ON a.row_id=r.activity_id
  WHERE r.workspace_id=workspace.id AND a.activity_type='tour';
  IF total_tour_rows<>eligible_rows THEN
    RAISE EXCEPTION 'course_only_cleanup_protected_tours: total %, eligible %',total_tour_rows,eligible_rows;
  END IF;
  IF eligible_rows=0 THEN RETURN; END IF;
  DELETE FROM public.scheduling_planning_rows r USING public.activities a
   WHERE r.workspace_id=workspace.id AND r.activity_id=a.row_id AND a.activity_type='tour'
   AND a.activity_no::text='13990' AND a.status='פתוח'
   AND a.emp_id IS NULL AND coalesce(a.draft_emp_id::text,'')=''
   AND r.locked_option IS NULL AND r.row_data->>'kind'='proposal';
  GET DIAGNOSTICS deleted_rows=ROW_COUNT;
  IF deleted_rows<>eligible_rows THEN
    RAISE EXCEPTION 'course_only_cleanup_concurrent_rows_changed';
  END IF;
  UPDATE public.scheduling_planning_workspaces SET revision=revision+1,updated_at=now()
   WHERE id=workspace.id AND revision=workspace.revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'course_only_cleanup_revision_changed'; END IF;
END $cleanup$;

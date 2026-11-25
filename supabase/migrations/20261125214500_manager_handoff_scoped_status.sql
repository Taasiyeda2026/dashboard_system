-- Read-only handoff state for the manager's own instructors.
-- Never expose payroll amounts, approved snapshots or arbitrary staff records.
-- Keep payroll_control_approvals RLS unchanged.
CREATE OR REPLACE FUNCTION public.get_manager_attendance_handoff_statuses(
  p_employee_ids bigint[],
  p_month_key text
)
RETURNS TABLE(employee_id bigint, final_status text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'attendance_manager_auth_required' USING ERRCODE='42501';
  END IF;
  IF coalesce(trim(p_month_key), '') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid_month_key' USING ERRCODE='22023';
  END IF;
  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RETURN;
  END IF;
  IF cardinality(p_employee_ids) > 500 THEN
    RAISE EXCEPTION 'manager_handoff_employee_limit' USING ERRCODE='22023';
  END IF;

  RETURN QUERY
  SELECT requested.id, approvals.status
  FROM (SELECT DISTINCT ids.id FROM unnest(p_employee_ids) AS ids(id)
        WHERE ids.id IS NOT NULL AND ids.id > 0) requested
  LEFT JOIN public.payroll_control_approvals approvals
    ON approvals.employee_id = requested.id::text
   AND approvals.month_key = trim(p_month_key)
   AND approvals.status IN ('admin_approved', 'approved_for_payroll')
  WHERE public.attendance_manager_can_review_employee(requested.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_manager_attendance_handoff_statuses(bigint[],text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_manager_attendance_handoff_statuses(bigint[],text) TO authenticated;

COMMENT ON FUNCTION public.get_manager_attendance_handoff_statuses(bigint[],text) IS
  'Authenticated scoped read of manager team month handoff stage only; full payroll rows remain protected by RLS.';

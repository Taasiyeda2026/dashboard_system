DO $migration$
DECLARE
  v_fn oid;
  v_definition text;
  v_old_decl text := E'DECLARE v_result jsonb;';
  v_new_decl text := E'DECLARE v_result jsonb;\n  v_current_emp_id bigint;';
  v_old_begin text := E'BEGIN\n  WITH acts AS (';
  v_new_begin text := E'BEGIN\n  -- Authorize the requested instructor before reading any course or school.\n  SELECT u.emp_id::bigint INTO v_current_emp_id\n  FROM public.users u\n  WHERE u.auth_user_id = auth.uid()\n    AND u.is_active = true\n    AND btrim(coalesce(u.emp_id, '''')) ~ ''^[0-9]+$''\n  LIMIT 1;\n  IF v_current_emp_id IS NULL OR v_current_emp_id <> p_emp_id THEN\n    RETURN ''[]''::jsonb;\n  END IF;\n\n  WITH acts AS (';
BEGIN
  SELECT oid INTO v_fn FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname='av2_get_authority_school_list'
    AND proargtypes='20'::oidvector
    AND prosecdef AND pg_get_userbyid(proowner)='postgres';
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Expected instructor-school function was not found';
  END IF;
  v_definition:=pg_get_functiondef(v_fn);
  IF position(v_old_decl IN v_definition)=0 OR position(v_old_begin IN v_definition)=0 THEN
    RAISE EXCEPTION 'Unexpected instructor-school function body; no changes applied';
  END IF;
  v_definition:=replace(v_definition,v_old_decl,v_new_decl);
  v_definition:=replace(v_definition,v_old_begin,v_new_begin);
  EXECUTE v_definition;
END $migration$;

ALTER FUNCTION public.av2_get_authority_school_list(bigint)
  SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.av2_get_authority_school_list(bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.av2_get_authority_school_list(bigint)
  TO authenticated, service_role;

-- The canonical activity catalog is an internal authenticated dashboard lookup.
-- The database owner retains all existing object access; callers must have an
-- active authenticated Taasiyeda user account.
DO $catalog$
DECLARE
  v_fn oid;
  v_definition text;
  v_anchor text := E'    where coalesce(a.status, '''') not in';
  v_guard text := E'    where EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = auth.uid() AND u.is_active = true)\n      and coalesce(a.status, '''') not in';
BEGIN
  SELECT oid INTO v_fn FROM pg_proc
  WHERE pronamespace='public'::regnamespace
    AND proname='av2_search_canonical_activities'
    AND prosecdef AND pg_get_userbyid(proowner)='postgres';
  IF v_fn IS NULL THEN RAISE EXCEPTION 'Canonical activity search function is missing'; END IF;
  v_definition:=pg_get_functiondef(v_fn);
  IF position(v_anchor IN v_definition)=0 THEN
    RAISE EXCEPTION 'Unexpected canonical activity search function body';
  END IF;
  v_definition:=replace(v_definition,v_anchor,v_guard);
  EXECUTE v_definition;
END $catalog$;
REVOKE EXECUTE ON FUNCTION public.av2_search_canonical_activities(text,text[],text[],integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.av2_search_canonical_activities(text,text[],text[],integer)
  TO authenticated, service_role;
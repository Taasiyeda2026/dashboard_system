-- Role-gate legacy proposal contact upsert before it reaches any write.
-- This SECURITY DEFINER routine must not be available to every signed-in user.
DO $guard$
DECLARE
  v_oid oid;
  v_sql text;
  v_anchor text := E'BEGIN\n  v_client_type :=';
BEGIN
  SELECT p.oid INTO v_oid FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace
    AND p.proname='ensure_contact_school_from_proposal'
    AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
    AND p.pronargs=14;
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Expected proposal contact upsert function is absent';
  END IF;
  v_sql:=pg_get_functiondef(v_oid);
  IF position(v_anchor IN v_sql)=0 OR
     position('app_can_manage_proposals_agreements()' IN v_sql)>0 THEN
    RAISE EXCEPTION 'Unexpected proposal contact upsert function body';
  END IF;
  v_sql:=replace(v_sql,v_anchor,E'BEGIN\n  IF auth.uid() IS NULL OR NOT public.app_can_manage_proposals_agreements() THEN\n    RAISE EXCEPTION ''proposal_contact_upsert_forbidden'' USING ERRCODE = ''42501'';\n  END IF;\n  v_client_type :=');
  EXECUTE v_sql;
END $guard$;
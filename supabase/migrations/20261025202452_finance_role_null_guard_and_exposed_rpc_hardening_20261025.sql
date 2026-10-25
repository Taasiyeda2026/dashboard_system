-- Null-safe role checks on three finance RPCs, plus explicit role-bound EXECUTE.
DO $guard$
DECLARE
  r record;
  function_sql text;
  signature text;
BEGIN
  FOR r IN
    SELECT p.oid,p.proname
    FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname IN ('list_finance_collection_tracking',
                       'upsert_finance_collection_tracking',
                       'reserve_finance_transaction_account')
      AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
  LOOP
    function_sql:=pg_get_functiondef(r.oid);
    IF position('public.app_current_role() <> ''admin'' and not public.app_has_permission(' IN lower(function_sql))=0 THEN
      RAISE EXCEPTION 'Unexpected finance authorization guard: %',r.proname;
    END IF;
    function_sql:=replace(function_sql,
      'public.app_current_role() <> ''admin''',
      'public.app_current_role() IS DISTINCT FROM ''admin''');
    EXECUTE function_sql;
    signature:=format('public.%I(%s)',r.proname,pg_get_function_identity_arguments(r.oid));
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',signature);
  END LOOP;
  IF (SELECT count(*) FROM pg_proc
      WHERE pronamespace='public'::regnamespace AND proname IN (
        'list_finance_collection_tracking',
        'upsert_finance_collection_tracking',
        'reserve_finance_transaction_account'))<>3 THEN
    RAISE EXCEPTION 'One or more finance RPCs missing';
  END IF;
END $guard$;

-- These operations are for signed-in dashboards only; preserve authenticated
-- and trusted server access, not the public/anonymous RPC endpoint.
REVOKE EXECUTE ON FUNCTION public.save_israa_activity_group_draft(uuid,uuid,integer,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_israa_activity_group_draft(uuid,uuid,integer,jsonb)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.save_proposal_agreement_items_atomic(uuid,jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_proposal_agreement_items_atomic(uuid,jsonb)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_current_personal_reports_access()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_personal_reports_access()
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.ensure_contact_school_from_proposal(
  text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_contact_school_from_proposal(
  text,text,text,text,text,text,text,text,text,text,text,bigint,bigint,bigint
) TO authenticated, service_role;

-- Internal list refresh is invoked from privileged database triggers. It must
-- not be directly callable by browser sessions: it rewrites dynamic lists.
REVOKE EXECUTE ON FUNCTION public.sync_dynamic_dropdown_lists()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_dynamic_dropdown_lists()
  TO service_role;
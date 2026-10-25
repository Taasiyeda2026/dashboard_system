-- Remove direct RPC EXECUTE grants from internal trigger-only SECURITY DEFINER
-- functions. Existing triggers stay installed and run under their table owners.
-- Safety preconditions were checked on the live database: each function is
-- SECURITY DEFINER, has no args, returns trigger, is owned by postgres and
-- is attached only to tables owned by postgres.
--
-- Excluded intentionally: handle_new_user(), which is attached to auth.users
-- (owned by supabase_auth_admin) and requires separate role-dependency testing.
DO $security$
DECLARE
  fn_name text;
  fn_oid oid;
  matching_triggers int;
BEGIN
  FOR fn_name IN
    SELECT unnest(ARRAY[
      'assign_y_proposal_domain_to_activity',
      'av2_approval_before_insert',
      'av2_attachment_before_insert',
      'av2_attendance_record_before_insert',
      'av2_guard_attendance_record_lifecycle',
      'av2_guard_generated_attendance_attachment',
      'av2_guard_generated_attendance_mutation',
      'bridge_legacy_proposal_client_snapshot',
      'contact_email_before_write',
      'enforce_payroll_control_submission_gate',
      'enforce_school_calendar_on_activity',
      'guard_proposal_linked_activity_domain_y',
      'guard_proposals_agreements_explicit_permissions',
      'log_activities_changes',
      'scheduling_resolve_missing_route_on_cache_write',
      'scheduling_unstaffed_assignment_integrity',
      'sync_contact_email_to_contact_emails',
      'sync_contact_primary_email_from_contact_emails',
      'trg_sync_dynamic_dropdown_lists'
    ])
  LOOP
    SELECT p.oid INTO fn_oid FROM pg_proc p
    WHERE p.pronamespace='public'::regnamespace
      AND p.proname=fn_name AND p.pronargs=0
      AND p.prorettype='trigger'::regtype AND p.prosecdef
      AND pg_get_userbyid(p.proowner)='postgres';
    IF fn_oid IS NULL THEN
      RAISE EXCEPTION 'Unexpected internal trigger function: %',fn_name;
    END IF;
    SELECT count(*) INTO matching_triggers
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    WHERE t.tgfoid=fn_oid AND NOT t.tgisinternal
      AND pg_get_userbyid(c.relowner)='postgres';
    IF matching_triggers=0 OR EXISTS(
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      WHERE t.tgfoid=fn_oid AND NOT t.tgisinternal
        AND pg_get_userbyid(c.relowner)<>'postgres'
    ) THEN
      RAISE EXCEPTION 'Unsafe or missing trigger ownership: %',fn_name;
    END IF;
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION public.%I() FROM PUBLIC, anon, authenticated',
      fn_name
    );
  END LOOP;
END $security$;

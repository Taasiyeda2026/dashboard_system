-- The finance PDF Edge Function reads the reserved account plus its line and meeting snapshots
-- using SUPABASE_SERVICE_ROLE_KEY. A prior permissions hardening migration removed service_role
-- SELECT on these three tables, causing PostgREST 403 after a successful reservation.
-- Restore read-only access to just these three finance tables. Keep RLS enabled and do not
-- broaden authenticated/anon grants, modify existing records, or change RPC execution.
grant select on table
  public.finance_transaction_accounts,
  public.finance_transaction_account_lines,
  public.finance_transaction_account_meetings
to service_role;

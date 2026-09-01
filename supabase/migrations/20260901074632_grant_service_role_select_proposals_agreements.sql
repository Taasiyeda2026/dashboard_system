-- quote-signature-reminder runs with SUPABASE_SERVICE_ROLE_KEY and needs
-- read-only access to count pending proposal signatures.
-- Keep the permission minimal: the reminder does not insert, update, or delete.
grant select on table public.proposals_agreements to service_role;

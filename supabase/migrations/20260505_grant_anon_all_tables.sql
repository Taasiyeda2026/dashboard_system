-- Migration: Grant anon/authenticated access to all app tables
-- Required in addition to RLS policies — table-level GRANT must exist
-- for Supabase to allow the anon role to reach the RLS check at all.
-- Safe to re-run (idempotent).

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_long              TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_short             TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_meetings      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_instructors   TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contacts_schools       TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lists                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.edit_requests          TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations_private_notes TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users                  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.settings               TO anon, authenticated;

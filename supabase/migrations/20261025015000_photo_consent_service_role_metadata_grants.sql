-- Restore narrowly scoped service-role access for signed photo consent metadata.
-- Only the deployed photo-consent-sharepoint Edge Function uses these privileges
-- after validating the caller and the instructor's activity assignment.
-- This is intentionally NOT an anon or authenticated policy broadening.
-- Deployed to the existing Dashboard Supabase project on 2026-10-25.
grant select, insert on table public.activity_photo_consent_files to service_role;

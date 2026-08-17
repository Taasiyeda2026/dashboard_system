-- The employee-file Edge Function reads SharePoint server-side and persists the
-- resulting snapshot through PostgREST using SUPABASE_SERVICE_ROLE_KEY.
-- Keep browser/user access unchanged and grant only the server service role the
-- minimum privileges required by that persistence path.

grant select on public.instructor_employee_folders to service_role;
grant select, insert, update on public.instructor_employee_document_status to service_role;

-- Complete table-level grants for the existing RLS design.
-- The projection is corrected separately in frontend/src/api.js:
-- "authority" is not a column of activity_school_contact_responsibles.
-- Authenticated users are permitted to read according to the existing SELECT policy.
-- INSERT/UPDATE remain guarded by activity_school_contact_responsibles_upsert_ops
-- (admin/operation_manager/domain_manager). No DELETE or anon access is granted.
-- Grants applied to the Dashboard production database on 2026-10-25.
grant select, insert, update on table public.activity_school_contact_responsibles to authenticated;

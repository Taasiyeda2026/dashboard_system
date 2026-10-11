-- Authorize signed photography consents by explicit per-user permission.
-- Assignment of manage_photo_consents is an operational user-permission setting
-- and is intentionally not hardcoded to employee identities in this migration.
drop policy if exists activity_photo_consent_files_admin on public.activity_photo_consent_files;
drop policy if exists activity_photo_consent_files_authorized on public.activity_photo_consent_files;
create policy activity_photo_consent_files_authorized
on public.activity_photo_consent_files for all to authenticated
using (
  exists (
    select 1 from public.get_current_app_user() u
    where u.is_active is true
      and lower(coalesce(u.permissions ->> 'manage_photo_consents', '')) in ('yes','true','1')
  )
)
with check (
  exists (
    select 1 from public.get_current_app_user() u
    where u.is_active is true
      and lower(coalesce(u.permissions ->> 'manage_photo_consents', '')) in ('yes','true','1')
  )
);

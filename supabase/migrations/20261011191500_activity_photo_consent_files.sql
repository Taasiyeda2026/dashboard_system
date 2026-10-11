-- Signed photography consents: metadata only. Files are held in private SharePoint.
create table if not exists public.activity_photo_consent_files (
  id uuid primary key default gen_random_uuid(),
  activity_id bigint not null references public.activities(id) on delete restrict,
  sp_drive_id text not null,
  sp_item_id text not null unique,
  sp_web_url text,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 6291456),
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists idx_activity_photo_consent_files_activity on public.activity_photo_consent_files(activity_id);
alter table public.activity_photo_consent_files enable row level security;
alter table public.activity_photo_consent_files force row level security;
drop policy if exists activity_photo_consent_files_admin on public.activity_photo_consent_files;
create policy activity_photo_consent_files_admin on public.activity_photo_consent_files
  for all to authenticated
  using (exists (
    select 1 from public.get_current_app_user() u
    where u.role = 'admin' and u.is_active = true
  ))
  with check (exists (
    select 1 from public.get_current_app_user() u
    where u.role = 'admin' and u.is_active = true
  ));
revoke all on public.activity_photo_consent_files from anon;
grant select, insert, update, delete on public.activity_photo_consent_files to authenticated;
comment on table public.activity_photo_consent_files is 'Activity-level signed photo consent document pointers only; binary files must remain in SharePoint.';

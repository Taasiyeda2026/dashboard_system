-- Signed activity completion approvals uploaded by instructors.
create table if not exists public.activity_completion_approval_uploads (
  id uuid primary key default gen_random_uuid(),
  activity_row_id text,
  activity_date date,
  instructor_emp_id text not null,
  instructor_name text,
  authority text,
  school text,
  file_path text not null,
  file_name text,
  mime_type text,
  file_size integer,
  uploaded_by_user_id text,
  uploaded_at timestamptz not null default now(),
  status text not null default 'uploaded',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  constraint activity_completion_approval_uploads_status_check check (status in ('uploaded', 'approved', 'rejected'))
);

create index if not exists activity_completion_approval_uploads_instructor_idx
  on public.activity_completion_approval_uploads (instructor_emp_id, activity_date);
create index if not exists activity_completion_approval_uploads_lookup_idx
  on public.activity_completion_approval_uploads (activity_date, authority, school);

insert into storage.buckets (id, name, public)
values ('completion-approvals', 'completion-approvals', false)
on conflict (id) do nothing;

alter table public.activity_completion_approval_uploads enable row level security;

drop policy if exists activity_completion_approval_uploads_select_own_or_ops on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_select_own_or_ops
on public.activity_completion_approval_uploads
for select
using (
  instructor_emp_id = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
  or exists (select 1 from public.users where auth_user_id = auth.uid() and role in ('admin', 'operation_manager', 'domain_manager'))
);

drop policy if exists activity_completion_approval_uploads_insert_own on public.activity_completion_approval_uploads;
create policy activity_completion_approval_uploads_insert_own
on public.activity_completion_approval_uploads
for insert
with check (
  instructor_emp_id = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
);

drop policy if exists completion_approvals_storage_insert_own on storage.objects;
create policy completion_approvals_storage_insert_own
on storage.objects
for insert
with check (
  bucket_id = 'completion-approvals'
  and split_part(name, '/', 1) = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
);

drop policy if exists completion_approvals_storage_select_own_or_ops on storage.objects;
create policy completion_approvals_storage_select_own_or_ops
on storage.objects
for select
using (
  bucket_id = 'completion-approvals'
  and (
    split_part(name, '/', 1) = (select emp_id from public.users where auth_user_id = auth.uid() limit 1)
    or exists (select 1 from public.users where auth_user_id = auth.uid() and role in ('admin', 'operation_manager', 'domain_manager'))
  )
);


-- Ensure the pilot instructor Itamar Yohai can log in through the existing users table.
insert into public.users (user_id, username, name, full_name, role, display_role, emp_id, is_active)
values ('1527', '1527', 'איתמר יוחאי', 'איתמר יוחאי', 'instructor', 'instructor', '1527', true)
on conflict (user_id) do update set
  role = 'instructor',
  display_role = 'instructor',
  emp_id = '1527',
  is_active = true,
  name = coalesce(nullif(public.users.name, ''), excluded.name),
  full_name = coalesce(nullif(public.users.full_name, ''), excluded.full_name);

-- Manual override for the school contact responsible per activity date + school/frame.
create table if not exists public.activity_school_contact_responsibles (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null,
  school_id text not null default '',
  school text not null default '',
  responsible_emp_id text not null,
  responsible_name text,
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint activity_school_contact_responsibles_target_check check (school_id <> '' or school <> '')
);

create unique index if not exists activity_school_contact_responsibles_date_school_id_uidx
  on public.activity_school_contact_responsibles (activity_date, school_id)
  where school_id <> '';
create unique index if not exists activity_school_contact_responsibles_date_school_uidx
  on public.activity_school_contact_responsibles (activity_date, school)
  where school_id = '';

alter table public.activity_school_contact_responsibles enable row level security;

drop policy if exists activity_school_contact_responsibles_select_authenticated on public.activity_school_contact_responsibles;
create policy activity_school_contact_responsibles_select_authenticated
on public.activity_school_contact_responsibles
for select
using (auth.role() = 'authenticated');

drop policy if exists activity_school_contact_responsibles_upsert_ops on public.activity_school_contact_responsibles;
create policy activity_school_contact_responsibles_upsert_ops
on public.activity_school_contact_responsibles
for all
using (exists (select 1 from public.users where auth_user_id = auth.uid() and role in ('admin', 'operation_manager', 'domain_manager')))
with check (exists (select 1 from public.users where auth_user_id = auth.uid() and role in ('admin', 'operation_manager', 'domain_manager')));

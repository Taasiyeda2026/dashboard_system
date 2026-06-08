-- Personal program tracking table for Israa.
-- Access: Israa's specific auth user, or system admin (for maintenance).
-- All other roles — including operation_manager, finance, activities_manager — are blocked.
create table if not exists public.israa_program_tracking (
  id              uuid        primary key default gen_random_uuid(),
  owner_user_id   uuid        not null    default auth.uid(),

  authority       text,
  school_name     text,
  contact_person  text,
  phone           text,
  email           text,
  program_name    text,
  quantity        integer,
  total_cost      text,
  activity_date   date,
  status          text,
  notes           text,

  created_at      timestamptz not null    default now(),
  updated_at      timestamptz not null    default now()
);

alter table public.israa_program_tracking enable row level security;

-- SELECT: Israa or admin
create policy "israa_or_admin_select"
  on public.israa_program_tracking
  for select
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

-- INSERT: Israa only (admin cannot fabricate rows on her behalf)
create policy "israa_only_insert"
  on public.israa_program_tracking
  for insert
  with check (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    and owner_user_id = auth.uid()
  );

-- UPDATE: Israa or admin
create policy "israa_or_admin_update"
  on public.israa_program_tracking
  for update
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

-- DELETE: Israa or admin
create policy "israa_or_admin_delete"
  on public.israa_program_tracking
  for delete
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

grant select, insert, update, delete on public.israa_program_tracking to authenticated;

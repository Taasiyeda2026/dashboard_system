-- Revenue simulator entries for Israa's personal income tracker.
-- Access: Israa's specific auth user (full CRUD) and admin (for maintenance).
-- All other roles are blocked at the RLS layer.
create table if not exists public.israa_revenue_simulator_entries (
  id              uuid        primary key default gen_random_uuid(),
  owner_user_id   uuid        not null    default auth.uid(),

  payer_name      text,
  amount          numeric,

  created_at      timestamptz not null    default now(),
  updated_at      timestamptz not null    default now()
);

alter table public.israa_revenue_simulator_entries enable row level security;

-- SELECT: Israa or admin (admin can inspect/debug)
create policy "israa_sim_select"
  on public.israa_revenue_simulator_entries
  for select
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

-- INSERT: owner_user_id must equal auth.uid() (works for both Israa and admin)
create policy "israa_sim_insert"
  on public.israa_revenue_simulator_entries
  for insert
  with check (
    (
      auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
      or public.app_current_role() = 'admin'
    )
    and owner_user_id = auth.uid()
  );

-- UPDATE: Israa or admin
create policy "israa_sim_update"
  on public.israa_revenue_simulator_entries
  for update
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

-- DELETE: Israa or admin
create policy "israa_sim_delete"
  on public.israa_revenue_simulator_entries
  for delete
  using (
    auth.uid() = '92bfb9d9-1b17-4022-901a-5f7cf17a263a'::uuid
    or public.app_current_role() = 'admin'
  );

grant select, insert, update, delete on public.israa_revenue_simulator_entries to authenticated;

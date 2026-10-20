-- Ongoing manager-owned tasks remain editable after a weekly report is submitted.
-- Weekly management reports retain an immutable snapshot of work as it stood on submission.
create table if not exists public.manager_ongoing_tasks (
  id uuid primary key default gen_random_uuid(),
  manager_user_id text not null,
  school_year text not null check (school_year ~ '^20[0-9]{2}$'),
  subject text not null check (length(trim(subject)) > 0),
  activity_label text not null default '',
  category text not null default 'other' check (category in ('assignment','training','kit','materials','school','other')),
  owner_label text not null default '',
  due_date date,
  status text not null default 'open' check (status in ('open','in_progress','waiting','done')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists manager_ongoing_tasks_by_manager
 on public.manager_ongoing_tasks(manager_user_id,school_year,status,due_date);
create index if not exists manager_ongoing_tasks_recent
 on public.manager_ongoing_tasks(manager_user_id,school_year,updated_at desc);

alter table public.manager_ongoing_tasks enable row level security;
revoke all on public.manager_ongoing_tasks from anon;
grant select,insert,update on public.manager_ongoing_tasks to authenticated;

create policy "manager_ongoing_tasks_view" on public.manager_ongoing_tasks
for select to authenticated using (
  (select public.app_current_role()) in ('admin','operation_manager')
  or manager_user_id = (select public.manager_weekly_self_user_id())
);
create policy "manager_ongoing_tasks_add_self" on public.manager_ongoing_tasks
for insert to authenticated with check (
  manager_user_id = (select public.manager_weekly_self_user_id())
);
create policy "manager_ongoing_tasks_update_self" on public.manager_ongoing_tasks
for update to authenticated using (
  manager_user_id = (select public.manager_weekly_self_user_id())
) with check (
  manager_user_id = (select public.manager_weekly_self_user_id())
);
create trigger manager_ongoing_tasks_audit
before update on public.manager_ongoing_tasks
for each row execute function public.manager_weekly_audit_update();

alter table public.manager_weekly_reports
  add column if not exists tasks_snapshot jsonb not null default '[]'::jsonb
  check (jsonb_typeof(tasks_snapshot) = 'array');

-- Minimal payroll-control final approval table and private PDF bucket.
-- Not a generic approval/workflow/documents system.

create table if not exists public.payroll_control_approvals (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null check (btrim(employee_id) <> ''),
  employee_name text not null default '',
  month_key text not null check (month_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  approved_by_user_id uuid not null default auth.uid(),
  approved_by_name text not null default '',
  approved_at timestamptz not null default now(),
  status text not null default 'approved_for_payroll'
    check (status = 'approved_for_payroll'),
  approval_text_version text not null,
  pdf_path text,
  pdf_file_name text,
  approved_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (employee_id, month_key)
);

create index if not exists payroll_control_approvals_month_idx
  on public.payroll_control_approvals (month_key, approved_at desc);

create or replace function public.set_payroll_control_approvals_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists payroll_control_approvals_updated_at on public.payroll_control_approvals;
create trigger payroll_control_approvals_updated_at
before update on public.payroll_control_approvals
for each row execute function public.set_payroll_control_approvals_updated_at();

create or replace function public.app_can_write_payroll_control_approvals()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_current_role() in (
      'admin',
      'operation_manager',
      'instructor_manager',
      'activities_manager',
      'domain_manager'
    ),
    false
  )
$$;

create or replace function public.app_can_read_payroll_control_approvals()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    public.app_current_role() in ('admin', 'finance')
    or public.app_has_permission('finance_access')
    or public.app_has_permission('view_finance'),
    false
  )
$$;

revoke all on function public.app_can_write_payroll_control_approvals() from public, anon;
revoke all on function public.app_can_read_payroll_control_approvals() from public, anon;
grant execute on function public.app_can_write_payroll_control_approvals() to authenticated;
grant execute on function public.app_can_read_payroll_control_approvals() to authenticated;

alter table public.payroll_control_approvals enable row level security;

drop policy if exists payroll_control_approvals_select on public.payroll_control_approvals;
create policy payroll_control_approvals_select
on public.payroll_control_approvals
for select
to authenticated
using (
  approved_by_user_id = (select auth.uid())
  or (select public.app_can_read_payroll_control_approvals())
);

drop policy if exists payroll_control_approvals_insert on public.payroll_control_approvals;
create policy payroll_control_approvals_insert
on public.payroll_control_approvals
for insert
to authenticated
with check (
  (select public.app_can_write_payroll_control_approvals())
  and approved_by_user_id = (select auth.uid())
  and status = 'approved_for_payroll'
);

drop policy if exists payroll_control_approvals_update on public.payroll_control_approvals;
create policy payroll_control_approvals_update
on public.payroll_control_approvals
for update
to authenticated
using (
  (select public.app_can_write_payroll_control_approvals())
  and (
    approved_by_user_id = (select auth.uid())
    or (select public.app_current_role()) = 'admin'
  )
)
with check (
  (select public.app_can_write_payroll_control_approvals())
  and (
    approved_by_user_id = (select auth.uid())
    or (select public.app_current_role()) = 'admin'
  )
  and status = 'approved_for_payroll'
);

grant select, insert, update on public.payroll_control_approvals to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payroll-control-pdfs',
  'payroll-control-pdfs',
  false,
  10485760,
  array['application/pdf']::text[]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = 10485760,
  allowed_mime_types = array['application/pdf']::text[];

drop policy if exists payroll_control_pdfs_select on storage.objects;
create policy payroll_control_pdfs_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payroll-control-pdfs'
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select public.app_can_read_payroll_control_approvals())
  )
);

drop policy if exists payroll_control_pdfs_insert on storage.objects;
create policy payroll_control_pdfs_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payroll-control-pdfs'
  and (select public.app_can_write_payroll_control_approvals())
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists payroll_control_pdfs_update on storage.objects;
create policy payroll_control_pdfs_update
on storage.objects
for update
to authenticated
using (
  bucket_id = 'payroll-control-pdfs'
  and (select public.app_can_write_payroll_control_approvals())
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select public.app_current_role()) = 'admin'
  )
)
with check (
  bucket_id = 'payroll-control-pdfs'
  and (select public.app_can_write_payroll_control_approvals())
  and (
    (storage.foldername(name))[1] = (select auth.uid()::text)
    or (select public.app_current_role()) = 'admin'
  )
);

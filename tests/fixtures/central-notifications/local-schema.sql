-- Disposable localhost schema for integration tests, not a production migration.
-- This is a reduced operational schema; actual attendance RPC bodies are loaded
-- unchanged from the repository by the runner. No live data or remote writes.
create schema if not exists private;
create table public.users(user_id text primary key,auth_user_id uuid unique references auth.users(id),username text,role text,is_active boolean default true,full_name text,name text,emp_id text,permissions jsonb default '{}',approve_proposals_agreements boolean,manage_proposals_agreements boolean);
create table public.profiles(id uuid primary key references auth.users(id),email text,full_name text,role text default 'employee',is_active boolean default true,can_access_personal_reports boolean default true);
create table public.employee_profiles(user_id text primary key,emp_id text,direct_manager text,full_name text);
create table public.contacts_instructors(emp_id bigint primary key,full_name text,direct_manager text,active text default 'yes');
create table public.personal_reports(id uuid primary key default gen_random_uuid(),employee_id uuid references auth.users(id),report_month int,report_year int,status text default 'draft',correction_note text,correction_requested_at timestamptz,correction_requested_by uuid,submitted_at timestamptz,approved_at timestamptz,paid_at timestamptz,finance_notes text,updated_at timestamptz default now());
create table public.proposals_agreements(id uuid primary key default gen_random_uuid(),created_by text,status text default 'draft',archived_at timestamptz,quote_number text,client_authority text,signature_meta jsonb,approved_by uuid,approved_at timestamptz,approval_note text);
create table public.attendance_month_approvals(id uuid primary key default gen_random_uuid(),emp_id bigint,month_key text,status text default 'open',submitted_at timestamptz,locked_at timestamptz,locked_by uuid,released_at timestamptz,released_by uuid,updated_at timestamptz default now(),submitted_by_name text,manager_approved_at timestamptz,manager_approved_by_user_id uuid,manager_approved_by_name text,manager_pdf_sharepoint_url text,manager_pdf_sharepoint_item_id text,manager_pdf_file_name text,manager_pdf_version int default 0,manager_approved_snapshot jsonb default '{}',submitted_on_behalf boolean default false,submitted_on_behalf_by_user_id uuid,submitted_on_behalf_by_name text,submitted_on_behalf_reason text,submitted_on_behalf_at timestamptz,unique(emp_id,month_key));
create table public.payroll_control_approvals(id uuid primary key default gen_random_uuid(),employee_id text,employee_name text,month_key text,status text,approved_by_user_id uuid,approved_by_name text,approved_at timestamptz,approval_text_version text,pdf_path text,pdf_file_name text,approved_snapshot jsonb,payroll_dispatched_at timestamptz,payroll_dispatched_by_user_id uuid,payroll_dispatched_by_name text,created_at timestamptz default now(),updated_at timestamptz default now(),unique(employee_id,month_key));
create table public.payroll_attendance_dispatches(id uuid primary key default gen_random_uuid(),approval_id uuid unique,employee_id text,month_key text,dispatched_at timestamptz,dispatched_by_user_id uuid,dispatched_by_name text);
create table public.attendance_records(id uuid primary key default gen_random_uuid(),emp_id bigint,report_date date,generation_kind text,updated_at timestamptz default now());
create table public.attendance_manager_record_reviews(record_id uuid primary key,employee_id bigint,month_key text,status text,approved_record_updated_at timestamptz);
create table public.attendance_travel_compensations(source_attendance_record_id uuid,emp_id bigint,review_status text);
-- Source access for these test identities. Notification RLS comes from the actual PR migration.
create function private.fixture_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$select exists(select 1 from users where auth_user_id=auth.uid() and role='admin' and is_active)$$;
revoke all on function private.fixture_admin() from public,anon;grant usage on schema private to authenticated;grant execute on function private.fixture_admin() to authenticated;
alter table users enable row level security;
create policy own_app_user on users for select to authenticated using(auth_user_id=auth.uid());
alter table profiles enable row level security;
create policy profile_select on profiles for select to authenticated using(id=auth.uid() or private.fixture_admin());
create policy profile_update on profiles for update to authenticated using(id=auth.uid() or private.fixture_admin()) with check(id=auth.uid() or private.fixture_admin());
alter table personal_reports enable row level security;
create policy report_select on personal_reports for select to authenticated using(employee_id=auth.uid() or private.fixture_admin());
create policy report_insert on personal_reports for insert to authenticated with check(employee_id=auth.uid());
create policy report_update on personal_reports for update to authenticated using((employee_id=auth.uid() and status in('draft','needs_correction')) or private.fixture_admin()) with check((employee_id=auth.uid() and status in('draft','needs_correction','submitted')) or private.fixture_admin());
alter table proposals_agreements enable row level security;
create policy proposal_select on proposals_agreements for select to authenticated using(created_by=(select user_id from users where auth_user_id=auth.uid()) or private.fixture_admin());
create policy proposal_insert on proposals_agreements for insert to authenticated with check(created_by=(select user_id from users where auth_user_id=auth.uid()));
create policy proposal_update on proposals_agreements for update to authenticated using(created_by=(select user_id from users where auth_user_id=auth.uid()) or private.fixture_admin());
alter table payroll_control_approvals enable row level security;
create policy payroll_access on payroll_control_approvals to authenticated using(private.fixture_admin() or (status='approved_for_payroll' and exists(select 1 from users where auth_user_id=auth.uid() and role='finance')));
grant select on users,profiles,personal_reports,proposals_agreements,payroll_control_approvals to authenticated;
grant insert,update on personal_reports,proposals_agreements to authenticated;
grant update on profiles to authenticated;
grant insert,update on payroll_control_approvals to authenticated;

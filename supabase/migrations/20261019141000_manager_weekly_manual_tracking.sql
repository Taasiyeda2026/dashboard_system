-- Manager self-entered weekly planning and learning; no activity-source replication.
create table if not exists public.manager_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  manager_user_id text not null,
  school_year text not null check (school_year ~ '^20[0-9]{2}$'),
  week_start date not null check (extract(dow from week_start) = 0),
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  openings jsonb not null default '[]'::jsonb check (jsonb_typeof(openings) = 'array'),
  highlights text not null default '',
  next_steps text not null default '',
  blockers text not null default '',
  instructor_notes text not null default '',
  kit_notes text not null default '',
  status text not null default 'draft' check (status in ('draft','submitted')),
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint manager_weekly_reports_unique unique (manager_user_id, school_year, week_start),
  constraint manager_weekly_reports_submitted_consistent check (status <> 'submitted' or submitted_at is not null)
);
create index if not exists manager_weekly_reports_period_idx
  on public.manager_weekly_reports (school_year, manager_user_id, week_start desc);

create table if not exists public.manager_program_learning (
  id uuid primary key default gen_random_uuid(),
  manager_user_id text not null,
  school_year text not null check (school_year ~ '^20[0-9]{2}$'),
  program_name text not null check (length(trim(program_name)) > 0),
  purpose text not null default '',
  key_content text not null default '',
  instructor_training text not null default '',
  required_kits text not null default '',
  risks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  constraint manager_program_learning_unique unique (manager_user_id, school_year, program_name)
);

-- Security-definer identity helper mirrors existing role mapping, never trusts client manager selection.
create or replace function public.manager_weekly_self_user_id()
returns text language sql stable security definer
set search_path = public, pg_temp as $$
  select u.user_id from public.users u
  where u.auth_user_id = auth.uid() and u.is_active is true
    and u.role = 'activities_manager'
  limit 1
$$;
revoke all on function public.manager_weekly_self_user_id() from public;
grant execute on function public.manager_weekly_self_user_id() to authenticated;

create or replace function public.manager_weekly_audit_update()
returns trigger language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end
$$;
drop trigger if exists manager_weekly_reports_audit on public.manager_weekly_reports;
create trigger manager_weekly_reports_audit before update on public.manager_weekly_reports
for each row execute function public.manager_weekly_audit_update();
drop trigger if exists manager_program_learning_audit on public.manager_program_learning;
create trigger manager_program_learning_audit before update on public.manager_program_learning
for each row execute function public.manager_weekly_audit_update();

alter table public.manager_weekly_reports enable row level security;
alter table public.manager_program_learning enable row level security;
revoke all on public.manager_weekly_reports from anon;
revoke all on public.manager_program_learning from anon;
grant select, insert, update on public.manager_weekly_reports to authenticated;
grant select, insert, update on public.manager_program_learning to authenticated;

create policy "manager_weekly_reports_view" on public.manager_weekly_reports
for select to authenticated using (
  public.app_current_role() in ('admin', 'operation_manager')
  or manager_user_id = public.manager_weekly_self_user_id()
);
create policy "manager_weekly_reports_insert_self" on public.manager_weekly_reports
for insert to authenticated with check (
  manager_user_id = public.manager_weekly_self_user_id()
);
create policy "manager_weekly_reports_update_drafts_self" on public.manager_weekly_reports
for update to authenticated using (
  manager_user_id = public.manager_weekly_self_user_id() and status = 'draft'
) with check (
  manager_user_id = public.manager_weekly_self_user_id()
);
create policy "manager_program_learning_view" on public.manager_program_learning
for select to authenticated using (
  public.app_current_role() in ('admin', 'operation_manager')
  or manager_user_id = public.manager_weekly_self_user_id()
);
create policy "manager_program_learning_insert_self" on public.manager_program_learning
for insert to authenticated with check (
  manager_user_id = public.manager_weekly_self_user_id()
);
create policy "manager_program_learning_update_self" on public.manager_program_learning
for update to authenticated using (
  manager_user_id = public.manager_weekly_self_user_id()
) with check (
  manager_user_id = public.manager_weekly_self_user_id()
);

-- Directory restricted to authorized board users, so operations can review without broad users-table grants.
create or replace function public.manager_weekly_manager_directory()
returns table(manager_user_id text, manager_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.user_id, coalesce(nullif(trim(u.full_name), ''), u.name, u.user_id)
  from public.users u
  where u.role = 'activities_manager' and u.is_active is true
    and (
      public.app_current_role() in ('admin', 'operation_manager')
      or u.auth_user_id = auth.uid()
    )
  order by 2
$$;
revoke all on function public.manager_weekly_manager_directory() from public;
grant execute on function public.manager_weekly_manager_directory() to authenticated;

-- Completeness is also checked in PostgreSQL, not only in the browser.
create or replace function public.manager_weekly_valid_submission(
  p_metrics jsonb, p_openings jsonb, p_week date, p_highlights text, p_next_steps text
) returns boolean language plpgsql immutable set search_path = public, pg_temp as $$
declare metric_key text; item jsonb; d date; n numeric;
begin
  if jsonb_typeof(p_metrics) <> 'object' or jsonb_typeof(p_openings) <> 'array'
     or nullif(trim(coalesce(p_highlights,'')), '') is null
     or nullif(trim(coalesce(p_next_steps,'')), '') is null then return false; end if;
  foreach metric_key in array array['activities','schools','unassigned','planned','started','training','materials','kits','issues'] loop
    if jsonb_typeof(p_metrics->metric_key) <> 'number' then return false; end if;
    n := (p_metrics->>metric_key)::numeric;
    if n < 0 or n <> trunc(n) or n > 2147483647 then return false; end if;
  end loop;
  if jsonb_array_length(p_openings) <> (p_metrics->>'planned')::integer then return false; end if;
  for item in select value from jsonb_array_elements(p_openings) loop
    if nullif(trim(coalesce(item->>'school','')), '') is null
       or nullif(trim(coalesce(item->>'program','')), '') is null
       or nullif(trim(coalesce(item->>'instructor','')), '') is null
       or coalesce(item->>'start_date','') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
    begin
      d := (item->>'start_date')::date;
    exception when others then return false;
    end;
    if d < p_week or d > p_week + 6 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end
$$;
alter table public.manager_weekly_reports
  add constraint manager_weekly_reports_submit_valid
  check (status <> 'submitted' or public.manager_weekly_valid_submission(metrics, openings, week_start, highlights, next_steps));

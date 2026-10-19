-- Separate confidential manager observation feedback from student/instructor campaign feedback.
-- Apply in Supabase only after review; creating this file does not modify production.
create table if not exists public.instructor_observations (
  id uuid primary key default gen_random_uuid(),
  emp_id bigint not null references public.contacts_instructors(emp_id) on update cascade on delete restrict,
  instructor_name text not null,
  created_by uuid not null default auth.uid(),
  observer_name text not null default '',
  observation_date date,
  details jsonb not null default '{}'::jsonb,
  responses jsonb not null default '{}'::jsonb,
  comments jsonb not null default '{}'::jsonb,
  overall_rating smallint check (overall_rating between 1 and 5),
  strengths text not null default '',
  improvements text not null default '',
  summary text not null default '',
  status text not null default 'draft' check (status in ('draft','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instructor_observation_completed_has_date check (
    status <> 'completed' or (observation_date is not null and completed_at is not null)
  )
);
create index if not exists instructor_observations_emp_date_idx
  on public.instructor_observations (emp_id, created_at desc);
create index if not exists instructor_observations_owner_idx
  on public.instructor_observations (created_by, status);

-- A narrow permission independent of campaign feedback.
create or replace function public.can_manage_instructor_observations()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $fn$
  select exists(
    select 1
      from public.users u
     where u.auth_user_id = auth.uid()
       and u.is_active = true
       and u.role in ('admin','activities_manager','operation_manager')
       and (u.role = 'admin' or public.app_has_permission('view_instructors'))
  );
$fn$;
revoke all on function public.can_manage_instructor_observations() from public, anon;
grant execute on function public.can_manage_instructor_observations() to authenticated;

create or replace function public.instructor_observation_immutable()
returns trigger
language plpgsql set search_path = public, pg_temp
as $fn$
begin
  if old.status = 'completed' then
    raise exception 'completed_instructor_observation_is_immutable' using errcode = '42501';
  end if;
  if new.created_by is distinct from old.created_by
     or new.emp_id is distinct from old.emp_id
     or new.instructor_name is distinct from old.instructor_name
     or new.created_at is distinct from old.created_at then
    raise exception 'instructor_observation_identity_is_immutable' using errcode = '42501';
  end if;
  if new.status = 'completed' and (
    new.overall_rating is null
    or btrim(new.strengths) = ''
    or btrim(new.improvements) = ''
    or btrim(new.summary) = ''
    or new.observation_date is null
    or new.completed_at is null
    or nullif(btrim(new.observer_name), '') is null
    or nullif(btrim(new.details->>'course'), '') is null
    or nullif(btrim(new.details->>'school'), '') is null
    or nullif(btrim(new.details->>'class'), '') is null
    or coalesce(new.details->>'school_staff','') not in ('כן','לא')
    or coalesce(new.details->>'meeting','') !~ '^[1-9][0-9]*$'
    or coalesce(new.details->>'students','') !~ '^[1-9][0-9]*$'
    or not (new.responses ?& array[
      '0-0','0-1','1-0','1-1','1-2','2-0','2-1','2-2',
      '3-0','3-1','4-0','4-1','4-2','5-0','5-1'
    ])
  ) then
    raise exception 'instructor_observation_summary_incomplete' using errcode = '23514';
  end if;
  new.updated_at = now();
  return new;
end;
$fn$;
drop trigger if exists instructor_observations_immutable on public.instructor_observations;
create trigger instructor_observations_immutable
  before update on public.instructor_observations
  for each row execute function public.instructor_observation_immutable();

alter table public.instructor_observations enable row level security;
drop policy if exists instructor_observations_read on public.instructor_observations;
create policy instructor_observations_read on public.instructor_observations
for select to authenticated using (
  public.can_manage_instructor_observations()
  and (created_by = auth.uid() or public.app_current_role() = 'admin')
);
drop policy if exists instructor_observations_insert on public.instructor_observations;
create policy instructor_observations_insert on public.instructor_observations
for insert to authenticated with check (
  public.can_manage_instructor_observations()
  and created_by = auth.uid()
  and status = 'draft'
);
drop policy if exists instructor_observations_update on public.instructor_observations;
create policy instructor_observations_update on public.instructor_observations
for update to authenticated
using (
  public.can_manage_instructor_observations()
  and created_by = auth.uid()
  and status = 'draft'
)
with check (
  public.can_manage_instructor_observations()
  and created_by = auth.uid()
  and status in ('draft','completed')
);

revoke all on public.instructor_observations from public, anon;
grant select, insert, update on public.instructor_observations to authenticated;
-- Deliberately no DELETE policy: completed records form part of the management audit trail.
comment on table public.instructor_observations is
'Confidential instructor observation reviews. Separate from feedback campaigns; drafts editable by creator, completed reports immutable.';

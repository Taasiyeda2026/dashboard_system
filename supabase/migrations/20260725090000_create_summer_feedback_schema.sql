-- Summer 2026 instructor feedback. Idempotent production migration.
create schema if not exists private;

create or replace function private.is_summer_feedback_manager()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id=(select auth.uid())
      and coalesce(u.is_active,false)
      and u.role in ('admin','operation_manager','activities_manager','instructor_manager','domain_manager')
  );
$$;
revoke all on function private.is_summer_feedback_manager() from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.is_summer_feedback_manager() to authenticated;

create table if not exists public.summer_feedback_cycles(
  id uuid primary key default gen_random_uuid(),
  cycle_key text not null unique,
  title text not null,
  activity_season text not null default 'summer_2026',
  status text not null default 'open' check(status in ('draft','open','closed')),
  question_version integer not null default 1 check(question_version>0),
  opens_at timestamptz, closes_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.summer_feedback_assignments(
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.summer_feedback_cycles(id) on delete cascade,
  instructor_auth_user_id uuid not null references auth.users(id) on delete cascade,
  instructor_emp_id text not null, instructor_name text not null,
  activity_key text not null, activity_name text not null,
  activity_type text not null default '', activity_count integer not null check(activity_count>0),
  grade_labels text[] not null default '{}'::text[], source_note text not null default '',
  created_at timestamptz not null default now(),
  unique(cycle_id,instructor_auth_user_id,activity_key),
  unique(id,cycle_id,instructor_auth_user_id)
);
create index if not exists summer_feedback_assignments_user_idx on public.summer_feedback_assignments(instructor_auth_user_id,cycle_id);
create index if not exists summer_feedback_assignments_activity_idx on public.summer_feedback_assignments(cycle_id,activity_key);

create table if not exists public.summer_feedback_responses(
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.summer_feedback_cycles(id) on delete cascade,
  instructor_auth_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'draft' check(status in ('draft','submitted','reopened')),
  general_answers jsonb not null default '{}'::jsonb check(jsonb_typeof(general_answers)='object'),
  summary_answers jsonb not null default '{}'::jsonb check(jsonb_typeof(summary_answers)='object'),
  started_at timestamptz not null default now(), submitted_at timestamptz, reopened_at timestamptz,
  updated_at timestamptz not null default now(), version bigint not null default 1,
  unique(cycle_id,instructor_auth_user_id),
  unique(id,cycle_id,instructor_auth_user_id)
);
create index if not exists summer_feedback_responses_user_idx on public.summer_feedback_responses(instructor_auth_user_id,cycle_id);

create table if not exists public.summer_feedback_activity_ratings(
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null, assignment_id uuid not null, cycle_id uuid not null,
  instructor_auth_user_id uuid not null,
  age_fit smallint check(age_fit between 1 and 5), time_fit smallint check(time_fit between 1 and 5),
  equipment_quality smallint check(equipment_quality between 1 and 5), student_success smallint check(student_success between 1 and 5),
  needs_improvement boolean not null default false, success_highlight boolean not null default false,
  improvement_categories text[] not null default '{}'::text[], success_reasons text[] not null default '{}'::text[],
  improvement_note text not null default '', success_note text not null default '', additional_note text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(response_id,assignment_id),
  foreign key(response_id,cycle_id,instructor_auth_user_id) references public.summer_feedback_responses(id,cycle_id,instructor_auth_user_id) on delete cascade,
  foreign key(assignment_id,cycle_id,instructor_auth_user_id) references public.summer_feedback_assignments(id,cycle_id,instructor_auth_user_id) on delete cascade
);
create index if not exists summer_feedback_ratings_user_idx on public.summer_feedback_activity_ratings(instructor_auth_user_id,cycle_id);
create index if not exists summer_feedback_ratings_assignment_idx on public.summer_feedback_activity_ratings(assignment_id);

create or replace function public.summer_feedback_touch_response()
returns trigger language plpgsql set search_path=''
as $$
begin
  new.updated_at:=now();
  if tg_op='INSERT' then new.started_at:=coalesce(new.started_at,now()); new.version:=1;
  else
    new.version:=old.version+1;
    if old.status is distinct from new.status then
      if new.status='submitted' then new.submitted_at:=now(); end if;
      if new.status='reopened' then new.reopened_at:=now(); end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists summer_feedback_touch_response_trg on public.summer_feedback_responses;
create trigger summer_feedback_touch_response_trg before insert or update on public.summer_feedback_responses
for each row execute function public.summer_feedback_touch_response();

create or replace function public.summer_feedback_touch_rating()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at:=now(); return new; end $$;
drop trigger if exists summer_feedback_touch_rating_trg on public.summer_feedback_activity_ratings;
create trigger summer_feedback_touch_rating_trg before insert or update on public.summer_feedback_activity_ratings
for each row execute function public.summer_feedback_touch_rating();

create or replace function public.summer_feedback_enforce_selection_limits()
returns trigger language plpgsql set search_path=''
as $$
declare improvements integer; successes integer;
begin
  select count(*) filter(where needs_improvement),count(*) filter(where success_highlight)
    into improvements,successes from public.summer_feedback_activity_ratings where response_id=new.response_id;
  if improvements>3 then raise exception 'ניתן לבחור עד שלוש פעילויות לשיפור'; end if;
  if successes>3 then raise exception 'ניתן לבחור עד שלוש פעילויות מוצלחות'; end if;
  return null;
end $$;
drop trigger if exists summer_feedback_selection_limits_trg on public.summer_feedback_activity_ratings;
create constraint trigger summer_feedback_selection_limits_trg after insert or update of needs_improvement,success_highlight
on public.summer_feedback_activity_ratings deferrable initially immediate
for each row execute function public.summer_feedback_enforce_selection_limits();

alter table public.summer_feedback_cycles enable row level security;
alter table public.summer_feedback_assignments enable row level security;
alter table public.summer_feedback_responses enable row level security;
alter table public.summer_feedback_activity_ratings enable row level security;
revoke all on public.summer_feedback_cycles,public.summer_feedback_assignments,public.summer_feedback_responses,public.summer_feedback_activity_ratings from anon;
grant select on public.summer_feedback_cycles,public.summer_feedback_assignments to authenticated;
grant select,insert,update on public.summer_feedback_responses,public.summer_feedback_activity_ratings to authenticated;
grant all on public.summer_feedback_cycles,public.summer_feedback_assignments,public.summer_feedback_responses,public.summer_feedback_activity_ratings to service_role;

-- Replace both old descriptive names and current concise names, so the migration stays idempotent.
drop policy if exists "summer feedback cycles readable" on public.summer_feedback_cycles;
drop policy if exists cycles_read on public.summer_feedback_cycles;
create policy cycles_read on public.summer_feedback_cycles for select to authenticated
using(status in ('open','closed') or (select private.is_summer_feedback_manager()));

drop policy if exists "summer feedback assignments readable" on public.summer_feedback_assignments;
drop policy if exists assignments_read on public.summer_feedback_assignments;
create policy assignments_read on public.summer_feedback_assignments for select to authenticated
using(instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()));

drop policy if exists "summer feedback responses readable" on public.summer_feedback_responses;
drop policy if exists responses_read on public.summer_feedback_responses;
create policy responses_read on public.summer_feedback_responses for select to authenticated
using(instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()));

drop policy if exists "summer feedback responses insert own" on public.summer_feedback_responses;
drop policy if exists responses_insert_own on public.summer_feedback_responses;
create policy responses_insert_own on public.summer_feedback_responses for insert to authenticated
with check(
  instructor_auth_user_id=(select auth.uid()) and status='draft'
  and exists(select 1 from public.summer_feedback_assignments a where a.cycle_id=summer_feedback_responses.cycle_id and a.instructor_auth_user_id=(select auth.uid()))
  and exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status='open'
    and (c.opens_at is null or c.opens_at<=now()) and (c.closes_at is null or c.closes_at>=now()))
);

drop policy if exists "summer feedback responses update own draft" on public.summer_feedback_responses;
drop policy if exists responses_update_own on public.summer_feedback_responses;
create policy responses_update_own on public.summer_feedback_responses for update to authenticated
using(
  instructor_auth_user_id=(select auth.uid()) and status in ('draft','reopened')
  and exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status='open'
    and (c.opens_at is null or c.opens_at<=now()) and (c.closes_at is null or c.closes_at>=now()))
)
with check(
  instructor_auth_user_id=(select auth.uid()) and status in ('draft','reopened','submitted')
  and exists(select 1 from public.summer_feedback_cycles c where c.id=summer_feedback_responses.cycle_id and c.status='open'
    and (c.opens_at is null or c.opens_at<=now()) and (c.closes_at is null or c.closes_at>=now()))
);

drop policy if exists "summer feedback responses managers update" on public.summer_feedback_responses;
drop policy if exists responses_update_manager on public.summer_feedback_responses;
create policy responses_update_manager on public.summer_feedback_responses for update to authenticated
using((select private.is_summer_feedback_manager())) with check((select private.is_summer_feedback_manager()));

drop policy if exists "summer feedback ratings readable" on public.summer_feedback_activity_ratings;
drop policy if exists ratings_read on public.summer_feedback_activity_ratings;
create policy ratings_read on public.summer_feedback_activity_ratings for select to authenticated
using(instructor_auth_user_id=(select auth.uid()) or (select private.is_summer_feedback_manager()));

drop policy if exists "summer feedback ratings insert own" on public.summer_feedback_activity_ratings;
drop policy if exists ratings_insert_own on public.summer_feedback_activity_ratings;
create policy ratings_insert_own on public.summer_feedback_activity_ratings for insert to authenticated
with check(
  instructor_auth_user_id=(select auth.uid())
  and exists(select 1 from public.summer_feedback_responses r where r.id=summer_feedback_activity_ratings.response_id
    and r.instructor_auth_user_id=(select auth.uid()) and r.status in ('draft','reopened'))
);

drop policy if exists "summer feedback ratings update own" on public.summer_feedback_activity_ratings;
drop policy if exists ratings_update_own on public.summer_feedback_activity_ratings;
create policy ratings_update_own on public.summer_feedback_activity_ratings for update to authenticated
using(
  instructor_auth_user_id=(select auth.uid())
  and exists(select 1 from public.summer_feedback_responses r where r.id=summer_feedback_activity_ratings.response_id
    and r.instructor_auth_user_id=(select auth.uid()) and r.status in ('draft','reopened'))
)
with check(
  instructor_auth_user_id=(select auth.uid())
  and exists(select 1 from public.summer_feedback_responses r where r.id=summer_feedback_activity_ratings.response_id
    and r.instructor_auth_user_id=(select auth.uid()) and r.status in ('draft','reopened'))
);

notify pgrst,'reload schema';

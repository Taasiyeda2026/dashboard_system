-- Unified operational instructor scheduling: requirements, restrictions, cache and immutable decision audit.
alter table public.instructor_scheduling_profiles
  add column if not exists gender text,
  add column if not exists instruction_languages text[] not null default array['he']::text[],
  add column if not exists education_levels text[] not null default array['elementary','middle_school','high_school']::text[],
  add column if not exists course_restriction_mode text not null default 'all',
  add column if not exists course_ids text[] not null default '{}',
  add column if not exists blocked_authorities text[] not null default '{}',
  add column if not exists blocked_schools text[] not null default '{}',
  add column if not exists matching_note text;
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_gender_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_gender_check check (gender in ('female','male'));
alter table public.instructor_scheduling_profiles drop constraint if exists instructor_scheduling_profiles_course_mode_check;
alter table public.instructor_scheduling_profiles add constraint instructor_scheduling_profiles_course_mode_check check (course_restriction_mode in ('all','allow_only','block_selected'));

alter table public.activities
  add column if not exists education_level text,
  add column if not exists blocked_instructor_ids text[] not null default '{}',
  add column if not exists allowed_instructor_ids text[] not null default '{}',
  add column if not exists scheduling_note text;
alter table public.activities drop constraint if exists activities_education_level_check;
alter table public.activities add constraint activities_education_level_check check (education_level is null or education_level in ('elementary','middle_school','high_school'));

create table if not exists public.scheduling_travel_cache (
  origin_key text not null,
  destination_key text not null,
  distance_km numeric,
  duration_minutes integer,
  provider text not null default 'google',
  calculated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  primary key (origin_key, destination_key)
);
create table if not exists public.instructor_assignment_audit (
  id uuid primary key default gen_random_uuid(),
  activity_id text not null,
  selected_emp_id text not null,
  selected_instructor_name text not null,
  top_recommended_emp_id text,
  selected_score integer,
  top_score integer,
  decision_type text not null check (decision_type in ('draft','approved','overridden','exception_approved')),
  reason text,
  selected_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists instructor_assignment_audit_activity_idx on public.instructor_assignment_audit(activity_id, created_at desc);
alter table public.scheduling_travel_cache enable row level security;
alter table public.instructor_assignment_audit enable row level security;
grant select on public.scheduling_travel_cache, public.instructor_assignment_audit to authenticated;
drop policy if exists scheduling_travel_cache_read on public.scheduling_travel_cache;
create policy scheduling_travel_cache_read on public.scheduling_travel_cache for select to authenticated using (true);
drop policy if exists instructor_assignment_audit_read on public.instructor_assignment_audit;
create policy instructor_assignment_audit_read on public.instructor_assignment_audit for select to authenticated using (true);
drop policy if exists instructor_scheduling_profiles_authenticated_read on public.instructor_scheduling_profiles;
create policy instructor_scheduling_profiles_authenticated_read on public.instructor_scheduling_profiles for select to authenticated using (true);
drop policy if exists instructor_availability_rules_authenticated_read on public.instructor_availability_rules;
create policy instructor_availability_rules_authenticated_read on public.instructor_availability_rules for select to authenticated using (true);
drop policy if exists instructor_availability_exceptions_authenticated_read on public.instructor_availability_exceptions;
create policy instructor_availability_exceptions_authenticated_read on public.instructor_availability_exceptions for select to authenticated using (true);

create or replace function public.assign_activity_instructor(
  p_activity_id text,
  p_emp_id bigint,
  p_instructor_name text,
  p_top_emp_id bigint,
  p_selected_score integer,
  p_top_score integer,
  p_decision_type text,
  p_reason text default null
)
returns public.activities
language plpgsql
security definer
set search_path=public
as $$
declare
  result public.activities;
  selected_instructor public.contacts_instructors;
  caller_role text := public.app_current_role();
begin
  if caller_role <> all(array['admin','operation_manager']) then
    raise exception 'scheduling_permission_denied' using errcode='42501';
  end if;
  if p_decision_type not in ('approved','overridden','exception_approved') then
    raise exception 'invalid_decision_type';
  end if;
  if (p_decision_type in ('overridden','exception_approved') or (p_top_emp_id is not null and p_emp_id <> p_top_emp_id))
     and nullif(btrim(p_reason),'') is null then
    raise exception 'scheduling_reason_required';
  end if;

  select * into selected_instructor
  from public.contacts_instructors
  where emp_id=p_emp_id;
  if not found then raise exception 'instructor_not_found'; end if;
  if lower(coalesce(selected_instructor.active::text,'yes')) in ('no','false','0','לא פעיל') then
    raise exception 'instructor_inactive';
  end if;
  if btrim(coalesce(selected_instructor.full_name,'')) <> btrim(coalesce(p_instructor_name,'')) then
    raise exception 'instructor_name_mismatch';
  end if;

  select * into result
  from public.activities
  where row_id=p_activity_id
  for update;
  if not found then raise exception 'activity_not_found'; end if;

  if exists (
    select 1
    from public.activities a
    where a.row_id<>p_activity_id
      and (a.emp_id::text=p_emp_id::text or a.emp_id_2::text=p_emp_id::text)
      and lower(coalesce(a.status::text,'')) not in ('סגור','נמחק','בוטל','closed','deleted','cancelled','canceled')
      and exists (
        select 1
        from generate_series(1,35) n
        where nullif(to_jsonb(a)->>('date_'||n),'') = any(
          array(
            select nullif(to_jsonb(result)->>('date_'||m),'')
            from generate_series(1,35) m
          )
        )
          and a.start_time < result.end_time
          and result.start_time < a.end_time
      )
  ) then
    raise exception 'scheduling_conflict_detected';
  end if;

  update public.activities
  set emp_id=p_emp_id,
      instructor_name=selected_instructor.full_name
  where row_id=p_activity_id
  returning * into result;

  insert into public.instructor_assignment_audit(
    activity_id,
    selected_emp_id,
    selected_instructor_name,
    top_recommended_emp_id,
    selected_score,
    top_score,
    decision_type,
    reason
  ) values (
    p_activity_id,
    p_emp_id::text,
    selected_instructor.full_name,
    p_top_emp_id::text,
    p_selected_score,
    p_top_score,
    p_decision_type,
    nullif(btrim(p_reason),'')
  );

  return result;
end
$$;
revoke all on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) from public;
grant execute on function public.assign_activity_instructor(text,bigint,text,bigint,integer,integer,text,text) to authenticated;

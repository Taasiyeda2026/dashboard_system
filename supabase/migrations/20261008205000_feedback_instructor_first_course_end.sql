-- Instructor overview: expose the end date of the earliest-ending assigned course
-- for each instructor + program + academic year.

drop function if exists public.feedback_admin_instructor_assignments(text);

create function public.feedback_admin_instructor_assignments(
  p_academic_year text default null
)
returns table (
  instructor_emp_id text,
  instructor_name text,
  program_key text,
  academic_year text,
  assignment_count integer,
  school_count integer,
  first_start_date date,
  first_course_end_date date,
  last_end_date date,
  pre_campaign jsonb,
  final_campaign jsonb,
  campaign jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;

  return query
  with acts as (
    select to_jsonb(a) as j
    from public.activities a
    where coalesce((to_jsonb(a)->>'instructor_assignment_locked')::boolean, false)
      and (
        p_academic_year is null
        or coalesce(nullif(to_jsonb(a)->>'activity_season', ''), 'regular') = p_academic_year
      )
  ),
  shaped as (
    select
      a.j,
      r.program_key as resolved_program_key,
      coalesce(r.excluded, false) as excluded
    from acts a
    left join lateral (
      select * from private.feedback_activity_program(a.j) limit 1
    ) r on true
  ),
  assigned as (
    select
      nullif(btrim(coalesce(s.j->>'emp_id', '')), '') as emp_id,
      nullif(btrim(coalesce(s.j->>'instructor_name', '')), '') as assigned_name,
      s.resolved_program_key as program_key,
      coalesce(nullif(s.j->>'activity_season', ''), 'regular') as year_key,
      s.j->>'row_id' as row_id,
      coalesce(nullif(s.j->>'school_id', ''), nullif(s.j->>'school', ''), s.j->>'row_id') as school_key,
      case when coalesce(s.j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'start_date', 10)::date end as start_date,
      case when coalesce(s.j->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'end_date', 10)::date end as end_date
    from shaped s
    where s.resolved_program_key is not null
      and not s.excluded
      and nullif(btrim(coalesce(s.j->>'emp_id', '')), '') is not null

    union all

    select
      nullif(btrim(coalesce(s.j->>'emp_id_2', '')), '') as emp_id,
      nullif(btrim(coalesce(s.j->>'instructor_name_2', '')), '') as assigned_name,
      s.resolved_program_key as program_key,
      coalesce(nullif(s.j->>'activity_season', ''), 'regular') as year_key,
      s.j->>'row_id' as row_id,
      coalesce(nullif(s.j->>'school_id', ''), nullif(s.j->>'school', ''), s.j->>'row_id') as school_key,
      case when coalesce(s.j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'start_date', 10)::date end as start_date,
      case when coalesce(s.j->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'end_date', 10)::date end as end_date
    from shaped s
    where s.resolved_program_key is not null
      and not s.excluded
      and nullif(btrim(coalesce(s.j->>'emp_id_2', '')), '') is not null
  ),
  grouped as (
    select
      a.emp_id,
      a.program_key,
      a.year_key,
      max(a.assigned_name) filter (where a.assigned_name is not null) as assigned_name,
      count(distinct a.row_id)::integer as assignments,
      count(distinct a.school_key)::integer as schools,
      min(a.start_date) as first_date,
      min(a.end_date) as first_end_date,
      max(a.end_date) as last_date
    from assigned a
    group by a.emp_id, a.program_key, a.year_key
  )
  select
    g.emp_id,
    coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id),
    g.program_key,
    g.year_key,
    g.assignments,
    g.schools,
    g.first_date,
    g.first_end_date,
    g.last_date,
    case when pre_c.id is null then null else private.feedback_campaign_json(pre_c.id) end,
    case when final_c.id is null then null else private.feedback_campaign_json(final_c.id) end,
    case when final_c.id is null then null else private.feedback_campaign_json(final_c.id) end
  from grouped g
  left join public.contacts_instructors ci on ci.emp_id::text = g.emp_id
  left join lateral (
    select fc.id
    from public.feedback_campaigns fc
    where fc.audience = 'instructor'
      and fc.stage = 'pre'
      and fc.instructor_emp_id = g.emp_id
      and fc.program_key = g.program_key
      and fc.academic_year = g.year_key
    order by fc.created_at
    limit 1
  ) pre_c on true
  left join lateral (
    select fc.id
    from public.feedback_campaigns fc
    where fc.audience = 'instructor'
      and fc.stage = 'final'
      and fc.instructor_emp_id = g.emp_id
      and fc.program_key = g.program_key
      and fc.academic_year = g.year_key
    order by fc.created_at
    limit 1
  ) final_c on true
  order by coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id), g.program_key;
end $$;

revoke all on function public.feedback_admin_instructor_assignments(text) from public, anon;
grant execute on function public.feedback_admin_instructor_assignments(text) to authenticated;

notify pgrst, 'reload schema';

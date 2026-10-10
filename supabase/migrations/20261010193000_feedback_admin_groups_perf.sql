-- Performance: resolve feedback programs only for the relevant academic-year cohort,
-- and stop course_summary_for_half from re-running the full instructor_assignments RPC
-- (campaign JSON + half-end columns) when it only needs first_start_date.

create or replace function private.feedback_instructor_cohort_starts(p_academic_year text default null)
returns table (
  instructor_emp_id text,
  program_key text,
  academic_year text,
  first_start_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  with acts as (
    select to_jsonb(a) as j
    from public.activities a
    where coalesce(a.instructor_assignment_locked, false)
      and (
        p_academic_year is null
        or coalesce(nullif(a.activity_season, ''), 'regular') = p_academic_year
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
      s.resolved_program_key as program_key,
      coalesce(nullif(s.j->>'activity_season', ''), 'regular') as year_key,
      case when coalesce(s.j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'start_date', 10)::date end as start_date
    from shaped s
    where s.resolved_program_key is not null
      and not s.excluded
      and nullif(btrim(coalesce(s.j->>'emp_id', '')), '') is not null

    union all

    select
      nullif(btrim(coalesce(s.j->>'emp_id_2', '')), '') as emp_id,
      s.resolved_program_key as program_key,
      coalesce(nullif(s.j->>'activity_season', ''), 'regular') as year_key,
      case when coalesce(s.j->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(s.j->>'start_date', 10)::date end as start_date
    from shaped s
    where s.resolved_program_key is not null
      and not s.excluded
      and nullif(btrim(coalesce(s.j->>'emp_id_2', '')), '') is not null
  )
  select
    a.emp_id,
    a.program_key,
    a.year_key,
    min(a.start_date) as first_start_date
  from assigned a
  group by a.emp_id, a.program_key, a.year_key
  having min(a.start_date) is not null;
$$;
revoke all on function private.feedback_instructor_cohort_starts(text) from public, anon, authenticated;

create or replace function public.feedback_admin_groups(
  p_academic_year text default null,
  p_activity_row_id text default null
)
returns table (
  row_id text,
  program_key text,
  program_source text,
  feedback_excluded boolean,
  gefen_number text,
  activity_name text,
  activity_type text,
  academic_year text,
  authority text,
  school text,
  grade text,
  class_group text,
  age_band text,
  instructor_emp_id text,
  instructor_name text,
  activity_manager text,
  has_contact boolean,
  contact_name text,
  start_date text,
  end_date text,
  activity_status text,
  campaigns jsonb
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  return query
  with acts as (
    -- Filter the year cohort before expensive per-row program resolution.
    select to_jsonb(x) as j from public.activities x
    where (p_activity_row_id is null or x.row_id = p_activity_row_id)
      and (
        p_academic_year is null
        or coalesce(nullif(x.activity_season, ''), 'regular') = p_academic_year
        or exists (
          select 1 from public.feedback_campaigns c
          where c.activity_row_id = x.row_id and c.academic_year = p_academic_year
        )
      )
  ),
  shaped as (
    select
      j->>'row_id' as row_id,
      res.program_key,
      res.source as program_source,
      coalesce(res.excluded, false) as excluded,
      j
    from acts
    left join lateral (select * from private.feedback_activity_program(acts.j) limit 1) res on true
  )
  select
    s.row_id,
    s.program_key,
    s.program_source,
    s.excluded,
    nullif(btrim(coalesce(s.j->>'gefen_number', '')), ''),
    coalesce(s.j->>'activity_name', ''),
    coalesce(s.j->>'activity_type', ''),
    coalesce(nullif(s.j->>'activity_season', ''), 'regular'),
    coalesce(s.j->>'authority', ''),
    coalesce(s.j->>'school', ''),
    coalesce(s.j->>'grade', ''),
    coalesce(s.j->>'class_group', ''),
    coalesce(private.feedback_age_band(s.j->>'grade'), (select p.default_age_band from public.feedback_programs p where p.key = s.program_key)),
    nullif(btrim(coalesce(s.j->>'emp_id', '')), ''),
    coalesce(s.j->>'instructor_name', ''),
    coalesce(s.j->>'activity_manager', ''),
    (coalesce(s.j->>'school_contact_id', '') <> '' or coalesce(btrim(s.j->>'contact_name'), '') <> ''
      or coalesce(btrim(s.j->>'contact_phone'), '') <> '' or coalesce(btrim(s.j->>'contact_email'), '') <> ''),
    coalesce(
      (select cs.contact_name from public.contacts_schools cs
        where coalesce(s.j->>'school_contact_id', '') ~ '^[0-9]+$' and cs.id = (s.j->>'school_contact_id')::bigint),
      s.j->>'contact_name', ''),
    coalesce(left(s.j->>'start_date', 10), ''),
    coalesce(left(s.j->>'end_date', 10), ''),
    coalesce(s.j->>'status', ''),
    coalesce((
      select jsonb_agg(private.feedback_campaign_json(c.id) order by c.audience, c.stage)
      from public.feedback_campaigns c where c.activity_row_id = s.row_id
    ), '[]'::jsonb)
  from shaped s
  -- Unrecognised course activities stay visible (program_key null = "תוכנית לא זוהתה").
  where s.program_key is not null or s.program_source is not null or private.feedback_is_course_activity(s.j);
end $$;
revoke all on function public.feedback_admin_groups(text, text) from public, anon;
grant execute on function public.feedback_admin_groups(text, text) to authenticated;

create or replace function public.feedback_admin_course_summary_for_half(p_academic_year text, p_half text)
returns table (
  program_key text,
  audience text,
  stage text,
  campaigns integer,
  groups integer,
  responses integer,
  invited integer,
  completed integer,
  unique_respondents integer,
  unidentified_responses integer,
  participants_total integer,
  participants_campaigns integer,
  responses_with_participants integer,
  first_response_at timestamptz,
  last_response_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  if p_half not in ('first', 'second') then
    raise exception 'feedback_invalid_semester' using errcode = '22023';
  end if;
  return query
  with instructor_cohorts as (
    select ia.instructor_emp_id, ia.program_key, ia.academic_year, ia.first_start_date
    from private.feedback_instructor_cohort_starts(p_academic_year) ia
  ),
  camp as (
    select
      c.program_key as pk,
      c.audience as aud,
      c.stage as stg,
      c.activity_row_id as act,
      rc.id as recipient_id,
      case
        when c.audience = 'instructor' then nullif(btrim(coalesce(rc.instructor_emp_id, c.instructor_emp_id, '')), '')
        when c.audience = 'educational_staff' then rc.contact_id::text
      end as identity_key,
      case
        when c.audience = 'student' and btrim(coalesce(to_jsonb(a)->>'participants_count', '')) ~ '^[0-9]{1,4}$'
          then nullif(btrim(to_jsonb(a)->>'participants_count')::int, 0)
      end as participants,
      rs.n as n_resp,
      rs.first_at,
      rs.last_at
    from public.feedback_campaigns c
    left join public.feedback_recipients rc on rc.campaign_id = c.id
    left join public.activities a on a.row_id = c.activity_row_id
    left join instructor_cohorts ia on c.audience = 'instructor'
      and ia.instructor_emp_id = c.instructor_emp_id
      and ia.program_key = c.program_key and ia.academic_year = c.academic_year
    left join lateral (
      select count(*)::int as n, min(r.submitted_at) as first_at, max(r.submitted_at) as last_at
      from public.feedback_responses r where r.campaign_id = c.id
    ) rs on true
    where (p_academic_year is null or c.academic_year = p_academic_year)
      and (
        case
          when c.audience = 'instructor' and c.stage = 'final_b' then date '2027-01-01'
          when c.audience = 'instructor' then ia.first_start_date
          else a.start_date
        end
      ) >= case when p_half = 'first' then date '2026-09-01' else date '2027-01-01' end
      and (
        case
          when c.audience = 'instructor' and c.stage = 'final_b' then date '2027-01-01'
          when c.audience = 'instructor' then ia.first_start_date
          else a.start_date
        end
      ) < case when p_half = 'first' then date '2027-01-01' else date '2027-07-01' end
      and (c.audience <> 'educational_staff' or a.end_date is not null)
  )
  select
    camp.pk,
    camp.aud,
    coalesce(camp.stg, 'all'),
    count(*)::int,
    count(distinct camp.act)::int,
    coalesce(sum(camp.n_resp), 0)::int,
    case when camp.aud = 'student' then null else count(camp.recipient_id)::int end,
    case when camp.aud = 'student' then null else (count(*) filter (where camp.n_resp > 0))::int end,
    case when camp.aud = 'student' then null else (count(distinct camp.identity_key) filter (where camp.n_resp > 0))::int end,
    case when camp.aud = 'student' then null else (count(*) filter (where camp.n_resp > 0 and camp.identity_key is null))::int end,
    case when camp.aud = 'student' then coalesce(sum(camp.participants), 0)::int end,
    case when camp.aud = 'student' then count(camp.participants)::int end,
    case when camp.aud = 'student' then coalesce(sum(camp.n_resp) filter (where camp.participants is not null), 0)::int end,
    min(camp.first_at),
    max(camp.last_at)
  from camp
  group by grouping sets ((camp.pk, camp.aud, camp.stg), (camp.pk, camp.aud))
  order by 1, 2, 3;
end $$;
revoke all on function public.feedback_admin_course_summary_for_half(text,text) from public, anon;
grant execute on function public.feedback_admin_course_summary_for_half(text,text) to authenticated;

-- Also avoid to_jsonb just to read the locked/season filters in instructor assignments.
create or replace function public.feedback_admin_instructor_assignments(
  p_academic_year text default null
)
returns table (
  instructor_emp_id text,
  instructor_name text,
  program_key text,
  academic_year text,
  activity_managers text[],
  assignment_count integer,
  school_count integer,
  first_start_date date,
  first_course_end_date date,
  last_end_date date,
  pre_campaign jsonb,
  final_campaign jsonb,
  campaign jsonb,
  last_end_a date,
  last_end_b date,
  final_b_campaign jsonb
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
    where coalesce(a.instructor_assignment_locked, false)
      and (
        p_academic_year is null
        or coalesce(nullif(a.activity_season, ''), 'regular') = p_academic_year
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
      nullif(btrim(coalesce(s.j->>'activity_manager', '')), '') as activity_manager,
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
      nullif(btrim(coalesce(s.j->>'activity_manager', '')), '') as activity_manager,
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
      coalesce(
        array_agg(distinct a.activity_manager order by a.activity_manager)
          filter (where a.activity_manager is not null),
        array[]::text[]
      ) as managers,
      count(distinct a.row_id)::integer as assignments,
      count(distinct a.school_key)::integer as schools,
      min(a.start_date) as first_date,
      min(a.end_date) as first_course_end_date,
      max(a.end_date) as last_date
    from assigned a
    group by a.emp_id, a.program_key, a.year_key
    having min(a.start_date) is not null
  ),
  grouped_with_half_last as (
    select
      g.*,
      (
        select max(a2.end_date)
        from assigned a2
        where a2.emp_id = g.emp_id
          and a2.program_key = g.program_key
          and a2.year_key = g.year_key
          and a2.start_date >=
            (case when g.first_date >= date '2027-01-31'
              then date '2027-01-31' else date '2026-09-01' end)
          and a2.start_date <
            (case when g.first_date >= date '2027-01-31'
              then date '2027-07-01' else date '2027-01-31' end)
      ) as last_end_in_half,
      (
        select max(a2.end_date)
        from assigned a2
        where a2.emp_id = g.emp_id
          and a2.program_key = g.program_key
          and a2.year_key = g.year_key
          and a2.start_date >= date '2026-09-01'
          and a2.start_date < date '2027-01-31'
      ) as last_end_a,
      (
        select max(a2.end_date)
        from assigned a2
        where a2.emp_id = g.emp_id
          and a2.program_key = g.program_key
          and a2.year_key = g.year_key
          and a2.start_date >= date '2027-01-31'
          and a2.start_date <= date '2027-06-30'
      ) as last_end_b
    from grouped g
  )
  select
    g.emp_id,
    coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id),
    g.program_key,
    g.year_key,
    g.managers,
    g.assignments,
    g.schools,
    g.first_date,
    g.first_course_end_date,
    g.last_end_in_half,
    case when pre_c.id is null then null else private.feedback_campaign_json(pre_c.id) end,
    case when final_c.id is null then null else private.feedback_campaign_json(final_c.id) end,
    case when final_c.id is null then null else private.feedback_campaign_json(final_c.id) end,
    g.last_end_a,
    g.last_end_b,
    case when final_b_c.id is null then null else private.feedback_campaign_json(final_b_c.id) end
  from grouped_with_half_last g
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
  left join lateral (
    select fc.id
    from public.feedback_campaigns fc
    where fc.audience = 'instructor'
      and fc.stage = 'final_b'
      and fc.instructor_emp_id = g.emp_id
      and fc.program_key = g.program_key
      and fc.academic_year = g.year_key
    order by fc.created_at
    limit 1
  ) final_b_c on true
  order by
    g.first_date asc,
    g.last_end_in_half asc nulls last,
    coalesce(nullif(btrim(ci.full_name), ''), g.assigned_name, g.emp_id),
    g.program_key;
end $$;
revoke all on function public.feedback_admin_instructor_assignments(text) from public, anon;
grant execute on function public.feedback_admin_instructor_assignments(text) to authenticated;

notify pgrst, 'reload schema';

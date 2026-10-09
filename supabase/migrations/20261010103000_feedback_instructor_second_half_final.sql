-- Instructor yearly table with two independent end-of-semester checkpoints.
-- Preserve existing instructor feedback stages and yearly campaigns.
-- final_b uses the current published instructor FINAL questionnaire, but gets a
-- DISTINCT campaign/recipient so first-semester answers are never overwritten.
-- Only admins can open and manage a second-semester link.
alter table public.feedback_campaigns
  drop constraint if exists feedback_campaigns_stage_check;
alter table public.feedback_campaigns
  add constraint feedback_campaigns_stage_check
  check (stage in ('pre','post','final','final_b'));

alter table public.feedback_campaigns
  drop constraint if exists feedback_campaigns_audience_stage_check;
alter table public.feedback_campaigns
  add constraint feedback_campaigns_audience_stage_check check (
    (audience = 'student' and stage in ('pre','post'))
    or (audience = 'educational_staff' and stage = 'final')
    or (audience = 'instructor' and stage in ('pre','final','final_b'))
  );

drop function if exists public.feedback_admin_instructor_assignments(text);

create function public.feedback_admin_instructor_assignments(
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

-- Reuse the pre-existing stage-aware opener, extended for one new, independent
-- second-half FINAL campaign. The FINAL template stays unchanged.
create or replace function public.feedback_admin_open_instructor_campaign(
  p_instructor_emp_id text,
  p_program_key text,
  p_academic_year text,
  p_stage text,
  p_opens_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_existing uuid;
  v_version uuid;
  v_campaign uuid;
  v_instructor jsonb;
  v_name text;
  v_phone text;
  v_email text;
  v_opens timestamptz := coalesce(p_opens_at, now());
begin
  if not private.feedback_is_admin() then
    raise exception 'feedback_forbidden' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_instructor_emp_id, '')), '') is null then
    raise exception 'feedback_instructor_missing';
  end if;
  if p_stage is null or p_stage not in ('pre', 'final', 'final_b') then
    raise exception 'feedback_invalid_stage';
  end if;
  if nullif(btrim(coalesce(p_program_key, '')), '') is null
     or not exists (select 1 from public.feedback_programs p where p.key = p_program_key and p.is_active) then
    raise exception 'feedback_invalid_program';
  end if;
  if nullif(btrim(coalesce(p_academic_year, '')), '') is null then
    raise exception 'feedback_invalid_academic_year';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then
    raise exception 'feedback_invalid_window';
  end if;

  select fc.id into v_existing
  from public.feedback_campaigns fc
  where fc.audience = 'instructor'
    and fc.stage = p_stage
    and fc.instructor_emp_id = p_instructor_emp_id
    and fc.program_key = p_program_key
    and fc.academic_year = p_academic_year
  order by fc.created_at
  limit 1;

  if v_existing is not null then
    return private.feedback_campaign_json(v_existing);
  end if;

  select * into a
  from public.feedback_admin_instructor_assignments(p_academic_year) x
  where x.instructor_emp_id = p_instructor_emp_id
    and x.program_key = p_program_key
  limit 1;

  if not found then
    raise exception 'feedback_instructor_not_assigned';
  end if;
  if p_stage = 'final_b' and a.last_end_b is null then
    raise exception 'feedback_second_half_not_scheduled';
  end if;

  select t.current_version_id into v_version
  from public.feedback_templates t
  where t.program_key = p_program_key
    and t.audience = 'instructor'
    and t.stage = case when p_stage = 'final_b' then 'final' else p_stage end;
  if v_version is null then
    raise exception 'feedback_template_not_published';
  end if;

  select to_jsonb(ci) into v_instructor
  from public.contacts_instructors ci
  where ci.emp_id::text = p_instructor_emp_id;

  v_name := coalesce(nullif(btrim(v_instructor->>'full_name'), ''), nullif(btrim(a.instructor_name), ''), p_instructor_emp_id);
  v_phone := coalesce(nullif(btrim(v_instructor->>'mobile'), ''), '');
  v_email := coalesce(nullif(btrim(v_instructor->>'email'), ''), '');

  insert into public.feedback_campaigns (
    activity_row_id, program_key, template_version_id, audience, stage, age_band, academic_year,
    activity_name, school_name, authority_name, grade, class_group,
    instructor_emp_id, instructor_name, contact_name,
    activity_start_date, activity_end_date, public_token, opens_at, expires_at, created_by
  ) values (
    null, p_program_key, v_version, 'instructor', p_stage, null, p_academic_year,
    '', '', '', '', '',
    p_instructor_emp_id, v_name, '',
    a.first_start_date, case when p_stage = 'final_b' then a.last_end_b else a.last_end_date end, null, v_opens, p_expires_at, auth.uid()
  )
  returning id into v_campaign;

  insert into public.feedback_recipients (
    campaign_id, recipient_type, instructor_emp_id, display_name, phone, email, token
  ) values (
    v_campaign, 'instructor', p_instructor_emp_id, v_name, v_phone, v_email, private.feedback_new_token()
  );

  return private.feedback_campaign_json(v_campaign);
end $$;
revoke all on function public.feedback_admin_open_instructor_campaign(text,text,text,text,timestamptz,timestamptz) from public, anon;
grant execute on function public.feedback_admin_open_instructor_campaign(text,text,text,text,timestamptz,timestamptz) to authenticated;

-- Expose second-half instructor feedback in the second-half collection figures,
-- even when the instructor's first course began in semester A.
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
as $
#variable_conflict use_column
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  if p_half not in ('first', 'second') then
    raise exception 'feedback_invalid_semester' using errcode = '22023';
  end if;
  return query
  with instructor_cohorts as (
    select ia.instructor_emp_id, ia.program_key, ia.academic_year, ia.first_start_date
    from public.feedback_admin_instructor_assignments(p_academic_year) ia
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
        when c.audience = 'student' and btrim(coalesce(to_jsonb(a)->>'participants_count', '')) ~ '^[0-9]{1,4}
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
          when c.audience = 'instructor' and c.stage = 'final_b' then date '2027-01-31'
          when c.audience = 'instructor' then ia.first_start_date
          else a.start_date
        end
      ) >= case when p_half = 'first' then date '2026-09-01' else date '2027-01-31' end
      and (
        case
          when c.audience = 'instructor' and c.stage = 'final_b' then date '2027-01-31'
          when c.audience = 'instructor' then ia.first_start_date
          else a.start_date
        end
      ) < case when p_half = 'first' then date '2027-01-31' else date '2027-07-01' end
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
end $;
revoke all on function public.feedback_admin_course_summary_for_half(text,text) from public, anon;
grant execute on function public.feedback_admin_course_summary_for_half(text,text) to authenticated;

notify pgrst, 'reload schema';

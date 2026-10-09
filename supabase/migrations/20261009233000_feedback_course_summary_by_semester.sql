-- Read-only feedback collection summary scoped to the same first/second course halves
-- as course scheduling. Existing yearly RPC stays unchanged for legacy clients.
-- A yearly instructor feedback belongs to the half of the instructor's first start.
-- Student/staff survey campaigns belong to the half of their source activity's start.
-- Team/staff campaigns require an actual activity end date; no data is deleted.
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
        case when c.audience = 'instructor' then
          ia.first_start_date
        else
          a.start_date
        end
      ) >= case when p_half = 'first' then date '2026-09-01' else date '2027-01-31' end
      and (
        case when c.audience = 'instructor' then
          ia.first_start_date
        else
          a.start_date
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
end $$
revoke all on function public.feedback_admin_course_summary_for_half(text,text) from public, anon;
grant execute on function public.feedback_admin_course_summary_for_half(text,text) to authenticated;

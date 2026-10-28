-- Four exact Dracha Ramon school courses: exclude ONLY student opening surveys.
-- Never change student final, instructor or educational-staff feedback.
create table if not exists private.feedback_student_pre_exclusions (
  activity_row_id text not null references public.activities(row_id),
  academic_year text not null,
  reason text not null,
  created_at timestamptz not null default now(),
  primary key(activity_row_id,academic_year)
);
alter table private.feedback_student_pre_exclusions enable row level security;
revoke all on private.feedback_student_pre_exclusions from public,anon,authenticated;

insert into private.feedback_student_pre_exclusions(activity_row_id,academic_year,reason)
values
('school_2027_049','school_2027','משוב פתיחה לתלמידים לא נדרש - החלטת הנהלה 28.10.2026'),
('ACT-d18c3eaa-e3fa-4d4f-ad9b-e293b4781d12','school_2027','משוב פתיחה לתלמידים לא נדרש - החלטת הנהלה 28.10.2026'),
('school_2027_050','school_2027','משוב פתיחה לתלמידים לא נדרש - החלטת הנהלה 28.10.2026'),
('school_2027_052','school_2027','משוב פתיחה לתלמידים לא נדרש - החלטת הנהלה 28.10.2026')
on conflict (activity_row_id,academic_year) do update set reason=excluded.reason;

do $fn$
declare n integer;
begin
  if (select count(*) from public.feedback_campaigns c
      join private.feedback_student_pre_exclusions x
        on x.activity_row_id=c.activity_row_id and x.academic_year=c.academic_year
      where c.audience='student' and c.stage='pre'
      and not exists(select 1 from public.feedback_responses r where r.campaign_id=c.id)
    ) <> 4 then
      raise exception 'expected exactly four unanswered student opening campaigns';
  end if;

  update public.feedback_campaigns c
    set status='closed',closed_at=now(),updated_at=now()
    from private.feedback_student_pre_exclusions x
    where x.activity_row_id=c.activity_row_id and x.academic_year=c.academic_year
      and c.audience='student' and c.stage='pre' and c.status='active';
  get diagnostics n = row_count;
  if n<>4 then raise exception 'expected four student opening campaigns to close, got %',n; end if;
end
$fn$;

-- No accidental reopening or recreating a disallowed opening campaign.
create or replace function private.feedback_guard_excluded_student_pre()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  if new.audience='student' and new.stage='pre'
    and new.status='active' and exists (
      select 1 from private.feedback_student_pre_exclusions x
      where x.activity_row_id=new.activity_row_id and x.academic_year=new.academic_year
    ) then
    raise exception 'feedback_student_pre_not_required' using errcode='23514';
  end if;
  return new;
end
$fn$;

drop trigger if exists feedback_guard_excluded_student_pre on public.feedback_campaigns;
create trigger feedback_guard_excluded_student_pre
before insert or update of activity_row_id,audience,stage,status,academic_year
on public.feedback_campaigns
for each row execute function private.feedback_guard_excluded_student_pre();

-- Expose not-required status through existing campaign JSON.
CREATE OR REPLACE FUNCTION private.feedback_campaign_json(p_campaign_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', c.id, 'activity_row_id', c.activity_row_id, 'program_key', c.program_key,
    'audience', c.audience, 'stage', c.stage, 'age_band', c.age_band, 'status', c.status,
    'not_required', exists (
      select 1 from private.feedback_student_pre_exclusions x
      where x.activity_row_id=c.activity_row_id and x.academic_year=c.academic_year
        and c.audience='student' and c.stage='pre'
    ),
    'opens_at', c.opens_at, 'expires_at', c.expires_at, 'closed_at', c.closed_at,
    'created_at', c.created_at, 'public_token', c.public_token,
    'template_version_id', c.template_version_id,
    'version_no', v.version_no,
    'template_is_current', (t.current_version_id = c.template_version_id),
    'responses', (select count(*) from public.feedback_responses r where r.campaign_id = c.id),
    'recipient', (
      select jsonb_build_object(
        'id', rc.id, 'type', rc.recipient_type, 'display_name', rc.display_name,
        'phone', rc.phone, 'email', rc.email, 'token', rc.token, 'status', rc.status,
        'completed_at', rc.completed_at, 'last_shared_at', rc.last_shared_at,
        'last_shared_channel', rc.last_shared_channel)
      from public.feedback_recipients rc where rc.campaign_id = c.id)
  )
  from public.feedback_campaigns c
  join public.feedback_template_versions v on v.id = c.template_version_id
  join public.feedback_templates t on t.id = v.template_id
  where c.id = p_campaign_id;
$function$;

-- Exclude exempt forms from collection denominator.
CREATE OR REPLACE FUNCTION public.feedback_admin_course_summary_for_half(p_academic_year text, p_half text)
 RETURNS TABLE(program_key text, audience text, stage text, campaigns integer, groups integer, responses integer, invited integer, completed integer, unique_respondents integer, unidentified_responses integer, participants_total integer, participants_campaigns integer, responses_with_participants integer, first_response_at timestamp with time zone, last_response_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.feedback_can_view_results() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
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
    where (c.activity_row_id is null or (a.start_date is not null and a.instructor_assignment_locked is true and (a.emp_id is not null or nullif(btrim(a.emp_id_2), '') is not null)))
      and not exists (select 1 from private.feedback_student_pre_exclusions x
        where x.activity_row_id=c.activity_row_id and x.academic_year=c.academic_year
          and c.audience='student' and c.stage='pre')
      and (p_academic_year is null or c.academic_year = p_academic_year)
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
      and (c.audience <> 'educational_staff' or (c.stage = 'pre' and a.start_date is not null) or (c.stage = 'final' and a.end_date is not null))
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
end $function$;

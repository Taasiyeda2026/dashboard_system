-- Expose the existing activity manager alongside the other group attributes in feedback views.
-- No new data source, storage table or access path; original admin-only grant remains unchanged.
DROP FUNCTION IF EXISTS public.feedback_admin_groups(text, text);
create function public.feedback_admin_groups(
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
    select to_jsonb(x) as j from public.activities x
    where (p_activity_row_id is null or x.row_id = p_activity_row_id)
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
    where p_academic_year is null or coalesce(nullif(j->>'activity_season', ''), 'regular') = p_academic_year
       or exists (select 1 from public.feedback_campaigns c where c.activity_row_id = j->>'row_id' and c.academic_year = p_academic_year)
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

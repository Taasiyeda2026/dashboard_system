-- Instructor feedback: two program-level checkpoints per academic year.
-- PRE opens after the internal training milestone (admin chooses when to open it).
-- FINAL opens at course completion. Neither checkpoint is tied to a specific activity/group.

alter table public.feedback_templates
  drop constraint if exists feedback_templates_audience_stage_check;
alter table public.feedback_templates
  add constraint feedback_templates_audience_stage_check check (
    (audience = 'student' and stage in ('pre','post'))
    or (audience = 'educational_staff' and stage = 'final')
    or (audience = 'instructor' and stage in ('pre','final'))
  );

alter table public.feedback_campaigns
  drop constraint if exists feedback_campaigns_audience_stage_check;
alter table public.feedback_campaigns
  add constraint feedback_campaigns_audience_stage_check check (
    (audience = 'student' and stage in ('pre','post'))
    or (audience = 'educational_staff' and stage = 'final')
    or (audience = 'instructor' and stage in ('pre','final'))
  );

drop index if exists public.feedback_campaigns_instructor_program_year_uidx;
create unique index feedback_campaigns_instructor_program_year_stage_uidx
  on public.feedback_campaigns(instructor_emp_id, program_key, academic_year, stage)
  where audience = 'instructor';

-- Opening checkpoint questions: short, focused on training/readiness before classroom delivery.
insert into public.feedback_questions (
  question_key, program_key, metric_key, question_type, audiences, stages,
  is_comparison, wording, options, scoring, default_required, sort_order
) values
  (
    'in_pre_training_clarity', null, 'operations', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"ההכשרה הייתה ברורה, מסודרת ונתנה לי תמונה טובה של התוכנית"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 10
  ),
  (
    'in_pre_content_understanding', null, 'content', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"אחרי ההכשרה אני מבין/ה היטב את מטרות התוכנית ואת התוכן שאעביר"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 20
  ),
  (
    'in_pre_readiness', null, 'self_efficacy', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"אני מרגיש/ה מוכן/ה להתחיל להדריך את התוכנית"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 30
  ),
  (
    'in_pre_materials', null, 'operations', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"חומרי ההדרכה שקיבלתי (מערכים, מצגות וחומרים נלווים) ברורים ונגישים לי"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 40
  ),
  (
    'in_pre_equipment', null, 'operations', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"ברור לי איזה ציוד, ערכות וכלים נדרשים להדרכת התוכנית"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 50
  ),
  (
    'in_pre_classroom_confidence', null, 'delivery', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"אני מרגיש/ה בטוח/ה להעביר את הפעילויות ולהתמודד עם שאלות ומצבים בכיתה"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 60
  ),
  (
    'in_pre_support', null, 'operations', 'rating_1_5',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"ברור לי למי לפנות אם אצטרך עזרה מקצועית או תפעולית במהלך ההדרכה"}'::jsonb,
    '[]'::jsonb, '{}'::jsonb, true, 70
  ),
  (
    'in_pre_open_missing', null, 'operations', 'free_text',
    array['instructor']::text[], array['pre']::text[], false,
    '{"default":"מה עדיין חסר לך או דורש חיזוק לפני תחילת ההדרכה?"}'::jsonb,
    '[]'::jsonb, '{"include_in_score":false}'::jsonb, false, 900
  )
on conflict (question_key) do nothing;

-- Create one PRE template for each of the 8 programs.
insert into public.feedback_templates (program_key, audience, stage, title)
select p.key, 'instructor', 'pre', p.title || ' – מדריך – פתיחה'
from public.feedback_programs p
where p.is_active
on conflict (program_key, audience, stage) do update
  set title = excluded.title, updated_at = now();

-- Clarify the existing end-of-course template names.
update public.feedback_templates t
set title = p.title || ' – מדריך – סיום הקורס',
    updated_at = now()
from public.feedback_programs p
where t.program_key = p.key
  and t.audience = 'instructor'
  and t.stage = 'final';

-- Publish v1 for newly-created PRE templates.
do $$
declare
  t record;
  v_version uuid;
begin
  for t in
    select tp.*
    from public.feedback_templates tp
    where tp.audience = 'instructor'
      and tp.stage = 'pre'
      and not exists (
        select 1 from public.feedback_template_versions v where v.template_id = tp.id
      )
  loop
    v_version := private.feedback_compose_draft(t.id);
    update public.feedback_template_versions
    set intro_text = 'המשוב הזה נשלח לאחר ההכשרה ולפני תחילת ההדרכה. חשוב לנו להבין עד כמה התוכן, החומרים וההכשרה הכינו אותך לקראת הקורס ומה עדיין חסר.',
        notes = 'גרסת ברירת מחדל – משוב מדריך פתיחה לאחר הכשרה'
    where id = v_version;
    perform private.feedback_publish_version(v_version);
  end loop;
end $$;

-- Publish a fresh FINAL version with an explicit end-of-course intro.
-- Existing campaigns, if any, remain pinned to their historical version.
do $
declare
  t record;
  v_version uuid;
begin
  for t in
    select tp.*
    from public.feedback_templates tp
    where tp.audience = 'instructor' and tp.stage = 'final'
  loop
    v_version := private.feedback_compose_draft(t.id);
    update public.feedback_template_versions
    set intro_text = 'לאחר סיום הקורס נשמח לשמוע מה עבד בפועל, מה דורש שיפור ומה דעתך על התוכן, החומרים, התפעול וההשפעה על התלמידים.',
        notes = 'גרסת ברירת מחדל – משוב מדריך סיום הקורס'
    where id = v_version;
    perform private.feedback_publish_version(v_version);
  end loop;
end $;

-- Recreate assignment listing with two distinct instructor checkpoints.
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

-- New stage-aware opener.
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
  if p_stage is null or p_stage not in ('pre', 'final') then
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

  select t.current_version_id into v_version
  from public.feedback_templates t
  where t.program_key = p_program_key
    and t.audience = 'instructor'
    and t.stage = p_stage;
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
    a.first_start_date, a.last_end_date, null, v_opens, p_expires_at, auth.uid()
  )
  returning id into v_campaign;

  insert into public.feedback_recipients (
    campaign_id, recipient_type, instructor_emp_id, display_name, phone, email, token
  ) values (
    v_campaign, 'instructor', p_instructor_emp_id, v_name, v_phone, v_email, private.feedback_new_token()
  );

  return private.feedback_campaign_json(v_campaign);
end $$;

revoke all on function public.feedback_admin_open_instructor_campaign(text, text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.feedback_admin_open_instructor_campaign(text, text, text, text, timestamptz, timestamptz) to authenticated;

-- Backward-compatible FINAL wrapper for any cached old frontend.
create or replace function public.feedback_admin_open_instructor_campaign(
  p_instructor_emp_id text,
  p_program_key text,
  p_academic_year text,
  p_opens_at timestamptz default null,
  p_expires_at timestamptz default null
)
returns jsonb
language sql security definer set search_path = ''
as $$
  select public.feedback_admin_open_instructor_campaign(
    p_instructor_emp_id,
    p_program_key,
    p_academic_year,
    'final',
    p_opens_at,
    p_expires_at
  );
$$;

revoke all on function public.feedback_admin_open_instructor_campaign(text, text, text, timestamptz, timestamptz) from public, anon;
grant execute on function public.feedback_admin_open_instructor_campaign(text, text, text, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';

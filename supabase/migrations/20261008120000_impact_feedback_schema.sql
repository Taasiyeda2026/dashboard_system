-- Impact feedback module ("משובים והערכת השפעה").
--
-- Additive, backward-safe schema: new feedback_* tables only. Existing master data is
-- reused through foreign keys / ids and is never duplicated:
--   * group / activity  -> public.activities(row_id)
--   * school contact    -> public.contacts_schools(id)        (activities.school_contact_id)
--   * instructor        -> public.contacts_instructors(emp_id) (activities.emp_id)
--   * school/authority  -> activities.school_id / authority_id (+ name snapshot)
--   * academic year     -> activities.activity_season
-- feedback_programs is a feedback-specific mapping of the 8 catalog programs to activity
-- names (the system has no courses table; course identity lives in activities.activity_name).
--
-- Campaigns snapshot their context and are pinned to an immutable template version, so
-- collected questionnaires never change when templates are edited later.
--
-- Security model:
--   * Only users.role = 'admin' can read or manage anything (RLS + definer RPC checks).
--   * anon has no table privileges at all. Public respondents use exactly two
--     SECURITY DEFINER RPCs keyed by a strong random token:
--       feedback_public_get(token)    -> the authorised questionnaire only
--       feedback_public_submit(token) -> one validated response

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function private.feedback_is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.auth_user_id = (select auth.uid())
      and coalesce(u.is_active, false)
      and lower(coalesce(u.role, '')) = 'admin'
  );
$$;
revoke all on function private.feedback_is_admin() from public, anon;
grant execute on function private.feedback_is_admin() to authenticated;

-- 43-char url-safe token, ~244 bits of randomness (two v4 UUIDs). No pgcrypto dependency.
create or replace function private.feedback_new_token()
returns text
language sql volatile set search_path = ''
as $$
  select rtrim(translate(encode(decode(
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
    'hex'), 'base64'), '+/', '-_'), '=');
$$;
revoke all on function private.feedback_new_token() from public, anon;

-- Grade text ("ח'", "ז-ח", "כיתה י\"א", "8") -> age band. Lowest grade wins.
create or replace function private.feedback_age_band(p_grade text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_clean text;
  v_token text;
  v_grade int;
  v_min int := null;
begin
  v_clean := regexp_replace(coalesce(p_grade, ''), '[''"׳״`]', '', 'g');
  foreach v_token in array regexp_split_to_array(v_clean, '[^א-תA-Za-z0-9]+') loop
    v_grade := case
      when v_token ~ '^[0-9]{1,2}$' then v_token::int
      when v_token = 'א' then 1 when v_token = 'ב' then 2 when v_token = 'ג' then 3
      when v_token = 'ד' then 4 when v_token = 'ה' then 5 when v_token = 'ו' then 6
      when v_token = 'ז' then 7 when v_token = 'ח' then 8 when v_token = 'ט' then 9
      when v_token = 'י' then 10 when v_token = 'יא' then 11 when v_token = 'יב' then 12
      else null end;
    if v_grade between 1 and 12 and (v_min is null or v_grade < v_min) then
      v_min := v_grade;
    end if;
  end loop;
  return case
    when v_min is null then null
    when v_min <= 3 then 'a_c'
    when v_min <= 6 then 'd_f'
    when v_min <= 9 then 'g_i'
    else 'j_l' end;
end $$;
revoke all on function private.feedback_age_band(text) from public, anon;
grant execute on function private.feedback_age_band(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Definitions: metrics, programs, question bank, templates, versions
-- ---------------------------------------------------------------------------

create table if not exists public.feedback_metrics (
  key text primary key,
  label text not null,
  kind text not null default 'impact' check (kind in ('impact', 'program')),
  description text not null default '',
  sort_order int not null default 0
);

create table if not exists public.feedback_programs (
  key text primary key,
  title text not null,
  topic text not null,
  catalog_program_ids text[] not null default '{}',
  -- Gefen catalog numbers (frontend/public/catalog/appendices/<number>.pdf); matched against activities.gefen_number.
  gefen_numbers text[] not null default '{}',
  activity_name_patterns text[] not null default '{}',
  exclude_patterns text[] not null default '{}',
  default_age_band text check (default_age_band in ('a_c', 'd_f', 'g_i', 'j_l')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Question concepts. A concept keeps a stable id across template versions, which is
-- what allows PRE vs POST (and year over year) comparison of the same question.
create table if not exists public.feedback_questions (
  id uuid primary key default gen_random_uuid(),
  question_key text not null unique,
  program_key text references public.feedback_programs(key) on delete restrict,
  metric_key text not null references public.feedback_metrics(key) on delete restrict,
  question_type text not null check (question_type in ('rating_1_5', 'yes_no', 'single_select', 'multi_select', 'free_text')),
  audiences text[] not null check (cardinality(audiences) > 0 and audiences <@ array['student', 'educational_staff', 'instructor']),
  stages text[] not null check (cardinality(stages) > 0 and stages <@ array['pre', 'post', 'final']),
  is_comparison boolean not null default false,
  wording jsonb not null check (jsonb_typeof(wording) = 'object' and coalesce(wording->>'default', '') <> ''),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  scoring jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring) = 'object'),
  default_required boolean not null default true,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_questions_program_idx on public.feedback_questions(program_key);

create table if not exists public.feedback_templates (
  id uuid primary key default gen_random_uuid(),
  program_key text not null references public.feedback_programs(key) on delete restrict,
  audience text not null check (audience in ('student', 'educational_staff', 'instructor')),
  stage text not null check (stage in ('pre', 'post', 'final')),
  title text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_key, audience, stage),
  constraint feedback_templates_audience_stage_check check (
    (audience = 'student' and stage in ('pre', 'post')) or (audience <> 'student' and stage = 'final')
  )
);

create table if not exists public.feedback_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.feedback_templates(id) on delete restrict,
  version_no int not null check (version_no > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  intro_text text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  unique (template_id, version_no)
);
create unique index if not exists feedback_template_versions_one_draft
  on public.feedback_template_versions(template_id) where status = 'draft';
create unique index if not exists feedback_template_versions_one_published
  on public.feedback_template_versions(template_id) where status = 'published';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_templates_current_version_fk') then
    alter table public.feedback_templates
      add constraint feedback_templates_current_version_fk
      foreign key (current_version_id) references public.feedback_template_versions(id)
      on delete set null deferrable initially deferred;
  end if;
end $$;

-- Snapshot of a question inside one template version (wording, type, options, metric).
create table if not exists public.feedback_template_questions (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.feedback_template_versions(id) on delete cascade,
  question_id uuid not null references public.feedback_questions(id) on delete restrict,
  section text not null default 'core' check (section in ('core', 'course')),
  sort_order int not null default 0,
  required boolean not null default true,
  metric_key text not null references public.feedback_metrics(key) on delete restrict,
  question_type text not null check (question_type in ('rating_1_5', 'yes_no', 'single_select', 'multi_select', 'free_text')),
  is_comparison boolean not null default false,
  wording jsonb not null check (jsonb_typeof(wording) = 'object' and coalesce(wording->>'default', '') <> ''),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  scoring jsonb not null default '{}'::jsonb check (jsonb_typeof(scoring) = 'object'),
  created_at timestamptz not null default now(),
  unique (version_id, question_id)
);
create index if not exists feedback_template_questions_version_idx on public.feedback_template_questions(version_id, sort_order);

-- Published / archived versions are immutable.
create or replace function private.feedback_guard_version_questions()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.feedback_template_versions
  where id = coalesce(new.version_id, old.version_id);
  if v_status is distinct from 'draft' then
    -- Cascading delete of a draft version is allowed; anything else on a locked version is not.
    if tg_op = 'DELETE' and v_status is null then return old; end if;
    raise exception 'feedback_version_locked' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.version_id is distinct from old.version_id then
    raise exception 'feedback_version_locked' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists feedback_template_questions_guard on public.feedback_template_questions;
create trigger feedback_template_questions_guard
before insert or update or delete on public.feedback_template_questions
for each row execute function private.feedback_guard_version_questions();

create or replace function private.feedback_guard_versions()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'feedback_version_locked' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'archived' then raise exception 'feedback_version_locked' using errcode = 'P0001'; end if;
  if old.status = 'published' and not (
    new.status = 'archived'
    and new.template_id = old.template_id and new.version_no = old.version_no
    and new.intro_text = old.intro_text
  ) then
    raise exception 'feedback_version_locked' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists feedback_template_versions_guard on public.feedback_template_versions;
create trigger feedback_template_versions_guard
before update or delete on public.feedback_template_versions
for each row execute function private.feedback_guard_versions();

-- ---------------------------------------------------------------------------
-- Campaigns, recipients, responses, answers
-- ---------------------------------------------------------------------------

create table if not exists public.feedback_campaigns (
  id uuid primary key default gen_random_uuid(),
  activity_row_id text references public.activities(row_id) on delete set null,
  program_key text not null references public.feedback_programs(key) on delete restrict,
  template_version_id uuid not null references public.feedback_template_versions(id) on delete restrict,
  audience text not null check (audience in ('student', 'educational_staff', 'instructor')),
  stage text not null check (stage in ('pre', 'post', 'final')),
  age_band text check (age_band in ('a_c', 'd_f', 'g_i', 'j_l')),
  academic_year text not null default '',
  -- Context snapshot taken from the activity when the campaign is opened.
  activity_name text not null default '',
  school_id bigint,
  school_name text not null default '',
  authority_id bigint,
  authority_name text not null default '',
  grade text not null default '',
  class_group text not null default '',
  instructor_emp_id text,
  instructor_name text not null default '',
  contact_id bigint references public.contacts_schools(id) on delete set null,
  contact_name text not null default '',
  activity_start_date date,
  activity_end_date date,
  public_token text unique,
  status text not null default 'active' check (status in ('active', 'closed')),
  opens_at timestamptz not null default now(),
  expires_at timestamptz,
  max_responses int not null default 400 check (max_responses > 0),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  constraint feedback_campaigns_audience_stage_check check (
    (audience = 'student' and stage in ('pre', 'post')) or (audience <> 'student' and stage = 'final')
  ),
  constraint feedback_campaigns_student_token_check check ((audience = 'student') = (public_token is not null)),
  constraint feedback_campaigns_window_check check (expires_at is null or expires_at > opens_at)
);
create unique index if not exists feedback_campaigns_activity_slot
  on public.feedback_campaigns(activity_row_id, audience, stage) where activity_row_id is not null;
create index if not exists feedback_campaigns_program_idx on public.feedback_campaigns(program_key, academic_year);

create table if not exists public.feedback_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.feedback_campaigns(id) on delete cascade,
  recipient_type text not null check (recipient_type in ('educational_staff', 'instructor')),
  contact_id bigint references public.contacts_schools(id) on delete set null,
  instructor_emp_id text,
  display_name text not null default '',
  phone text not null default '',
  email text not null default '',
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  locked boolean not null default true,
  last_shared_at timestamptz,
  last_shared_channel text check (last_shared_channel in ('whatsapp', 'email', 'copy')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_responses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.feedback_campaigns(id) on delete cascade,
  recipient_id uuid references public.feedback_recipients(id) on delete cascade,
  template_version_id uuid not null references public.feedback_template_versions(id) on delete restrict,
  age_band text,
  client_submission_id uuid not null,
  duration_seconds int check (duration_seconds is null or duration_seconds >= 0),
  submitted_at timestamptz not null default now(),
  unique (campaign_id, client_submission_id)
);
create unique index if not exists feedback_responses_one_per_recipient
  on public.feedback_responses(recipient_id) where recipient_id is not null;
create index if not exists feedback_responses_campaign_idx on public.feedback_responses(campaign_id, submitted_at);

create table if not exists public.feedback_answers (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.feedback_responses(id) on delete cascade,
  template_question_id uuid not null references public.feedback_template_questions(id) on delete restrict,
  question_id uuid not null references public.feedback_questions(id) on delete restrict,
  metric_key text not null references public.feedback_metrics(key) on delete restrict,
  question_type text not null,
  value_number numeric check (value_number is null or value_number between 1 and 5),
  value_bool boolean,
  value_text text check (value_text is null or char_length(value_text) <= 2000),
  value_options text[],
  created_at timestamptz not null default now(),
  unique (response_id, template_question_id)
);
create index if not exists feedback_answers_question_idx on public.feedback_answers(question_id);

-- Reserved for future AI analysis of open answers (summary, themes, strengths,
-- improvement suggestions, sentiment). Nothing writes to it yet.
create table if not exists public.feedback_answer_insights (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('answer', 'campaign', 'program', 'activity')),
  answer_id uuid references public.feedback_answers(id) on delete cascade,
  campaign_id uuid references public.feedback_campaigns(id) on delete cascade,
  program_key text references public.feedback_programs(key) on delete cascade,
  activity_row_id text,
  kind text not null check (kind in ('summary', 'theme', 'strength', 'improvement', 'sentiment')),
  label text not null default '',
  payload jsonb not null default '{}'::jsonb,
  sentiment_score numeric check (sentiment_score is null or sentiment_score between -1 and 1),
  model text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists feedback_answer_insights_answer_idx on public.feedback_answer_insights(answer_id);

-- ---------------------------------------------------------------------------
-- RLS: admin only. anon gets nothing.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'feedback_metrics', 'feedback_programs', 'feedback_questions', 'feedback_templates',
    'feedback_template_versions', 'feedback_template_questions', 'feedback_campaigns',
    'feedback_recipients', 'feedback_responses', 'feedback_answers', 'feedback_answer_insights'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.feedback_is_admin()))', t || '_admin_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;

  -- Template authoring tables are edited directly by admins (drafts only; triggers lock the rest).
  foreach t in array array['feedback_questions', 'feedback_template_questions', 'feedback_programs'] loop
    execute format('grant insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format('create policy %I on public.%I for all to authenticated using ((select private.feedback_is_admin())) with check ((select private.feedback_is_admin()))', t || '_admin_write', t);
  end loop;

  execute 'grant update (intro_text, notes) on public.feedback_template_versions to authenticated';
  execute 'drop policy if exists feedback_template_versions_admin_update on public.feedback_template_versions';
  execute 'create policy feedback_template_versions_admin_update on public.feedback_template_versions for update to authenticated using ((select private.feedback_is_admin())) with check ((select private.feedback_is_admin()))';
end $$;

-- Deleting a bank question that was already used is blocked by FKs; admins deactivate instead.

-- ---------------------------------------------------------------------------
-- Template engine
-- ---------------------------------------------------------------------------

create or replace function private.feedback_resolve_program(p_activity_name text)
returns text
language sql stable security definer set search_path = ''
as $$
  select p.key from public.feedback_programs p
  where p.is_active
    and exists (select 1 from unnest(p.activity_name_patterns) pat where coalesce(p_activity_name, '') ilike pat)
    and not exists (select 1 from unnest(p.exclude_patterns) ex where coalesce(p_activity_name, '') ilike ex)
  order by p.sort_order, p.key
  limit 1;
$$;
revoke all on function private.feedback_resolve_program(text) from public, anon;
grant execute on function private.feedback_resolve_program(text) to authenticated;

create or replace function private.feedback_name_key(p_name text)
returns text
language sql immutable set search_path = ''
as $$ select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g')) $$;
revoke all on function private.feedback_name_key(text) from public, anon;

-- Admin's manual program choice for an activity (or for every activity with the same name).
-- Feedback-only mapping: activities / catalog master data are never modified.
create table if not exists public.feedback_program_mappings (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('activity', 'activity_name')),
  activity_row_id text references public.activities(row_id) on delete cascade,
  activity_name_key text,
  program_key text references public.feedback_programs(key) on delete restrict,
  excluded boolean not null default false,
  set_by uuid default auth.uid(),
  set_at timestamptz not null default now(),
  constraint feedback_program_mappings_activity_scope check ((scope = 'activity') = (activity_row_id is not null)),
  constraint feedback_program_mappings_name_scope check ((scope = 'activity_name') = (activity_name_key is not null and activity_name_key <> '')),
  constraint feedback_program_mappings_target check (excluded or program_key is not null)
);
create unique index if not exists feedback_program_mappings_activity_uidx
  on public.feedback_program_mappings(activity_row_id) where scope = 'activity';
create unique index if not exists feedback_program_mappings_name_uidx
  on public.feedback_program_mappings(activity_name_key) where scope = 'activity_name';
alter table public.feedback_program_mappings enable row level security;
revoke all on public.feedback_program_mappings from anon, public, authenticated;
grant all on public.feedback_program_mappings to service_role;
grant select on public.feedback_program_mappings to authenticated;
drop policy if exists feedback_program_mappings_admin_select on public.feedback_program_mappings;
create policy feedback_program_mappings_admin_select on public.feedback_program_mappings
  for select to authenticated using ((select private.feedback_is_admin()));

-- Program resolution for one activity row (as jsonb), highest priority first:
--   campaign (already collected; locked) > manual (activity) > manual (activity name)
--   > Gefen catalog number > activity-name pattern. No row = "תוכנית לא זוהתה".
create or replace function private.feedback_activity_program(p_activity jsonb)
returns table (program_key text, source text, excluded boolean)
language sql stable security definer set search_path = ''
as $$
  select r.program_key, r.source, r.excluded
  from (
    select 1 as prio, c.program_key, 'campaign'::text as source, false as excluded
    from public.feedback_campaigns c
    where c.activity_row_id = p_activity->>'row_id'
    order by c.created_at
    limit 1
  ) r
  union all
  select * from (
    select m.program_key, 'manual'::text, m.excluded
    from public.feedback_program_mappings m
    where not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and m.scope = 'activity' and m.activity_row_id = p_activity->>'row_id'
    union all
    select m.program_key, 'manual_name'::text, m.excluded
    from public.feedback_program_mappings m
    where not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and m.scope = 'activity_name' and m.activity_name_key = private.feedback_name_key(p_activity->>'activity_name')
  ) manual
  union all
  select * from (
    select p.key, 'gefen'::text, false
    from public.feedback_programs p
    where p.is_active
      and nullif(btrim(coalesce(p_activity->>'gefen_number', '')), '') = any(p.gefen_numbers)
      and not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings mn where mn.scope = 'activity_name' and mn.activity_name_key = private.feedback_name_key(p_activity->>'activity_name'))
    order by p.sort_order
    limit 1
  ) gefen
  union all
  select * from (
    select private.feedback_resolve_program(p_activity->>'activity_name'), 'name'::text, false
    where private.feedback_resolve_program(p_activity->>'activity_name') is not null
      and not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings mn where mn.scope = 'activity_name' and mn.activity_name_key = private.feedback_name_key(p_activity->>'activity_name'))
      and not exists (select 1 from public.feedback_programs p where p.is_active
        and nullif(btrim(coalesce(p_activity->>'gefen_number', '')), '') = any(p.gefen_numbers))
  ) by_name;
$$;
revoke all on function private.feedback_activity_program(jsonb) from public, anon, authenticated;

-- A course-like activity is "relevant" to the module even when its program is not recognised.
create or replace function private.feedback_is_course_activity(p_activity jsonb)
returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(p_activity->>'activity_type', '') in ('course', 'after_school', 'קורס', 'חוג', 'תוכנית')
      or coalesce(p_activity->>'activity_family', '') = 'program';
$$;
revoke all on function private.feedback_is_course_activity(jsonb) from public, anon;

-- Builds a draft version of a template: Core questions + Course-specific questions of the
-- template's program, filtered by audience and stage, ordered by the bank sort order.
create or replace function private.feedback_compose_draft(p_template_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.feedback_templates;
  v_version_id uuid;
begin
  select * into t from public.feedback_templates where id = p_template_id;
  if not found then raise exception 'feedback_template_not_found'; end if;

  insert into public.feedback_template_versions (template_id, version_no, status, created_by)
  values (
    t.id,
    coalesce((select max(version_no) from public.feedback_template_versions where template_id = t.id), 0) + 1,
    'draft', auth.uid()
  )
  returning id into v_version_id;

  insert into public.feedback_template_questions (
    version_id, question_id, section, sort_order, required, metric_key, question_type,
    is_comparison, wording, options, scoring
  )
  select v_version_id, q.id, case when q.program_key is null then 'core' else 'course' end,
    row_number() over (order by q.sort_order, q.question_key) * 10,
    q.default_required, q.metric_key, q.question_type, q.is_comparison, q.wording, q.options, q.scoring
  from public.feedback_questions q
  where q.is_active
    and t.audience = any(q.audiences)
    and t.stage = any(q.stages)
    and (q.program_key is null or q.program_key = t.program_key);

  return v_version_id;
end $$;
revoke all on function private.feedback_compose_draft(uuid) from public, anon, authenticated;

create or replace function private.feedback_publish_version(p_version_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v public.feedback_template_versions;
begin
  select * into v from public.feedback_template_versions where id = p_version_id for update;
  if not found then raise exception 'feedback_version_not_found'; end if;
  if v.status <> 'draft' then raise exception 'feedback_version_not_draft'; end if;
  if not exists (select 1 from public.feedback_template_questions where version_id = v.id) then
    raise exception 'feedback_version_empty';
  end if;
  update public.feedback_template_versions set status = 'archived'
  where template_id = v.template_id and status = 'published';
  update public.feedback_template_versions
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = v.id;
  update public.feedback_templates set current_version_id = v.id, updated_at = now()
  where id = v.template_id;
end $$;
revoke all on function private.feedback_publish_version(uuid) from public, anon, authenticated;

-- Admin: get (or create) the editable draft of a template, cloned from the published version.
create or replace function public.feedback_admin_get_draft(p_template_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  t public.feedback_templates;
  v_draft uuid;
  v_source uuid;
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  select * into t from public.feedback_templates where id = p_template_id;
  if not found then raise exception 'feedback_template_not_found'; end if;

  select id into v_draft from public.feedback_template_versions where template_id = t.id and status = 'draft';
  if v_draft is not null then return v_draft; end if;

  v_source := t.current_version_id;
  insert into public.feedback_template_versions (template_id, version_no, status, intro_text, created_by)
  values (
    t.id,
    coalesce((select max(version_no) from public.feedback_template_versions where template_id = t.id), 0) + 1,
    'draft',
    coalesce((select intro_text from public.feedback_template_versions where id = v_source), ''),
    auth.uid()
  )
  returning id into v_draft;

  if v_source is not null then
    insert into public.feedback_template_questions (
      version_id, question_id, section, sort_order, required, metric_key, question_type,
      is_comparison, wording, options, scoring
    )
    select v_draft, question_id, section, sort_order, required, metric_key, question_type,
      is_comparison, wording, options, scoring
    from public.feedback_template_questions where version_id = v_source;
  end if;
  return v_draft;
end $$;
revoke all on function public.feedback_admin_get_draft(uuid) from public, anon;
grant execute on function public.feedback_admin_get_draft(uuid) to authenticated;

create or replace function public.feedback_admin_publish_draft(p_version_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  perform private.feedback_publish_version(p_version_id);
  return p_version_id;
end $$;
revoke all on function public.feedback_admin_publish_draft(uuid) from public, anon;
grant execute on function public.feedback_admin_publish_draft(uuid) to authenticated;

create or replace function public.feedback_admin_discard_draft(p_version_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  delete from public.feedback_template_versions where id = p_version_id and status = 'draft';
end $$;
revoke all on function public.feedback_admin_discard_draft(uuid) from public, anon;
grant execute on function public.feedback_admin_discard_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Campaign management (admin)
-- ---------------------------------------------------------------------------

create or replace function private.feedback_campaign_json(p_campaign_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id, 'activity_row_id', c.activity_row_id, 'program_key', c.program_key,
    'audience', c.audience, 'stage', c.stage, 'age_band', c.age_band, 'status', c.status,
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
$$;
revoke all on function private.feedback_campaign_json(uuid) from public, anon, authenticated;

create or replace function public.feedback_admin_open_campaign(
  p_activity_row_id text,
  p_audience text,
  p_stage text,
  p_opens_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_age_band text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a jsonb;
  v_existing uuid;
  v_program text;
  v_version uuid;
  v_campaign uuid;
  v_contact_id bigint;
  v_contact jsonb;
  v_instructor jsonb;
  v_emp text;
  v_name text;
  v_phone text;
  v_email text;
  v_age text;
  v_excluded boolean;
  v_opens timestamptz := coalesce(p_opens_at, now());
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  if p_audience not in ('student', 'educational_staff', 'instructor') then raise exception 'feedback_invalid_audience'; end if;
  if (p_audience = 'student' and p_stage not in ('pre', 'post')) or (p_audience <> 'student' and p_stage <> 'final') then
    raise exception 'feedback_invalid_stage';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then raise exception 'feedback_invalid_window'; end if;

  select to_jsonb(x) into a from public.activities x where x.row_id = p_activity_row_id;
  if a is null then raise exception 'feedback_activity_not_found'; end if;

  select id into v_existing from public.feedback_campaigns
  where activity_row_id = p_activity_row_id and audience = p_audience and stage = p_stage;
  if v_existing is not null then
    return private.feedback_campaign_json(v_existing);
  end if;

  select r.program_key, r.excluded into v_program, v_excluded from private.feedback_activity_program(a) r;
  if coalesce(v_excluded, false) then raise exception 'feedback_activity_excluded'; end if;
  if v_program is null or not exists (select 1 from public.feedback_programs where key = v_program) then
    raise exception 'feedback_program_unresolved';
  end if;

  select t.current_version_id into v_version from public.feedback_templates t
  where t.program_key = v_program and t.audience = p_audience and t.stage = p_stage;
  if v_version is null then raise exception 'feedback_template_not_published'; end if;

  v_age := coalesce(
    nullif(p_age_band, ''),
    private.feedback_age_band(a->>'grade'),
    (select default_age_band from public.feedback_programs where key = v_program)
  );
  if v_age is not null and v_age not in ('a_c', 'd_f', 'g_i', 'j_l') then raise exception 'feedback_invalid_age_band'; end if;

  v_contact_id := case when coalesce(a->>'school_contact_id', '') ~ '^[0-9]+$' then (a->>'school_contact_id')::bigint end;
  if v_contact_id is not null then
    select to_jsonb(cs) into v_contact from public.contacts_schools cs where cs.id = v_contact_id;
    if v_contact is null then v_contact_id := null; end if;
  end if;
  v_emp := nullif(btrim(coalesce(a->>'emp_id', '')), '');
  if v_emp is not null then
    select to_jsonb(ci) into v_instructor from public.contacts_instructors ci where ci.emp_id::text = v_emp;
  end if;

  insert into public.feedback_campaigns (
    activity_row_id, program_key, template_version_id, audience, stage, age_band, academic_year,
    activity_name, school_id, school_name, authority_id, authority_name, grade, class_group,
    instructor_emp_id, instructor_name, contact_id, contact_name,
    activity_start_date, activity_end_date, public_token, opens_at, expires_at, created_by
  ) values (
    p_activity_row_id, v_program, v_version, p_audience, p_stage, v_age, coalesce(nullif(a->>'activity_season', ''), 'regular'),
    coalesce(a->>'activity_name', ''),
    case when coalesce(a->>'school_id', '') ~ '^[0-9]+$' then (a->>'school_id')::bigint end,
    coalesce(a->>'school', ''),
    case when coalesce(a->>'authority_id', '') ~ '^[0-9]+$' then (a->>'authority_id')::bigint end,
    coalesce(a->>'authority', ''),
    coalesce(a->>'grade', ''), coalesce(a->>'class_group', ''),
    v_emp, coalesce(nullif(v_instructor->>'full_name', ''), a->>'instructor_name', ''),
    v_contact_id, coalesce(nullif(v_contact->>'contact_name', ''), a->>'contact_name', ''),
    case when coalesce(a->>'start_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(a->>'start_date', 10)::date end,
    case when coalesce(a->>'end_date', '') ~ '^\d{4}-\d{2}-\d{2}' then left(a->>'end_date', 10)::date end,
    case when p_audience = 'student' then private.feedback_new_token() end,
    v_opens, p_expires_at, auth.uid()
  )
  returning id into v_campaign;

  if p_audience = 'educational_staff' then
    v_name := coalesce(nullif(btrim(v_contact->>'contact_name'), ''), nullif(btrim(a->>'contact_name'), ''));
    v_phone := coalesce(nullif(btrim(v_contact->>'mobile'), ''), nullif(btrim(v_contact->>'phone'), ''), nullif(btrim(a->>'contact_phone'), ''), '');
    v_email := coalesce(nullif(btrim(v_contact->>'email'), ''), nullif(btrim(a->>'contact_email'), ''), '');
    if v_name is null and v_phone = '' and v_email = '' then
      raise exception 'feedback_contact_missing';
    end if;
    insert into public.feedback_recipients (campaign_id, recipient_type, contact_id, display_name, phone, email, token)
    values (v_campaign, 'educational_staff', v_contact_id, coalesce(v_name, ''), v_phone, v_email, private.feedback_new_token());
  elsif p_audience = 'instructor' then
    v_name := coalesce(nullif(btrim(v_instructor->>'full_name'), ''), nullif(btrim(a->>'instructor_name'), ''));
    if v_name is null and v_emp is null then
      raise exception 'feedback_instructor_missing';
    end if;
    insert into public.feedback_recipients (campaign_id, recipient_type, instructor_emp_id, display_name, phone, email, token)
    values (v_campaign, 'instructor', v_emp, coalesce(v_name, ''),
      coalesce(nullif(btrim(v_instructor->>'mobile'), ''), ''), coalesce(nullif(btrim(v_instructor->>'email'), ''), ''),
      private.feedback_new_token());
  end if;

  return private.feedback_campaign_json(v_campaign);
end $$;
revoke all on function public.feedback_admin_open_campaign(text, text, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.feedback_admin_open_campaign(text, text, text, timestamptz, timestamptz, text) to authenticated;

-- Admin: choose the program of an activity manually (or exclude it / return to automatic).
-- p_program_key null + p_excluded false = remove the manual choice.
create or replace function public.feedback_admin_set_program(
  p_activity_row_id text,
  p_program_key text,
  p_apply_to_name boolean default false,
  p_excluded boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a jsonb;
  v_name_key text;
  v_campaign_program text;
  r record;
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  select to_jsonb(x) into a from public.activities x where x.row_id = p_activity_row_id;
  if a is null then raise exception 'feedback_activity_not_found'; end if;
  if not coalesce(p_excluded, false) and p_program_key is not null
     and not exists (select 1 from public.feedback_programs where key = p_program_key and is_active) then
    raise exception 'feedback_invalid_program';
  end if;

  select program_key into v_campaign_program from public.feedback_campaigns
  where activity_row_id = p_activity_row_id order by created_at limit 1;
  if v_campaign_program is not null and (coalesce(p_excluded, false) or v_campaign_program is distinct from p_program_key) then
    raise exception 'feedback_program_locked';
  end if;

  v_name_key := private.feedback_name_key(a->>'activity_name');
  if coalesce(p_apply_to_name, false) and v_name_key = '' then raise exception 'feedback_activity_name_missing'; end if;

  if p_program_key is null and not coalesce(p_excluded, false) then
    delete from public.feedback_program_mappings where scope = 'activity' and activity_row_id = p_activity_row_id;
    if coalesce(p_apply_to_name, false) then
      delete from public.feedback_program_mappings where scope = 'activity_name' and activity_name_key = v_name_key;
    end if;
  else
    insert into public.feedback_program_mappings (scope, activity_row_id, program_key, excluded, set_by, set_at)
    values ('activity', p_activity_row_id, case when coalesce(p_excluded, false) then null else p_program_key end, coalesce(p_excluded, false), auth.uid(), now())
    on conflict (activity_row_id) where scope = 'activity'
    do update set program_key = excluded.program_key, excluded = excluded.excluded, set_by = excluded.set_by, set_at = excluded.set_at;
    if coalesce(p_apply_to_name, false) and not coalesce(p_excluded, false) then
      insert into public.feedback_program_mappings (scope, activity_name_key, program_key, excluded, set_by, set_at)
      values ('activity_name', v_name_key, p_program_key, false, auth.uid(), now())
      on conflict (activity_name_key) where scope = 'activity_name'
      do update set program_key = excluded.program_key, excluded = false, set_by = excluded.set_by, set_at = excluded.set_at;
    end if;
  end if;

  select * into r from private.feedback_activity_program(a) limit 1;
  return jsonb_build_object('program_key', r.program_key, 'source', r.source, 'excluded', coalesce(r.excluded, false));
end $$;
revoke all on function public.feedback_admin_set_program(text, text, boolean, boolean) from public, anon;
grant execute on function public.feedback_admin_set_program(text, text, boolean, boolean) to authenticated;

-- p_action: close | reopen | update_window | rotate_token | mark_shared
create or replace function public.feedback_admin_update_campaign(
  p_campaign_id uuid,
  p_action text,
  p_opens_at timestamptz default null,
  p_expires_at timestamptz default null,
  p_channel text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.feedback_campaigns;
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  select * into c from public.feedback_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'feedback_campaign_not_found'; end if;

  if p_action = 'close' then
    update public.feedback_campaigns set status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now()
    where id = c.id;
  elsif p_action = 'reopen' then
    if p_expires_at is not null and p_expires_at <= now() then raise exception 'feedback_invalid_window'; end if;
    update public.feedback_campaigns
    set status = 'active', closed_at = null, closed_by = null, updated_at = now(),
        expires_at = case when p_expires_at is not null then p_expires_at
                          when expires_at is not null and expires_at <= now() then null
                          else expires_at end
    where id = c.id;
  elsif p_action = 'update_window' then
    if coalesce(p_expires_at, 'infinity'::timestamptz) <= coalesce(p_opens_at, c.opens_at) then
      raise exception 'feedback_invalid_window';
    end if;
    update public.feedback_campaigns
    set opens_at = coalesce(p_opens_at, opens_at), expires_at = p_expires_at, updated_at = now()
    where id = c.id;
  elsif p_action = 'rotate_token' then
    if c.audience = 'student' then
      update public.feedback_campaigns set public_token = private.feedback_new_token(), updated_at = now() where id = c.id;
    else
      update public.feedback_recipients set token = private.feedback_new_token() where campaign_id = c.id;
    end if;
  elsif p_action = 'mark_shared' then
    if p_channel not in ('whatsapp', 'email', 'copy') then raise exception 'feedback_invalid_channel'; end if;
    update public.feedback_recipients set last_shared_at = now(), last_shared_channel = p_channel where campaign_id = c.id;
  else
    raise exception 'feedback_invalid_action';
  end if;

  return private.feedback_campaign_json(c.id);
end $$;
revoke all on function public.feedback_admin_update_campaign(uuid, text, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.feedback_admin_update_campaign(uuid, text, timestamptz, timestamptz, text) to authenticated;

-- Groups (existing activities) relevant to the module + their campaign slots.
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

-- Flat answer facts for dashboards and export. Students are never identified.
create or replace function public.feedback_admin_answer_facts(p_filters jsonb default '{}'::jsonb)
returns table (
  answer_id uuid,
  response_id uuid,
  campaign_id uuid,
  submitted_at timestamptz,
  audience text,
  stage text,
  program_key text,
  academic_year text,
  activity_row_id text,
  activity_name text,
  authority_name text,
  school_name text,
  grade text,
  age_band text,
  instructor_name text,
  respondent_name text,
  template_version_id uuid,
  version_no int,
  question_id uuid,
  question_key text,
  question_text text,
  section text,
  sort_order int,
  metric_key text,
  question_type text,
  is_comparison boolean,
  scoring jsonb,
  question_options jsonb,
  value_number numeric,
  value_bool boolean,
  value_text text,
  value_options text[]
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if not private.feedback_is_admin() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  return query
  select
    an.id, r.id, c.id, r.submitted_at, c.audience, c.stage, c.program_key, c.academic_year,
    c.activity_row_id, c.activity_name, c.authority_name, c.school_name, c.grade, coalesce(r.age_band, c.age_band),
    c.instructor_name,
    case when c.audience = 'student' then null else rc.display_name end,
    c.template_version_id, v.version_no,
    an.question_id, q.question_key,
    replace(coalesce(tq.wording->>coalesce(r.age_band, c.age_band, 'default'), tq.wording->>'default'), '{topic}', p.topic),
    tq.section, tq.sort_order, an.metric_key, an.question_type, tq.is_comparison, tq.scoring, tq.options,
    an.value_number, an.value_bool, an.value_text, an.value_options
  from public.feedback_answers an
  join public.feedback_responses r on r.id = an.response_id
  join public.feedback_campaigns c on c.id = r.campaign_id
  join public.feedback_programs p on p.key = c.program_key
  join public.feedback_template_questions tq on tq.id = an.template_question_id
  join public.feedback_template_versions v on v.id = c.template_version_id
  join public.feedback_questions q on q.id = an.question_id
  left join public.feedback_recipients rc on rc.id = r.recipient_id
  where (f->>'academic_year' is null or c.academic_year = f->>'academic_year')
    and (f->>'program_key' is null or c.program_key = f->>'program_key')
    and (f->>'activity_row_id' is null or c.activity_row_id = f->>'activity_row_id')
    and (f->>'audience' is null or c.audience = f->>'audience')
    and (f->>'from' is null or r.submitted_at >= (f->>'from')::timestamptz)
    and (f->>'to' is null or r.submitted_at < (f->>'to')::timestamptz)
  order by r.submitted_at, r.id, tq.sort_order;
end $$;
revoke all on function public.feedback_admin_answer_facts(jsonb) from public, anon;
grant execute on function public.feedback_admin_answer_facts(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Public respondent flow (anon). Token -> questionnaire / submit only.
-- ---------------------------------------------------------------------------

create or replace function private.feedback_token_target(p_token text, p_lock boolean default false)
returns table (campaign_id uuid, recipient_id uuid)
language plpgsql security definer set search_path = ''
as $$
begin
  if p_token is null or char_length(p_token) < 32 or char_length(p_token) > 128 or p_token !~ '^[A-Za-z0-9_-]+$' then
    return;
  end if;
  if p_lock then
    return query select c.id, null::uuid from public.feedback_campaigns c where c.public_token = p_token for update;
    if found then return; end if;
    return query select rc.campaign_id, rc.id from public.feedback_recipients rc where rc.token = p_token for update;
  else
    return query select c.id, null::uuid from public.feedback_campaigns c where c.public_token = p_token;
    if found then return; end if;
    return query select rc.campaign_id, rc.id from public.feedback_recipients rc where rc.token = p_token;
  end if;
end $$;
revoke all on function private.feedback_token_target(text, boolean) from public, anon, authenticated;

create or replace function private.feedback_public_state(p_campaign_id uuid, p_recipient_id uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when c.id is null then 'invalid'
    when c.status = 'closed' then 'closed'
    when c.opens_at > now() then 'not_open'
    when c.expires_at is not null and c.expires_at <= now() then 'expired'
    when p_recipient_id is not null and exists (
      select 1 from public.feedback_recipients rc where rc.id = p_recipient_id and rc.status = 'completed' and rc.locked
    ) then 'completed'
    when p_recipient_id is null and (select count(*) from public.feedback_responses r where r.campaign_id = c.id) >= c.max_responses then 'full'
    else 'ok' end
  from (select p_campaign_id as id) k
  left join public.feedback_campaigns c on c.id = k.id;
$$;
revoke all on function private.feedback_public_state(uuid, uuid) from public, anon, authenticated;

create or replace function public.feedback_public_get(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_target record;
  v_state text;
  c public.feedback_campaigns;
  v_program public.feedback_programs;
  v_recipient_name text;
  v_band text;
begin
  select * into v_target from private.feedback_token_target(p_token, false) limit 1;
  if v_target.campaign_id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into c from public.feedback_campaigns where id = v_target.campaign_id;
  select * into v_program from public.feedback_programs where key = c.program_key;
  v_state := private.feedback_public_state(c.id, v_target.recipient_id);
  v_band := coalesce(c.age_band, 'default');
  if v_target.recipient_id is not null then
    select display_name into v_recipient_name from public.feedback_recipients where id = v_target.recipient_id;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'audience', c.audience,
    'stage', c.stage,
    'age_band', c.age_band,
    'program_title', v_program.title,
    'school_name', c.school_name,
    'grade', c.grade,
    'recipient_name', coalesce(v_recipient_name, ''),
    'expires_at', c.expires_at,
    'intro_text', (select intro_text from public.feedback_template_versions where id = c.template_version_id),
    'questions', case when v_state <> 'ok' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tq.id,
        'type', tq.question_type,
        'text', replace(coalesce(tq.wording->>v_band, tq.wording->>'default'), '{topic}', v_program.topic),
        'options', tq.options,
        'required', tq.required,
        'section', tq.section
      ) order by tq.sort_order, tq.id)
      from public.feedback_template_questions tq where tq.version_id = c.template_version_id
    ), '[]'::jsonb) end
  );
end $$;
revoke all on function public.feedback_public_get(text) from public;
grant execute on function public.feedback_public_get(text) to anon, authenticated;

create or replace function public.feedback_public_submit(
  p_token text,
  p_submission_id uuid,
  p_answers jsonb,
  p_duration_seconds int default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_target record;
  v_state text;
  c public.feedback_campaigns;
  tq record;
  v jsonb;
  v_response uuid;
  v_missing text[] := '{}';
  v_invalid text[] := '{}';
  v_text text;
  v_opts text[];
  v_allowed text[];
begin
  if p_submission_id is null or p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    return jsonb_build_object('ok', false, 'state', 'invalid_payload');
  end if;
  if pg_column_size(p_answers) > 65536 then
    return jsonb_build_object('ok', false, 'state', 'invalid_payload');
  end if;

  select * into v_target from private.feedback_token_target(p_token, true) limit 1;
  if v_target.campaign_id is null then
    return jsonb_build_object('ok', false, 'state', 'invalid');
  end if;
  select * into c from public.feedback_campaigns where id = v_target.campaign_id for update;

  -- Idempotent retry of the same submission (double tap, network retry).
  if exists (select 1 from public.feedback_responses r where r.campaign_id = c.id and r.client_submission_id = p_submission_id) then
    return jsonb_build_object('ok', true, 'state', 'already_received');
  end if;

  v_state := private.feedback_public_state(c.id, v_target.recipient_id);
  if v_state <> 'ok' then
    return jsonb_build_object('ok', false, 'state', v_state);
  end if;

  for tq in
    select * from public.feedback_template_questions where version_id = c.template_version_id order by sort_order
  loop
    v := p_answers -> tq.id::text;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      if tq.required then v_missing := v_missing || tq.id::text; end if;
      continue;
    end if;
    select coalesce(array_agg(o->>'value'), '{}') into v_allowed from jsonb_array_elements(tq.options) o;
    if tq.question_type = 'rating_1_5' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then v_invalid := v_invalid || tq.id::text; end if;
    elsif tq.question_type = 'yes_no' then
      if jsonb_typeof(v) <> 'boolean' then v_invalid := v_invalid || tq.id::text; end if;
    elsif tq.question_type = 'single_select' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any(v_allowed)) then v_invalid := v_invalid || tq.id::text; end if;
    elsif tq.question_type = 'multi_select' then
      if jsonb_typeof(v) <> 'array' then
        v_invalid := v_invalid || tq.id::text;
      else
        select array_agg(e) into v_opts from jsonb_array_elements_text(v) e;
        if not (v_opts <@ v_allowed) or cardinality(v_opts) > 20 then v_invalid := v_invalid || tq.id::text; end if;
      end if;
    elsif tq.question_type = 'free_text' then
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 2000 then v_invalid := v_invalid || tq.id::text; end if;
    end if;
  end loop;

  if cardinality(v_missing) > 0 or cardinality(v_invalid) > 0 then
    return jsonb_build_object('ok', false, 'state', 'invalid_answers', 'missing', to_jsonb(v_missing), 'invalid', to_jsonb(v_invalid));
  end if;

  insert into public.feedback_responses (campaign_id, recipient_id, template_version_id, age_band, client_submission_id, duration_seconds)
  values (c.id, v_target.recipient_id, c.template_version_id, c.age_band, p_submission_id,
    case when p_duration_seconds between 0 and 86400 then p_duration_seconds end)
  returning id into v_response;

  for tq in
    select * from public.feedback_template_questions where version_id = c.template_version_id order by sort_order
  loop
    v := p_answers -> tq.id::text;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      continue;
    end if;
    v_text := null; v_opts := null;
    if tq.question_type = 'free_text' then v_text := btrim(v #>> '{}'); end if;
    if tq.question_type = 'single_select' then v_opts := array[v #>> '{}']; end if;
    if tq.question_type = 'multi_select' then select array_agg(distinct e) into v_opts from jsonb_array_elements_text(v) e; end if;
    insert into public.feedback_answers (
      response_id, template_question_id, question_id, metric_key, question_type,
      value_number, value_bool, value_text, value_options
    ) values (
      v_response, tq.id, tq.question_id, tq.metric_key, tq.question_type,
      case when tq.question_type = 'rating_1_5' then (v #>> '{}')::numeric end,
      case when tq.question_type = 'yes_no' then (v #>> '{}')::boolean end,
      v_text, v_opts
    );
  end loop;

  if v_target.recipient_id is not null then
    update public.feedback_recipients set status = 'completed', completed_at = now(), locked = true
    where id = v_target.recipient_id;
  end if;

  return jsonb_build_object('ok', true, 'state', 'submitted');
exception
  when unique_violation then
    -- Concurrent duplicate of the same submission or of a personal (one-time) link.
    return jsonb_build_object('ok', true, 'state', 'already_received');
end $$;
revoke all on function public.feedback_public_submit(text, uuid, jsonb, int) from public;
grant execute on function public.feedback_public_submit(text, uuid, jsonb, int) to anon, authenticated;

notify pgrst, 'reload schema';

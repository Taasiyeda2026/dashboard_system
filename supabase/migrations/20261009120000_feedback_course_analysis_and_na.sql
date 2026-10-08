-- Feedback module upgrade: course-level analysis, "not applicable" answers and two
-- program-resolution fixes. Additive and backward-safe:
--   * no table is dropped/rewritten, no collected response or published version changes;
--   * public links keep working (token RPCs keep their signatures; get only adds a key);
--   * every admin RPC keeps the private.feedback_is_admin() gate.

-- ---------------------------------------------------------------------------
-- 1. Fix: unrecognised course activities disappeared from the module.
-- 20261009002000 compared a NULL Gefen/activity number with '57646'; NOT(NULL OR ...) is NULL,
-- so every course activity without a catalog number was filtered out instead of being listed as
-- "תוכנית לא זוהתה".
-- ---------------------------------------------------------------------------
create or replace function private.feedback_is_course_activity(p_activity jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    not (
      coalesce(private.feedback_canonical_program_number(p_activity->>'gefen_number') = '57646', false)
      or coalesce(private.feedback_canonical_program_number(p_activity->>'activity_no') = '57646', false)
      or coalesce(p_activity->>'activity_name', '') ilike '%השמיים אינם הגבול%'
    )
    and (
      coalesce(p_activity->>'activity_type', '') in ('course', 'after_school', 'קורס', 'חוג', 'תוכנית')
      or coalesce(p_activity->>'activity_family', '') = 'program'
    );
$$;
revoke all on function private.feedback_is_course_activity(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Fix: name-only resolution must not mix look-alike catalog products.
--   * Biomimicry's grade-based branch skipped the program's exclude patterns, so other products
--     with "ביומימיקרי" in the name (e.g. escape room / "הקסום") were counted as the course.
--   * "%אופק%" also matched names containing "אופקים".
-- Gefen / activity numbers and manual mappings keep their higher priority; campaigns already
-- opened stay locked to their program (source = 'campaign').
-- ---------------------------------------------------------------------------
update public.feedback_programs
set exclude_patterns = array_append(exclude_patterns, '%אופקים%'),
    updated_at = now()
where key = 'ofek' and not ('%אופקים%' = any(exclude_patterns));

update public.feedback_programs
set exclude_patterns = (
      select array_agg(distinct x order by x)
      from unnest(exclude_patterns || array['%חדר בריחה%', '%הקסום%']) x
    ),
    updated_at = now()
where key in ('biomimicry', 'biomimicry_secondary')
  and not (exclude_patterns @> array['%חדר בריחה%', '%הקסום%']);

-- Catalog metadata: program-11 is the secondary Biomimicry (53828), not the elementary 6089 course.
-- Metadata only (not used for resolution), corrected so the two courses never share a catalog id.
update public.feedback_programs
set catalog_program_ids = array['program-01'], updated_at = now()
where key = 'biomimicry' and catalog_program_ids is distinct from array['program-01'];

update public.feedback_programs
set catalog_program_ids = array['program-11', 'biomimicry-middle'], updated_at = now()
where key = 'biomimicry_secondary' and not ('program-11' = any(catalog_program_ids));

create or replace function private.feedback_resolve_program_for_activity(p_activity jsonb)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_name text := coalesce(p_activity->>'activity_name', '');
  v_band text := private.feedback_age_band(p_activity->>'grade');
begin
  if v_name ilike '%ביומימיקרי%' or v_name ilike '%ביומימקרי%' then
    if exists (
      select 1 from public.feedback_programs p, unnest(p.exclude_patterns) ex
      where p.key in ('biomimicry', 'biomimicry_secondary') and v_name ilike ex
    ) then
      return null;
    end if;
    if v_name ilike '%לחטיבה%' or v_name ilike '%חטיבה%' then
      return 'biomimicry_secondary';
    end if;
    if v_band in ('g_i','j_l') then return 'biomimicry_secondary'; end if;
    if v_band in ('a_c','d_f') then return 'biomimicry'; end if;
    -- Same short name exists in two catalog entries; without grade/Gefen do not guess.
    return null;
  end if;
  return private.feedback_resolve_program(v_name);
end $$;
revoke all on function private.feedback_resolve_program_for_activity(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Course-level collection summary (unit of analysis = course + respondent population).
-- One row per program x audience x stage, plus one row per program x audience with stage = 'all'
-- (needed for unique respondents across PRE and FINAL, which cannot be summed per stage).
--   responses              questionnaires actually submitted (feedback_responses rows)
--   invited / completed    personal links only (instructor, educational staff)
--   unique_respondents     distinct people, only where identity is reliable:
--                          instructor = emp_id, staff = contacts_schools id; students = NULL (anonymous)
--   unidentified_responses personal responses without a reliable identity key
--   participants_*         student groups whose activity has a numeric participants_count; the
--                          response rate may be computed only over those campaigns
-- ---------------------------------------------------------------------------
create or replace function public.feedback_admin_course_summary(p_academic_year text default null)
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
  return query
  with camp as (
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
    left join lateral (
      select count(*)::int as n, min(r.submitted_at) as first_at, max(r.submitted_at) as last_at
      from public.feedback_responses r where r.campaign_id = c.id
    ) rs on true
    where p_academic_year is null or c.academic_year = p_academic_year
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
revoke all on function public.feedback_admin_course_summary(text) from public, anon;
grant execute on function public.feedback_admin_course_summary(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Not applicable" answers for rating questions.
-- Enabled per template-question by scoring.allow_na = true (set in a draft and published as a
-- new version). Stored as value_number NULL + value_options {na}; never part of averages.
-- Existing published versions have no allow_na flag, so their behaviour is unchanged.
-- ---------------------------------------------------------------------------
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
begin
  select * into v_target from private.feedback_token_target(p_token, false) limit 1;
  if v_target.campaign_id is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into c from public.feedback_campaigns where id = v_target.campaign_id;
  select * into v_program from public.feedback_programs where key = c.program_key;
  v_state := private.feedback_public_state(c.id, v_target.recipient_id);
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
        'text', replace(tq.wording->>'default', '{topic}', v_program.topic),
        'options', tq.options,
        'required', tq.required,
        'section', tq.section,
        'allow_na', (tq.question_type = 'rating_1_5' and coalesce(tq.scoring->>'allow_na', '') = 'true')
      ) order by tq.sort_order, tq.id)
      from public.feedback_template_questions tq
      where tq.version_id = c.template_version_id
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
      -- "לא רלוונטי / לא הייתה אפשרות להעריך" is accepted only where the version enables it.
      if jsonb_typeof(v) = 'string' and (v #>> '{}') = 'na' and coalesce(tq.scoring->>'allow_na', '') = 'true' then
        null;
      elsif jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
        v_invalid := v_invalid || tq.id::text;
      end if;
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
    if tq.question_type = 'rating_1_5' and jsonb_typeof(v) = 'string' then v_opts := array['na']; end if;
    insert into public.feedback_answers (
      response_id, template_question_id, question_id, metric_key, question_type,
      value_number, value_bool, value_text, value_options
    ) values (
      v_response, tq.id, tq.question_id, tq.metric_key, tq.question_type,
      case when tq.question_type = 'rating_1_5' and jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end,
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

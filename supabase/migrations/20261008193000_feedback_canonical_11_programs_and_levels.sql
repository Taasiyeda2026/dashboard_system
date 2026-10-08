-- Align impact feedback with the canonical 11-course catalog.
-- Course determines the relevant school level; questionnaire wording no longer branches
-- into four age-band wording versions. Grade/age_band remains for reporting/UI only.

alter table public.feedback_programs
  add column if not exists education_level text;

alter table public.feedback_programs
  drop constraint if exists feedback_programs_education_level_check;
alter table public.feedback_programs
  add constraint feedback_programs_education_level_check
  check (education_level in ('elementary', 'secondary'));

-- Existing programs: exact Gefen + target school level.
update public.feedback_programs
set title = 'ביומימיקרי',
    gefen_numbers = array['6089'],
    education_level = 'elementary',
    default_age_band = 'd_f',
    sort_order = 10,
    updated_at = now()
where key = 'biomimicry';

update public.feedback_programs
set title = 'מנהיגות ירוקה',
    gefen_numbers = array['67867'],
    education_level = 'elementary',
    default_age_band = 'd_f',
    sort_order = 30,
    updated_at = now()
where key = 'green_leadership';

update public.feedback_programs
set title = 'טכנולוגיות החלל',
    gefen_numbers = array['57651'],
    education_level = 'elementary',
    default_age_band = 'd_f',
    sort_order = 40,
    updated_at = now()
where key = 'space_tech';

update public.feedback_programs
set title = 'יישומי AI',
    gefen_numbers = array['53819'],
    education_level = 'secondary',
    default_age_band = 'g_i',
    sort_order = 60,
    updated_at = now()
where key = 'ai_applications';

update public.feedback_programs
set title = 'רוקחים עולם',
    gefen_numbers = array['46091'],
    education_level = 'secondary',
    default_age_band = 'g_i',
    sort_order = 80,
    updated_at = now()
where key = 'pharma';

update public.feedback_programs
set title = 'אופק פרימיום',
    gefen_numbers = array['52279'],
    education_level = 'secondary',
    default_age_band = 'g_i',
    sort_order = 90,
    updated_at = now()
where key = 'ofek';

update public.feedback_programs
set title = 'סודות ויסודות AI',
    gefen_numbers = array['9545'],
    education_level = 'secondary',
    default_age_band = 'g_i',
    sort_order = 100,
    updated_at = now()
where key = 'ai_foundations';

update public.feedback_programs
set title = 'פורצות דרך',
    gefen_numbers = array['3604'],
    education_level = 'secondary',
    default_age_band = 'g_i',
    sort_order = 110,
    updated_at = now()
where key = 'trailblazers';

-- Missing programs from the canonical catalog.
insert into public.feedback_programs (
  key, title, topic, catalog_program_ids, gefen_numbers, activity_name_patterns,
  exclude_patterns, default_age_band, education_level, sort_order, is_active
) values
  (
    'board_games', 'משחקי קופסה', 'פיתוח משחקי קופסה, אסטרטגיה ותכנון משחק',
    array['program-02','board-games'], array['27342'],
    array['%משחקי קופסה%','%פיתוח ופיצוח משחקי לוח%'], array[]::text[],
    'd_f', 'elementary', 20, true
  ),
  (
    'sky_limit', 'השמיים אינם הגבול', 'חלל, לוויינים וטכנולוגיות חלל',
    array['program-7','sky-is-not-the-limit'], array['57646'],
    array['%השמיים אינם הגבול%'], array[]::text[],
    'g_i', 'secondary', 50, true
  ),
  (
    'biomimicry_secondary', 'ביומימיקרי', 'ביומימיקרי, קיימות וחדשנות טכנולוגית',
    array['biomimicry-middle'], array['53828'],
    array['%ביומימיקרי לחטיבה%','%ביומימיקרי חטיבה%','%חדשנות סביבתית%בהשראה מן הטבע%'],
    array[]::text[], 'g_i', 'secondary', 70, true
  )
on conflict (key) do update set
  title = excluded.title,
  topic = excluded.topic,
  catalog_program_ids = excluded.catalog_program_ids,
  gefen_numbers = excluded.gefen_numbers,
  activity_name_patterns = excluded.activity_name_patterns,
  exclude_patterns = excluded.exclude_patterns,
  default_age_band = excluded.default_age_band,
  education_level = excluded.education_level,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- All active feedback programs must have a canonical school level.
alter table public.feedback_programs
  alter column education_level set not null;

-- Name-only Biomimicry must be resolved by grade because 6089 and 53828 share the same short name.
-- Gefen remains higher priority in feedback_activity_program(), so exact catalog IDs always win.
create or replace function private.feedback_resolve_program_for_activity(p_activity jsonb)
returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_name text := coalesce(p_activity->>'activity_name', '');
  v_band text := private.feedback_age_band(p_activity->>'grade');
begin
  if v_name ilike '%ביומימיקרי%' or v_name ilike '%ביומימקרי%' then
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
    select private.feedback_resolve_program_for_activity(p_activity), 'name'::text, false
    where private.feedback_resolve_program_for_activity(p_activity) is not null
      and not exists (select 1 from public.feedback_campaigns c where c.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings ma where ma.scope = 'activity' and ma.activity_row_id = p_activity->>'row_id')
      and not exists (select 1 from public.feedback_program_mappings mn where mn.scope = 'activity_name' and mn.activity_name_key = private.feedback_name_key(p_activity->>'activity_name'))
      and not exists (select 1 from public.feedback_programs p where p.is_active
        and nullif(btrim(coalesce(p_activity->>'gefen_number', '')), '') = any(p.gefen_numbers))
  ) by_name;
$$;
revoke all on function private.feedback_activity_program(jsonb) from public, anon, authenticated;

-- New course-specific questions, grounded in the catalog goals/skills/outcomes.
insert into public.feedback_questions (
  question_key, program_key, metric_key, question_type, audiences, stages,
  is_comparison, wording, options, scoring, default_required, sort_order
) values
  ('board_rules', 'board_games', 'knowledge', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני מבין/ה איך חוקים, מטרות ואתגרים משפיעים על חוויית המשחק"}', '[]', '{"include_in_score":true}', true, 100),
  ('board_design', 'board_games', 'skills', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני יודע/ת לתכנן רעיון למשחק עם חוקים ברורים, אתגר ותנאי ניצחון"}', '[]', '{"include_in_score":true}', true, 110),
  ('board_iteration', 'board_games', 'skills', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"בדקנו את המשחק, קיבלנו משוב ושיפרנו אותו בהתאם"}', '[]', '{"include_in_score":true}', true, 300),
  ('board_product', 'board_games', 'overall_impact', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"אני גאה במשחק שפיתחנו ויכול/ה להסביר לאחרים איך משחקים בו"}', '[]', '{"include_in_score":true}', true, 310),
  ('board_staff', 'board_games', 'skills', 'rating_1_5', array['educational_staff'], array['final'], false,
   '{"default":"התלמידים הפגינו חשיבה אסטרטגית, תכנון ויכולת לשפר את המשחק בעקבות בדיקה ומשוב"}', '[]', '{"include_in_score":true}', true, 500),
  ('board_instructor', 'board_games', 'delivery', 'rating_1_5', array['instructor'], array['final'], false,
   '{"default":"תהליך התכנון, המשחק, הבדיקה והשיפור עבד היטב עם התלמידים"}', '[]', '{"include_in_score":true}', true, 500),

  ('sky_satellites', 'sky_limit', 'knowledge', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני מבין/ה כיצד לוויינים וטכנולוגיות חלל משפיעים על החיים בכדור הארץ"}', '[]', '{"include_in_score":true}', true, 100),
  ('sky_engineering', 'sky_limit', 'skills', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני יודע/ת לחבר בין אתגר בחלל לבין פתרון מדעי או הנדסי אפשרי"}', '[]', '{"include_in_score":true}', true, 110),
  ('sky_application', 'sky_limit', 'skills', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"הצלחתי לפתח רעיון יישומי בהשראת טכנולוגיות חלל"}', '[]', '{"include_in_score":true}', true, 300),
  ('sky_future', 'sky_limit', 'interest', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"התוכנית הגבירה את הסקרנות שלי לגבי חלל, טכנולוגיה ואתגרי העתיד"}', '[]', '{"include_in_score":true}', true, 310),
  ('sky_staff', 'sky_limit', 'knowledge', 'rating_1_5', array['educational_staff'], array['final'], false,
   '{"default":"התלמידים הצליחו לקשר בין ידע על החלל לבין יישומים טכנולוגיים בעולם האמיתי"}', '[]', '{"include_in_score":true}', true, 500),
  ('sky_instructor', 'sky_limit', 'delivery', 'rating_1_5', array['instructor'], array['final'], false,
   '{"default":"החיבור בין חלל, לוויינים ויישומים טכנולוגיים עבד היטב בהדרכה"}', '[]', '{"include_in_score":true}', true, 500),

  ('biomimicry_mid_mechanism', 'biomimicry_secondary', 'knowledge', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני יודע/ת לזהות מנגנון בטבע ולהסביר את עקרון הפעולה שלו"}', '[]', '{"include_in_score":true}', true, 100),
  ('biomimicry_mid_transfer', 'biomimicry_secondary', 'skills', 'rating_1_5', array['student'], array['pre','post'], true,
   '{"default":"אני יודע/ת לתרגם עיקרון מהטבע לרעיון טכנולוגי שיכול לפתור צורך אנושי"}', '[]', '{"include_in_score":true}', true, 110),
  ('biomimicry_mid_sustainability', 'biomimicry_secondary', 'attitudes', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"אני מבין/ה איך ביומימיקרי יכול לעזור לפתח פתרונות מקיימים ואחראיים יותר"}', '[]', '{"include_in_score":true}', true, 300),
  ('biomimicry_mid_product', 'biomimicry_secondary', 'overall_impact', 'rating_1_5', array['student'], array['post'], false,
   '{"default":"הצלחנו להפוך את החקר שלנו לדגם, אב־טיפוס או תוצר שממחיש פתרון ביומימטי"}', '[]', '{"include_in_score":true}', true, 310),
  ('biomimicry_mid_staff', 'biomimicry_secondary', 'skills', 'rating_1_5', array['educational_staff'], array['final'], false,
   '{"default":"התלמידים הצליחו לעבור מחקר של מנגנון טבעי לפיתוח רעיון טכנולוגי מבוסס"}', '[]', '{"include_in_score":true}', true, 500),
  ('biomimicry_mid_instructor', 'biomimicry_secondary', 'overall_impact', 'rating_1_5', array['instructor'], array['final'], false,
   '{"default":"החקר, תרגום העיקרון הביולוגי והפיתוח של תוצר ביומימטי עבדו היטב עם הקבוצה"}', '[]', '{"include_in_score":true}', true, 500)
on conflict (question_key) do update set
  program_key = excluded.program_key,
  metric_key = excluded.metric_key,
  question_type = excluded.question_type,
  audiences = excluded.audiences,
  stages = excluded.stages,
  is_comparison = excluded.is_comparison,
  wording = excluded.wording,
  options = excluded.options,
  scoring = excluded.scoring,
  default_required = excluded.default_required,
  sort_order = excluded.sort_order,
  is_active = true,
  updated_at = now();

-- Age-specific wording keys are no longer part of the active question bank.
update public.feedback_questions
set wording = jsonb_build_object('default', wording->>'default'),
    updated_at = now()
where wording ?| array['a_c','d_f','g_i','j_l'];

-- Create the same five survey slots for every canonical course.
insert into public.feedback_templates (program_key, audience, stage, title)
select p.key, s.audience, s.stage, p.title || ' – ' || s.label
from public.feedback_programs p
cross join (values
  ('student', 'pre', 'תלמידים – פתיחה'),
  ('student', 'post', 'תלמידים – סיום'),
  ('educational_staff', 'final', 'צוות חינוכי'),
  ('instructor', 'pre', 'מדריך – פתיחה'),
  ('instructor', 'final', 'מדריך – סיום')
) as s(audience, stage, label)
where p.is_active
on conflict (program_key, audience, stage) do update
  set title = excluded.title, updated_at = now();

-- Publish v1 only for newly-added program templates.
do $$
declare
  t record;
  v_version uuid;
begin
  for t in
    select tp.*
    from public.feedback_templates tp
    where not exists (
      select 1 from public.feedback_template_versions v where v.template_id = tp.id
    )
  loop
    v_version := private.feedback_compose_draft(t.id);
    update public.feedback_template_versions
    set intro_text = case
      when t.audience = 'student' and t.stage = 'pre'
        then 'לפני שמתחילים – נשמח לדעת מה אתם חושבים ומרגישים. אין תשובות נכונות או לא נכונות, והשאלון אנונימי.'
      when t.audience = 'student' and t.stage = 'post'
        then 'סיימנו את התוכנית! נשמח לשמוע איך היה ומה השתנה אצלכם. השאלון אנונימי.'
      when t.audience = 'educational_staff'
        then 'נשמח לשמוע את הערכתכם לגבי התוכנית ולגבי מה שראיתם אצל התלמידים. המשוב עוזר לנו להשתפר.'
      when t.audience = 'instructor' and t.stage = 'pre'
        then 'המשוב הזה נשלח לאחר ההכשרה ולפני תחילת ההדרכה. חשוב לנו להבין עד כמה התוכן, החומרים וההכשרה הכינו אותך לקראת הקורס ומה עדיין חסר.'
      else
        'לאחר סיום הקורס נשמח לשמוע מה עבד בפועל, מה דורש שיפור ומה דעתך על התוכן, החומרים, התפעול וההשפעה על התלמידים.'
    end,
    notes = 'גרסת ברירת מחדל'
    where id = v_version;
    perform private.feedback_publish_version(v_version);
  end loop;
end $$;

-- The active questionnaire always uses the template's canonical wording.
-- age_band stays in payload/responses for reporting and presentation only.
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
        'section', tq.section
      ) order by tq.sort_order, tq.id)
      from public.feedback_template_questions tq
      where tq.version_id = c.template_version_id
    ), '[]'::jsonb) end
  );
end $$;
revoke all on function public.feedback_public_get(text) from public;
grant execute on function public.feedback_public_get(text) to anon, authenticated;

notify pgrst, 'reload schema';

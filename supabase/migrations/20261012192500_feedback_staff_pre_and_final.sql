-- Add staff opening feedback while retaining existing closing questionnaires and links.
alter table public.feedback_templates drop constraint if exists feedback_templates_audience_stage_check;
alter table public.feedback_templates add constraint feedback_templates_audience_stage_check check (
  (audience='student' and stage in ('pre','post'))
  or (audience='educational_staff' and stage in ('pre','final'))
  or (audience='instructor' and stage in ('pre','final'))
);
alter table public.feedback_campaigns drop constraint if exists feedback_campaigns_audience_stage_check;
alter table public.feedback_campaigns add constraint feedback_campaigns_audience_stage_check check (
  (audience='student' and stage in ('pre','post'))
  or (audience='educational_staff' and stage in ('pre','final'))
  or (audience='instructor' and stage in ('pre','final','final_b'))
);

-- Opening questions measure baseline and expectations. They are not end-of-course outcomes.
insert into public.feedback_questions
 (question_key,program_key,metric_key,question_type,audiences,stages,is_comparison,wording,options,scoring,default_required,sort_order)
values
  ('staff_pre_goals',null,'content','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"מטרות התוכנית והנושאים שהיא עוסקת בהם ברורים לי לפני תחילתה.","ar":"أهداف البرنامج والموضوعات التي يتناولها واضحة لي قبل بدايته."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,10),
  ('staff_pre_relevance',null,'content','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"אני מצפה שנושאי התוכנית יתאימו לגיל התלמידים ולצרכים של הקבוצה.","ar":"أتوقّع أن تتناسب موضوعات البرنامج مع أعمار الطلاب واحتياجات المجموعة."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,20),
  ('staff_pre_interest',null,'interest','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"לפני תחילת התוכנית, התלמידים מגלים עניין בנושא {topic}.","ar":"قبل بدء البرنامج، يُبدي الطلاب اهتمامًا بموضوع {topic}."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,30),
  ('staff_pre_knowledge',null,'knowledge','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"לפני תחילת התוכנית, לתלמידים יש ידע בסיסי בנושא {topic}.","ar":"قبل بدء البرنامج، لدى الطلاب معرفة أساسية بموضوع {topic}."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,40),
  ('staff_pre_skills',null,'skills','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"לפני תחילת התוכנית, התלמידים מגלים יכולת לעבוד בצוות ולפתור בעיות.","ar":"قبل بدء البرنامج، يُظهر الطلاب قدرة على العمل الجماعي وحل المشكلات."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,50),
  ('staff_pre_preparedness',null,'delivery','rating_1_5',array['educational_staff'],array['pre'],false,'{"default":"התיאום וההיערכות הנדרשים לקיום התוכנית בבית הספר ברורים לי.","ar":"التنسيق والاستعدادات اللازمة لتنفيذ البرنامج في المدرسة واضحة لي."}'::jsonb,'[]'::jsonb,'{"include_in_score":true,"allow_na":true}'::jsonb,true,60),
  ('staff_pre_expectations',null,'satisfaction','free_text',array['educational_staff'],array['pre'],false,'{"default":"מה היית רוצה שהתלמידים ילמדו או יחוו בתוכנית? האם יש צרכים שחשוב שנכיר מראש?","ar":"ماذا تودّ أن يتعلّم الطلاب أو يختبروا في البرنامج؟ وهل هناك احتياجات ينبغي أن نعرفها مسبقًا؟"}'::jsonb,'[]'::jsonb,'{"include_in_score":false,"allow_na":false}'::jsonb,false,70)
on conflict (question_key) do nothing;

do $staff_opening_templates$
declare
  p record;
  v_template uuid;
  v_version uuid;
begin
  for p in select key, title from public.feedback_programs loop
    insert into public.feedback_templates (program_key,audience,stage,title)
    values (p.key,'educational_staff','pre',p.title || ' – צוות חינוכי – פתיחה')
    on conflict (program_key,audience,stage) do nothing;
    select id,current_version_id into v_template,v_version
    from public.feedback_templates where program_key=p.key and audience='educational_staff' and stage='pre';
    if v_version is not null then continue; end if;

    insert into public.feedback_template_versions
      (template_id,version_no,status,intro_text,intro_text_ar)
    values (
      v_template,
      coalesce((select max(version_no) from public.feedback_template_versions where template_id=v_template),0)+1,
      'draft',
      'לפני תחילת התוכנית נשמח ללמוד על הציפיות והצרכים של התלמידים ועל נקודת הפתיחה שלהם. התשובות יסייעו לנו להתאים את ההדרכה. ניתן לבחור ״לא ניתן להעריך״ כשאין מידע.',
      'قبل بداية البرنامج، نودّ التعرّف إلى توقّعاتكم واحتياجات الطلاب ومستوى انطلاقهم. ستساعدنا إجاباتكم على ملاءمة الإرشاد. يمكن اختيار «لا يمكن التقييم» عند عدم توفّر معلومات.'
    ) returning id into v_version;

    insert into public.feedback_template_questions
      (version_id,question_id,section,sort_order,required,metric_key,question_type,is_comparison,wording,options,scoring)
    select v_version,q.id,'core',q.sort_order,q.default_required,q.metric_key,q.question_type,
           q.is_comparison,q.wording,q.options,q.scoring
    from public.feedback_questions q
    where q.program_key is null
      and q.question_key like 'staff_pre_%'
      and q.is_active
      and 'educational_staff'=any(q.audiences) and 'pre'=any(q.stages)
    order by q.sort_order;

    update public.feedback_template_versions
    set status='published',published_at=now()
    where id=v_version;
    update public.feedback_templates
    set current_version_id=v_version,updated_at=now()
    where id=v_template;
  end loop;
end $staff_opening_templates$;


-- Both opening and closing stages must be accepted by the public campaign opening RPC.
CREATE OR REPLACE FUNCTION public.feedback_admin_open_campaign(p_activity_row_id text, p_audience text, p_stage text, p_opens_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_age_band text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if (p_audience = 'student' and p_stage not in ('pre', 'post'))
    or (p_audience = 'educational_staff' and p_stage not in ('pre', 'final'))
    or (p_audience = 'instructor' and p_stage <> 'final') then
    raise exception 'feedback_invalid_stage';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then raise exception 'feedback_invalid_window'; end if;

  select to_jsonb(x) into a from public.activities x where x.row_id = p_activity_row_id;
  if a is null then raise exception 'feedback_activity_not_found'; end if;
  -- Use actual scheduled course dates; a planned end date is not required for staff opening.
  if p_audience = 'educational_staff' and (
    coalesce(a->>'start_date', '') !~ '^\\d{4}-\\d{2}-\\d{2}' or
    (p_stage = 'final' and coalesce(a->>'end_date', '') !~ '^\\d{4}-\\d{2}-\\d{2}')
  ) then
    raise exception 'feedback_staff_stage_date_missing' using errcode = '22023';
  end if;

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
end $function$
;

-- Collection reporting includes opening without requiring a scheduled end date.
CREATE OR REPLACE FUNCTION public.feedback_admin_course_summary_for_half(p_academic_year text, p_half text)
 RETURNS TABLE(program_key text, audience text, stage text, campaigns integer, groups integer, responses integer, invited integer, completed integer, unique_respondents integer, unidentified_responses integer, participants_total integer, participants_campaigns integer, responses_with_participants integer, first_response_at timestamp with time zone, last_response_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.feedback_can_view() then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
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
end $function$
;

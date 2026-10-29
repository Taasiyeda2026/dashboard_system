-- Educational staff: three-stage questionnaires (opening, midpoint, final).
-- Preserves every historical published snapshot, campaign, response, and answer.
-- New active versions apply to NEW campaigns only. No automatic dispatch is enabled.
-- Review: docs/feedback/educational-staff-three-stage-questionnaires-draft-2026-10-29.md

alter table public.feedback_templates drop constraint if exists feedback_templates_stage_check;
alter table public.feedback_templates add constraint feedback_templates_stage_check check (stage = any(array['pre','mid','post','final']));
alter table public.feedback_templates drop constraint if exists feedback_templates_audience_stage_check;
alter table public.feedback_templates add constraint feedback_templates_audience_stage_check check (
 (audience='student' and stage in ('pre','post')) or
 (audience='educational_staff' and stage in ('pre','mid','final')) or
 (audience='instructor' and stage in ('pre','final')));

alter table public.feedback_campaigns drop constraint if exists feedback_campaigns_stage_check;
alter table public.feedback_campaigns add constraint feedback_campaigns_stage_check check (stage = any(array['pre','mid','post','final','final_b']));
alter table public.feedback_campaigns drop constraint if exists feedback_campaigns_audience_stage_check;
alter table public.feedback_campaigns add constraint feedback_campaigns_audience_stage_check check (
 (audience='student' and stage in ('pre','post')) or
 (audience='educational_staff' and stage in ('pre','mid','final')) or
 (audience='instructor' and stage in ('pre','final','final_b')));

alter table public.feedback_questions drop constraint if exists feedback_questions_stages_check;
alter table public.feedback_questions add constraint feedback_questions_stages_check check (
 cardinality(stages)>0 and stages <@ array['pre','mid','post','final']::text[]);

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
  if not private.feedback_is_admin() and not (p_audience = 'educational_staff' and private.feedback_can_share_staff_activity(p_activity_row_id)) then raise exception 'feedback_forbidden' using errcode = '42501'; end if;
  if p_audience not in ('student', 'educational_staff', 'instructor') then raise exception 'feedback_invalid_audience'; end if;
  if (p_audience = 'student' and p_stage not in ('pre', 'post'))
    or (p_audience = 'educational_staff' and p_stage not in ('pre', 'mid', 'final'))
    or (p_audience = 'instructor' and p_stage <> 'final') then
    raise exception 'feedback_invalid_stage';
  end if;
  if p_expires_at is not null and p_expires_at <= v_opens then raise exception 'feedback_invalid_window'; end if;

  select to_jsonb(x) into a from public.activities x where x.row_id = p_activity_row_id;
  if a is null then raise exception 'feedback_activity_not_found'; end if;
  -- Use actual scheduled course dates; a planned end date is not required for staff opening.
  if p_audience = 'educational_staff' and (
    coalesce(a->>'start_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' or
    (p_stage = 'final' and coalesce(a->>'end_date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}')
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
    case when coalesce(a->>'start_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(a->>'start_date', 10)::date end,
    case when coalesce(a->>'end_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then left(a->>'end_date', 10)::date end,
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
end $function$;

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
      and (c.audience <> 'educational_staff' or (c.stage in ('pre','mid') and a.start_date is not null) or (c.stage = 'final' and a.end_date is not null))
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

insert into public.feedback_questions
(question_key,program_key,metric_key,question_type,audiences,stages,is_comparison,wording,options,scoring,default_required,sort_order,is_active)
values
('staff_20261029_S01',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"מטרות התוכנית ברורות לי לפני תחילתה.","ar":"أهداف البرنامج واضحة لي قبل بدايته."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,10,true),
('staff_20261029_S02',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"להערכתי, התוכנית מתאימה לצרכים הלימודיים של קבוצת התלמידים.","ar":"أرى أن البرنامج ملائم للاحتياجات التعليمية لمجموعة الطلاب."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,20,true),
('staff_20261029_S03',NULL,'interest','rating_1_5',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"נכון להיום, התלמידים מגלים עניין בתחום שבו עוסקת התוכנית.","ar":"في الوقت الحالي يُبدي الطلاب اهتمامًا بالمجال الذي يتناوله البرنامج."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,30,true),
('staff_20261029_S04',NULL,'knowledge','rating_1_5',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"נכון להיום, לתלמידים יש ידע בסיסי בתחום שבו עוסקת התוכנית.","ar":"في الوقت الحالي لدى الطلاب معرفة أساسية بالمجال الذي يتناوله البرنامج."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,40,true),
('staff_20261029_S05',NULL,'overall_impact','multi_select',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"באילו תחומים חשוב לך שהתלמידים יתקדמו במהלך התוכנית?","ar":"في أي مجالات يهمّك أن يتقدّم الطلاب خلال البرنامج؟"}'::jsonb,'[{"value":"knowledge","label":"ידע והבנה","label_ar":"المعرفة والفهم"},{"value":"interest","label":"סקרנות ועניין","label_ar":"الفضول والاهتمام"},{"value":"solutions","label":"פתרון בעיות","label_ar":"حل المشكلات"},{"value":"creativity","label":"יצירתיות","label_ar":"الإبداع"},{"value":"teamwork","label":"עבודת צוות","label_ar":"العمل الجماعي"},{"value":"self_efficacy","label":"ביטחון ומסוגלות","label_ar":"الثقة والكفاءة الذاتية"},{"value":"industry","label":"חשיפה לעולם הטכנולוגיה והתעשייה","label_ar":"التعرّف إلى عالم التكنولوجيا والصناعة"},{"value":"practice","label":"יישום מעשי","label_ar":"التطبيق العملي"},{"value":"other","label":"אחר","label_ar":"أخرى"}]'::jsonb,'{}'::jsonb,true,50,true),
('staff_20261029_S06',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"ההיערכות הנדרשת לקיום התוכנית בבית הספר ברורה לי.","ar":"الاستعدادات اللازمة لتنفيذ البرنامج في المدرسة واضحة لي."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,60,true),
('staff_20261029_S07',NULL,'operations','single_select',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"האם יש לקבוצה צרכים מיוחדים שחשוב להתחשב בהם בהדרכה?","ar":"هل لدى المجموعة احتياجات خاصة ينبغي أخذها بالحسبان أثناء الإرشاد؟"}'::jsonb,'[{"value":"none","label":"לא","label_ar":"لا"},{"value":"knowledge","label":"כן, התאמות ברמת הידע","label_ar":"نعم، ملاءمات في مستوى المعرفة"},{"value":"accessibility","label":"כן, התאמות להנגשה או השתתפות","label_ar":"نعم، ملاءمات لإتاحة المشاركة"},{"value":"logistics","label":"כן, היערכות לוגיסטית","label_ar":"نعم، ترتيبات لوجستية"},{"value":"other","label":"אחר","label_ar":"أخرى"}]'::jsonb,'{}'::jsonb,true,70,true),
('staff_20261029_S08',NULL,'satisfaction','free_text',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"מה חשוב לך במיוחד שהתלמידים יידעו או יצליחו לעשות בסיום התוכנית?","ar":"ما الأهم بالنسبة إليك أن يعرفه الطلاب أو يتمكّنوا من فعله في نهاية البرنامج؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,80,true),
('staff_20261029_S09',NULL,'operations','free_text',ARRAY['educational_staff'],ARRAY['pre'],false,'{"default":"האם יש מידע או בקשה שחשוב שנכיר מראש כדי שהפעילות תצליח?","ar":"هل هناك معلومات أو طلبات ينبغي أن نعرفها مسبقًا لضمان نجاح النشاط؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,90,true),
('staff_20261029_M01',NULL,'satisfaction','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"מהי מידת שביעות הרצון הכללית שלך מהתוכנית עד כה?","ar":"ما مدى رضاك العام عن البرنامج حتى الآن؟"}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,10,true),
('staff_20261029_M02',NULL,'interest','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"התלמידים משתתפים באופן פעיל במפגשים שבהם צפיתי.","ar":"يشارك الطلاب بفاعلية في اللقاءات التي شاهدتها."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,20,true),
('staff_20261029_M03',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"הפעילויות שהתקיימו עד כה מתאימות לרמת התלמידים.","ar":"الأنشطة التي نُفِّذت حتى الآن ملائمة لمستويات الطلاب."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,30,true),
('staff_20261029_M04',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"קצב ההתקדמות במפגשים מתאים לקבוצה.","ar":"وتيرة التقدّم في اللقاءات ملائمة للمجموعة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,40,true),
('staff_20261029_M05',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"המדריך/ה מסביר/ה את התכנים בצורה ברורה.","ar":"يشرح المرشد أو المرشدة المضامين بصورة واضحة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,50,true),
('staff_20261029_M06',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"המדריך/ה מעודד/ת את התלמידים להשתתף בפעילות.","ar":"يشجّع المرشد أو المرشدة الطلاب على المشاركة في النشاط."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,60,true),
('staff_20261029_M07',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"המדריך/ה מנהל/ת את הקבוצה באופן מכבד.","ar":"يدير المرشد أو المرشدة المجموعة باحترام."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,70,true),
('staff_20261029_M08',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"המדריך/ה מגיע/ה למפגשים בזמן.","ar":"يصل المرشد أو المرشدة إلى اللقاءات في الوقت المحدّد."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,80,true),
('staff_20261029_M09',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"תיאום מועדי המפגשים עם תעשיידע מתנהל בצורה מסודרת.","ar":"يجري تنسيق مواعيد اللقاءات مع تעשיידע بصورة منظّمة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,90,true),
('staff_20261029_M10',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"הציוד והחומרים הדרושים לפעילות זמינים במפגשים.","ar":"تتوفّر المعدات والمواد اللازمة للنشاط خلال اللقاءات."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,100,true),
('staff_20261029_M11',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"כאשר פניתי לצוות תעשיידע, קיבלתי מענה לצורך שהעליתי.","ar":"عندما توجّهت إلى طاقم المؤسسة، تلقيت استجابة لطلبي."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,110,true),
('staff_20261029_M12',NULL,'operations','single_select',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"האם קיים כרגע קושי שחשוב שתעשיידע תטפל בו במהלך הקורס?","ar":"هل توجد حاليًا صعوبة ينبغي أن تعالجها المؤسسة خلال الدورة؟"}'::jsonb,'[{"value":"none","label":"אין קושי","label_ar":"لا توجد صعوبة"},{"value":"minor","label":"קושי קל","label_ar":"صعوبة بسيطة"},{"value":"significant","label":"קושי משמעותי","label_ar":"صعوبة كبيرة"},{"value":"urgent","label":"קושי דחוף שמצריך טיפול","label_ar":"صعوبة عاجلة تتطلّب المعالجة"},{"value":"unknown","label":"לא ידוע לי","label_ar":"لا أعلم"}]'::jsonb,'{}'::jsonb,true,120,true),
('staff_20261029_M13',NULL,'operations','multi_select',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"באילו נושאים נדרש טיפול או שיפור?","ar":"في أي مجالات يلزم التدخّل أو التحسين؟"}'::jsonb,'[{"value":"instructor","label":"מדריך/ה","label_ar":"المرشد/ة"},{"value":"content","label":"התוכן או הקצב","label_ar":"المحتوى أو الوتيرة"},{"value":"participation","label":"השתתפות או התאמה לתלמידים","label_ar":"مشاركة الطلاب أو الملاءمة لهم"},{"value":"coordination","label":"תיאום מועדים","label_ar":"تنسيق المواعيد"},{"value":"equipment","label":"ציוד וחומרים","label_ar":"المعدات والمواد"},{"value":"service","label":"תקשורת ושירות","label_ar":"التواصل والخدمة"},{"value":"other","label":"אחר","label_ar":"أخرى"}]'::jsonb,'{}'::jsonb,false,130,true),
('staff_20261029_M14',NULL,'operations','free_text',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"מה בדיוק קרה ומה לדעתך צריך לעשות כדי לשפר?","ar":"ماذا حدث بالتحديد، وما الذي ينبغي فعله برأيك للتحسين؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,140,true),
('staff_20261029_M15',NULL,'operations','yes_no',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"האם תרצה/י שניצור איתך קשר כדי לטפל בנושא?","ar":"هل تودّ أن نتواصل معك لمعالجة الموضوع؟"}'::jsonb,'[]'::jsonb,'{"include_in_score":false}'::jsonb,false,150,true),
('staff_20261029_M16',NULL,'satisfaction','free_text',ARRAY['educational_staff'],ARRAY['mid'],false,'{"default":"מה עבד טוב במפגשים עד כה, וחשוב לך שנמשיך לשמר?","ar":"ما الذي سار بصورة جيدة في اللقاءات حتى الآن، وترغب في أن نحافظ عليه؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,160,true),
('staff_20261029_F01',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התוכנית התאימה לרמת התלמידים.","ar":"كان البرنامج ملائمًا لمستويات الطلاب."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,10,true),
('staff_20261029_F02',NULL,'content','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התכנים שהועברו היו רלוונטיים למטרות התוכנית.","ar":"كانت المضامين المقدّمة مرتبطة بأهداف البرنامج."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,20,true),
('staff_20261029_F03',NULL,'interest','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התלמידים השתתפו באופן פעיל במפגשים שבהם צפיתי.","ar":"شارك الطلاب بفاعلية في اللقاءات التي شاهدتها."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,30,true),
('staff_20261029_F04',NULL,'knowledge','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התלמידים רכשו ידע חדש בתחום התוכנית.","ar":"اكتسب الطلاب معرفة جديدة في مجال البرنامج."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,40,true),
('staff_20261029_F05',NULL,'interest','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התוכנית עוררה אצל התלמידים סקרנות ורצון להמשיך ללמוד.","ar":"أثار البرنامج لدى الطلاب الفضول والرغبة في مواصلة التعلّم."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,50,true),
('staff_20261029_F06',NULL,'skills','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התלמידים תרגלו פתרון בעיות במהלך הפעילות.","ar":"تدرّب الطلاب على حلّ المشكلات خلال النشاط."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,60,true),
('staff_20261029_F07',NULL,'skills','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התוכנית נתנה לתלמידים הזדמנות להציע רעיונות יצירתיים.","ar":"أتاح البرنامج للطلاب فرصة اقتراح أفكار إبداعية."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,70,true),
('staff_20261029_F08',NULL,'skills','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התלמידים עבדו יחד כדי להשיג מטרה משותפת.","ar":"عمل الطلاب معًا لتحقيق هدف مشترك."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,80,true),
('staff_20261029_F09',NULL,'self_efficacy','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התוכנית חיזקה את ביטחונם של התלמידים ביכולתם להתמודד עם אתגרים.","ar":"عزّز البرنامج ثقة الطلاب بقدرتهم على مواجهة التحديات."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,90,true),
('staff_20261029_F10',NULL,'knowledge','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התלמידים הצליחו ליישם בלמידה או בתוצר ידע שרכשו בתוכנית.","ar":"تمكّن الطلاب من تطبيق المعرفة التي اكتسبوها في التعلّم أو في منتج نهائي."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,100,true),
('staff_20261029_F11',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"המדריך/ה הפגין/ה שליטה בתכנים.","ar":"أظهر المرشد أو المرشدة تمكّنًا من المضامين."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,110,true),
('staff_20261029_F12',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"המדריך/ה הסביר/ה את הנושאים בצורה ברורה.","ar":"شرح المرشد أو المرشدة الموضوعات بصورة واضحة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,120,true),
('staff_20261029_F13',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"המדריך/ה ניהל/ה את הקבוצה היטב.","ar":"أدار المرشد أو المرشدة المجموعة بصورة جيدة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,130,true),
('staff_20261029_F14',NULL,'delivery','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"המדריך/ה יצר/ה קשר חיובי ומכבד עם התלמידים.","ar":"أقام المرشد أو المرشدة علاقة إيجابية ومحترمة مع الطلاب."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,140,true),
('staff_20261029_F15',NULL,'operations','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"תיאום מועדי המפגשים מול צוות תעשיידע התנהל בצורה מסודרת.","ar":"جرى تنسيق مواعيد اللقاءات مع طاقم تעשיידע بصورة منظّمة."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,150,true),
('staff_20261029_F16',NULL,'overall_impact','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"התוכנית עמדה בציפיות שהיו לי בתחילת הדרך.","ar":"لبّى البرنامج التوقّعات التي كانت لديّ في البداية."}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,160,true),
('staff_20261029_F17',NULL,'satisfaction','rating_1_5',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"מהי מידת שביעות הרצון הכללית שלך מהתוכנית?","ar":"ما مدى رضاك العام عن البرنامج؟"}'::jsonb,'[]'::jsonb,'{"allow_na":true}'::jsonb,true,170,true),
('staff_20261029_F18',NULL,'overall_impact','multi_select',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"באילו תחומים הבחנת בשינוי חיובי אצל התלמידים?","ar":"في أي مجالات لاحظت تغيّرًا إيجابيًا لدى الطلاب؟"}'::jsonb,'[{"value":"knowledge","label":"ידע והבנה","label_ar":"المعرفة والفهم"},{"value":"interest","label":"עניין וסקרנות","label_ar":"الاهتمام والفضول"},{"value":"self_efficacy","label":"מסוגלות וביטחון","label_ar":"الكفاءة الذاتية والثقة"},{"value":"creativity","label":"יצירתיות","label_ar":"الإبداع"},{"value":"solutions","label":"פתרון בעיות","label_ar":"حلّ المشكلات"},{"value":"teamwork","label":"עבודת צוות","label_ar":"العمل الجماعي"},{"value":"practice","label":"יישום מעשי","label_ar":"التطبيق العملي"},{"value":"continuation","label":"רצון להעמיק בתחום","label_ar":"الرغبة في التعمّق في المجال"},{"value":"none","label":"לא הבחנתי בשינוי משמעותי","label_ar":"لم ألاحظ تغيّرًا ملحوظًا"}]'::jsonb,'{}'::jsonb,false,180,true),
('staff_20261029_F19',NULL,'continuation','yes_no',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"האם היית ממליץ/ה להפעיל את התוכנית שוב בבית הספר?","ar":"هل توصي بتنفيذ البرنامج مجددًا في المدرسة؟"}'::jsonb,'[]'::jsonb,'{"include_in_score":false}'::jsonb,true,190,true),
('staff_20261029_F20',NULL,'overall_impact','free_text',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"מהו ההישג או הרגע המשמעותי ביותר שראית אצל התלמידים?","ar":"ما الإنجاز أو الموقف الأكثر أهمية الذي لاحظته لدى الطلاب؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,200,true),
('staff_20261029_F21',NULL,'satisfaction','free_text',ARRAY['educational_staff'],ARRAY['final'],false,'{"default":"מה לדעתך צריך לשנות או לשפר לקראת הפעלת התוכנית הבאה?","ar":"ما الذي ينبغي تغييره أو تحسينه قبل تنفيذ البرنامج مرة أخرى؟"}'::jsonb,'[]'::jsonb,'{}'::jsonb,false,210,true)
on conflict (question_key) do nothing;

do $seed_staff_three_stage$
declare
  p record;
  st text;
  t record;
  old_version_id uuid;
  new_version_id uuid;
  intro_he text;
  intro_ar text;
  prev_q_count integer;
begin
  -- Idempotency: never overwrite an already published 2026-10-29 series.
  if exists (select 1 from public.feedback_template_versions where notes like 'staff-three-stage-20261029%') then
    raise notice 'staff-three-stage-20261029 already exists, no template changes';
    return;
  end if;
  for p in select key,title from public.feedback_programs where is_active order by sort_order loop
    foreach st in array array['pre','mid','final']::text[] loop
      select x.* into t from public.feedback_templates x
      where x.program_key=p.key and x.audience='educational_staff' and x.stage=st;
      if not found then
        if st <> 'mid' then raise exception 'Missing legacy template: % %',p.key,st; end if;
        insert into public.feedback_templates(program_key,audience,stage,title)
        values(p.key,'educational_staff','mid',p.title||' – צוות חינוכי – אמצע')
        returning * into t;
      end if;
      old_version_id:=t.current_version_id;
      if st='pre' then
        intro_he:='לצוות החינוכי שלום, לקראת תחילת התוכנית חשוב לנו להכיר את הצרכים והציפיות של בית הספר ואת נקודת הפתיחה של התלמידים. תשובותיכם יעזרו לנו להתאים את ההדרכה ולהיערך באופן מיטבי. אין תשובות נכונות או לא נכונות. תודה על שיתוף הפעולה.';
        intro_ar:='إلى الطاقم التربوي العزيز، قبل بداية البرنامج يهمّنا التعرّف إلى احتياجات المدرسة وتوقّعاتها ونقطة انطلاق الطلاب. ستساعدنا إجاباتكم على ملاءمة الإرشاد والاستعداد بصورة أفضل. لا توجد إجابات صحيحة أو خاطئة. شكرًا على تعاونكم.';
      elsif st='mid' then
        intro_he:='לצוות החינוכי שלום, כעת, במהלך התוכנית, חשוב לנו לדעת מה עובד טוב ומה דורש שינוי. זה הזמן לשתף אותנו בכל קושי כדי שנוכל לטפל בו כבר במפגשים הקרובים. אנא השיבו על סמך מה שראיתם בפועל. אם לא הייתה לכם אפשרות להעריך נושא מסוים, בחרו באפשרות המתאימה.';
        intro_ar:='إلى الطاقم التربوي العزيز، أثناء تنفيذ البرنامج يهمّنا معرفة الجوانب التي تسير بصورة جيدة والجوانب التي تحتاج إلى تحسين. هذا هو الوقت المناسب لإبلاغنا بأي صعوبة كي نتمكّن من معالجتها في اللقاءات القادمة. يرجى الإجابة بناءً على ما شاهدتموه فعلًا، واختيار «لا ينطبق / لم تتح لي فرصة التقييم» عند الحاجة.';
      else
        intro_he:='לצוות החינוכי שלום, עם סיום התוכנית נשמח לקבל את הערכתכם המקצועית על איכות התוכן, ההדרכה והשינויים שראיתם אצל התלמידים. משוב הסיום חשוב במיוחד לשיפור התוכניות ולהחלטות על המשך הפעלתן. אנא התבססו על מה שראיתם בפועל ובחרו ''לא רלוונטי / לא הייתה אפשרות להעריך'' במקום לנחש. תודה על שיתוף הפעולה.';
        intro_ar:='إلى الطاقم التربوي العزيز، مع اختتام البرنامج نرحّب بتقييمكم المهني لجودة المحتوى والإرشاد والتغيّرات التي لاحظتموها لدى الطلاب. لاستبيان النهاية أهمية كبيرة في تحسين البرامج واتخاذ قرارات بشأن استمرارها. يرجى الاستناد إلى ما شاهدتموه فعلًا واختيار «لا ينطبق / لم تتح لي فرصة التقييم» بدل التخمين. شكرًا على تعاونكم.';
      end if;
      insert into public.feedback_template_versions(template_id,version_no,status,intro_text,intro_text_ar,notes)
      values(t.id, (select coalesce(max(version_no),0)+1 from public.feedback_template_versions where template_id=t.id),
        'draft',intro_he,intro_ar,'staff-three-stage-20261029: '||st)
      returning id into new_version_id;

      insert into public.feedback_template_questions
      (version_id,question_id,section,sort_order,required,metric_key,question_type,is_comparison,wording,options,scoring)
      select new_version_id,q.id,'core',q.sort_order,q.default_required,q.metric_key,q.question_type,
             false,q.wording,q.options,q.scoring
      from public.feedback_questions q
      where q.question_key like 'staff_20261029_%'
        and st=case left(right(q.question_key,3),1) when 'S' then 'pre' when 'M' then 'mid' else 'final' end;

      if st='mid' then
        -- Show detail only when the reporter explicitly identified an actionable difficulty.
        update public.feedback_template_questions child
        set scoring=coalesce(child.scoring,'{}'::jsonb) ||
            jsonb_build_object('visible_when',jsonb_build_object(
                'parent_id',parent.id,'operator','in','values',jsonb_build_array('minor','significant','urgent')))
        from public.feedback_template_questions parent
        join public.feedback_questions pq on pq.id=parent.question_id
        join public.feedback_questions cq on cq.question_key in
          ('staff_20261029_M13','staff_20261029_M14','staff_20261029_M15')
        where parent.version_id=new_version_id and child.version_id=new_version_id
          and pq.question_key='staff_20261029_M12' and child.question_id=cq.id;
      end if;

      if st='final' and old_version_id is not null then
        -- Keep unique professional measures from the old final survey without duplicating generic ratings.
        insert into public.feedback_template_questions
          (version_id,question_id,section,sort_order,required,metric_key,question_type,is_comparison,wording,options,scoring)
        select new_version_id,l.question_id,'course',300+row_number() over(order by l.sort_order)*10,
          l.required,l.metric_key,l.question_type,false,l.wording,l.options,l.scoring
        from public.feedback_template_questions l
        where l.version_id=old_version_id
          and (
            (p.key in ('ai_applications','biomimicry_secondary','board_games','sky_limit') and l.section='course')
            or (p.key='ai_foundations' and l.sort_order in (50,80,90))
            or (p.key='biomimicry' and l.sort_order in (60,70,100))
            or (p.key='green_leadership' and l.sort_order in (50,60,90))
            or (p.key='ofek' and l.sort_order in (50,80,100))
            or (p.key='pharma' and l.sort_order in (40,50,80))
            or (p.key='space_tech' and l.sort_order in (60,70,80))
            or (p.key='trailblazers' and l.sort_order in (50,80,100))
          );
      end if;

      select count(*) into prev_q_count from public.feedback_template_questions where version_id=new_version_id;
      if prev_q_count < case st when 'pre' then 9 when 'mid' then 16 else 21 end then
         raise exception 'Insufficient question count for %/%: %',p.key,st,prev_q_count;
      end if;
      -- Partial unique indexes permit one published and one draft version per template.
      -- Archive the previous published snapshot; campaigns still reference it immutably.
      update public.feedback_template_versions set status='archived'
      where template_id=t.id and status='published';
      update public.feedback_template_versions set status='published',published_at=now() where id=new_version_id;
      update public.feedback_templates set current_version_id=new_version_id where id=t.id;
    end loop;
  end loop;
end $seed_staff_three_stage$;

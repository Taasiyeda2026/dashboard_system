-- Issue #2546. Preserve existing draft IDs, all published snapshots, links and responses.
CREATE OR REPLACE FUNCTION private.feedback_question_visible(p_answers jsonb, p_scoring jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_rule jsonb := p_scoring->'visible_when';
  v_parent jsonb;
  v_id text;
  v_operator text;
BEGIN
  IF v_rule IS NULL OR v_rule = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(v_rule) <> 'object' THEN RETURN false; END IF;
  IF v_rule ? 'any' THEN
    IF jsonb_typeof(v_rule->'any') <> 'array' OR jsonb_array_length(v_rule->'any') = 0 THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v_rule->'any') branch
      WHERE private.feedback_question_visible(p_answers, jsonb_build_object('visible_when', branch)));
  END IF;
  v_id := v_rule->>'parent_id';
  v_operator := v_rule->>'operator';
  IF coalesce(v_id,'') = '' OR coalesce(v_operator,'') NOT IN ('nonempty','not_equals','in') THEN RETURN false; END IF;
  v_parent := p_answers -> v_id;
  IF v_parent IS NULL OR v_parent = 'null'::jsonb THEN RETURN false; END IF;
  IF v_operator = 'nonempty' THEN
    IF jsonb_typeof(v_parent) = 'array' THEN RETURN jsonb_array_length(v_parent) > 0; END IF;
    IF jsonb_typeof(v_parent) = 'string' THEN RETURN length(btrim(v_parent #>> '{}')) > 0; END IF;
    RETURN false;
  END IF;
  IF v_operator = 'in' THEN
    IF jsonb_typeof(v_parent) NOT IN ('string','number','boolean')
      OR jsonb_typeof(v_rule->'values') <> 'array' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(v_rule->'values') AS allowed(choice)
      WHERE allowed.choice = v_parent #>> '{}'
    );
  END IF;
  IF jsonb_typeof(v_parent) NOT IN ('string','number','boolean') THEN RETURN false; END IF;
  RETURN v_parent #>> '{}' <> coalesce(v_rule->>'value','');
END $function$;

CREATE OR REPLACE FUNCTION public.feedback_public_get(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target record;
  v_state text;
  c public.feedback_campaigns;
  v_program public.feedback_programs;
  v_recipient_name text;
  v_topic_ar text;
begin
  select * into v_target from private.feedback_token_target(p_token,false) limit 1;
  if v_target.campaign_id is null then
    return jsonb_build_object('state','invalid');
  end if;
  select * into c from public.feedback_campaigns where id=v_target.campaign_id;
  select * into v_program from public.feedback_programs where key=c.program_key;
  v_state:=private.feedback_public_state(c.id,v_target.recipient_id);
  if v_target.recipient_id is not null then
    select display_name into v_recipient_name from public.feedback_recipients where id=v_target.recipient_id;
  end if;
  v_topic_ar:=case v_program.key
    when 'biomimicry' then 'المحاكاة الحيوية – ابتكارات مستوحاة من الطبيعة'
    when 'biomimicry_secondary' then 'المحاكاة الحيوية والاستدامة والابتكار التكنولوجي'
    when 'board_games' then 'تطوير ألعاب الطاولة والاستراتيجيات وتخطيط الألعاب'
    when 'green_leadership' then 'الاستدامة والقيادة البيئية'
    when 'space_tech' then 'تكنولوجيا الفضاء'
    when 'sky_limit' then 'الفضاء والأقمار الصناعية وتكنولوجيا الفضاء'
    when 'ai_applications' then 'تطبيقات الذكاء الاصطناعي'
    when 'ai_foundations' then 'الذكاء الاصطناعي'
    when 'pharma' then 'تطوير الأدوية والصناعة الدوائية'
    when 'ofek' then 'ريادة الأعمال والصناعة'
    when 'trailblazers' then 'ريادة الأعمال والتكنولوجيا'
    else v_program.topic end;
  return jsonb_build_object(
    'state',v_state,'audience',c.audience,'stage',c.stage,
    'age_band',c.age_band,'program_key',c.program_key,'program_title',v_program.title,
    'school_name',c.school_name,'grade',c.grade,
    'recipient_name',coalesce(v_recipient_name,''),
    'expires_at',c.expires_at,
    'intro_text',coalesce((select i.intro_text_he from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage and c.audience='student'),(select intro_text from public.feedback_template_versions where id=c.template_version_id)),
    'intro_text_ar',case when c.audience='student' and exists(select 1 from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage) then (select i.intro_text_ar from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage) when c.program_key='biomimicry' and c.audience='student' then
      (select b.intro_text_ar from private.feedback_biomimicry_approved_intro_ar b where b.stage=c.stage)
      else coalesce(
      (select nullif(intro_text_ar,'') from public.feedback_template_versions where id=c.template_version_id),
      (select m.ar from private.feedback_arabic_translations m
       join public.feedback_template_versions v on v.intro_text=m.he
       where v.id=c.template_version_id and m.kind='intro')) end,
    'questions',case when v_state<>'ok' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',tq.id,
        'type',tq.question_type,
        'text',replace(tq.wording->>'default','{topic}',v_program.topic),
        'text_ar',nullif(replace(
          coalesce((select b.wording_ar from private.feedback_biomimicry_approved_question_ar b
        where c.program_key='biomimicry' and c.audience='student' and b.question_id=tq.question_id),
        nullif(tq.wording->>'ar',''),
            (select m.ar from private.feedback_arabic_translations m
             where m.kind='question' and m.he=tq.wording->>'default'),''),
          '{topic}',v_topic_ar),''),
        'options',case when jsonb_typeof(tq.options)='array' then
          (select coalesce(jsonb_agg(
            case when coalesce(o.elem->>'label_ar','')='' and m.ar is not null
              then jsonb_set(o.elem,'{label_ar}',to_jsonb(m.ar),true)
              else o.elem end order by o.ord),'[]'::jsonb)
           from jsonb_array_elements(tq.options) with ordinality o(elem,ord)
           left join private.feedback_arabic_translations m on m.kind='option' and m.he=o.elem->>'label'
          ) else tq.options end,
        'required',tq.required,
        'section',tq.section,
        'allow_na',(tq.question_type='rating_1_5' and coalesce(tq.scoring->>'allow_na','')='true'),
        'scoring',tq.scoring,
        'visible_when',tq.scoring->'visible_when'
      ) order by tq.sort_order,tq.id)
      from public.feedback_template_questions tq
      where tq.version_id=c.template_version_id
    ),'[]'::jsonb) end
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.feedback_public_submit(p_token text, p_submission_id uuid, p_answers jsonb, p_duration_seconds integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Ignore inactive conditional questions for required validation AND persistence.
    if not private.feedback_question_visible(p_answers, tq.scoring) then continue; end if;
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
      if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > coalesce((tq.scoring->>'max_length')::integer, 2000) then v_invalid := v_invalid || tq.id::text; end if;
    end if;
    -- Snapshot rules apply identically to both languages, before any writes.
    if tq.scoring ? 'other_value' and (
      (jsonb_typeof(v)='string' and v #>> '{}' = tq.scoring->>'other_value') or
      (jsonb_typeof(v)='array' and v ? (tq.scoring->>'other_value'))
    ) then
      if jsonb_typeof(p_answers->(tq.id::text || '__other')) is distinct from 'string'
        or coalesce(btrim(p_answers->>(tq.id::text || '__other')), '') = ''
        or char_length(p_answers->>(tq.id::text || '__other')) > coalesce((tq.scoring->>'other_max_length')::integer,250)
      then v_invalid := v_invalid || tq.id::text; end if;
    end if;
    if tq.question_type='multi_select' and jsonb_typeof(v)='array' then
      if (tq.scoring ? 'exclusive_value' and v ? (tq.scoring->>'exclusive_value') and jsonb_array_length(v)>1)
        or (select count(*) <> count(distinct e) from jsonb_array_elements_text(v) e)
      then v_invalid := v_invalid || tq.id::text; end if;
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
    -- Ignore inactive conditional questions for required validation AND persistence.
    if not private.feedback_question_visible(p_answers, tq.scoring) then continue; end if;
    v := p_answers -> tq.id::text;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '')
       or (jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 0) then
      continue;
    end if;
    v_text := null; v_opts := null;
    if tq.question_type = 'free_text' then v_text := btrim(v #>> '{}'); end if;
    if tq.scoring ? 'other_value' and (
      (jsonb_typeof(v)='string' and v #>> '{}' = tq.scoring->>'other_value') or
      (jsonb_typeof(v)='array' and v ? (tq.scoring->>'other_value'))
    ) then v_text := btrim(p_answers->>(tq.id::text || '__other')); end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.feedback_publish_version(p_version_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.feedback_template_versions;
begin
  select * into v from public.feedback_template_versions where id = p_version_id for update;
  if not found then raise exception 'feedback_version_not_found'; end if;
  if v.status <> 'draft' then raise exception 'feedback_version_not_draft'; end if;
  if not exists (select 1 from public.feedback_template_questions where version_id = v.id) then
    raise exception 'feedback_version_empty';
  end if;
  -- Prevent publishing a broken adaptive questionnaire after manual draft edits.
  if exists (
    select 1 from public.feedback_template_questions child
    cross join lateral jsonb_array_elements(case
      when child.scoring->'visible_when' ? 'any' then child.scoring#>'{visible_when,any}'
      else jsonb_build_array(child.scoring->'visible_when') end) rule
    where child.version_id = v.id and child.scoring ? 'visible_when'
      and (coalesce(rule->>'operator', '') not in ('nonempty','not_equals','in')
        or not exists (
          select 1 from public.feedback_template_questions parent
          where parent.version_id = child.version_id
            and parent.id::text = rule->>'parent_id'
            and parent.sort_order < child.sort_order
        ))
  ) then raise exception 'feedback_invalid_conditional_question'; end if;
  update public.feedback_template_versions set status = 'archived'
  where template_id = v.template_id and status = 'published';
  update public.feedback_template_versions
  set status = 'published', published_at = now(), published_by = auth.uid()
  where id = v.id;
  update public.feedback_templates set current_version_id = v.id, updated_at = now()
  where id = v.template_id;
end $function$;
DO $staff_drafts$
DECLARE
  defs jsonb := $spec$[{"number": 1, "type": "rating_1_5", "wording": {"ar": "العمر", "default": "גיל"}, "options": [], "scoring": {"allow_na": true, "question_number": 1, "rating_scale": "staff_final", "section_title": "האם התוכנית מתאימה לאוכלוסיית היעד בהיבטים של:", "section_title_ar": "هل يتلاءم البرنامج مع الفئة المستهدفة من الجوانب التالية:"}}, {"number": 2, "type": "rating_1_5", "wording": {"ar": "مستوى الصعوبة", "default": "רמת קושי"}, "options": [], "scoring": {"allow_na": true, "question_number": 2, "rating_scale": "staff_final"}}, {"number": 3, "type": "rating_1_5", "wording": {"ar": "الملاءمة الثقافية", "default": "התאמה תרבותית"}, "options": [], "scoring": {"allow_na": true, "question_number": 3, "rating_scale": "staff_final"}}, {"number": 4, "type": "rating_1_5", "wording": {"ar": "إلى أي مدى تقيّم مهنية وخبرة الطاقم الذي ينفّذ البرنامج؟", "default": "באיזו מידה היית מעריך את המקצועיות והמומחיות של הצוות המפעיל את התוכנית?"}, "options": [], "scoring": {"allow_na": true, "question_number": 4, "rating_scale": "staff_final"}}, {"number": 5, "type": "rating_1_5", "wording": {"ar": "إلى أي مدى كانت التكلفة (السعر) الإجمالية للبرنامج مناسبة ومعقولة مقارنةً بالنشاط الذي نُفّذ؟", "default": "באיזו מידה עלות (מחיר) סך התוכנית הייתה תואמת וסבירה ביחס לפעילות שהתקיימה?"}, "options": [], "scoring": {"allow_na": true, "question_number": 5, "rating_scale": "staff_final"}}, {"number": 6, "type": "rating_1_5", "wording": {"ar": "إلى أي مدى يسهم البرنامج في تطوير وإثراء طاقم المؤسسة التربوية المشاركة فيه؟", "default": "באיזו מידה התוכנית מקדמת ומעשירה את צוות המוסד החינוכי השותף לתוכנית?"}, "options": [], "scoring": {"allow_na": true, "question_number": 6, "rating_scale": "staff_final"}}, {"number": 7, "type": "rating_1_5", "wording": {"ar": "بصورة عامة، ما مدى رضاك عن البرنامج؟", "default": "באופן כללי עד כמה הנך שבע רצון מהתוכנית?"}, "options": [], "scoring": {"allow_na": true, "question_number": 7, "rating_scale": "staff_final"}}, {"number": 8, "type": "rating_1_5", "wording": {"ar": "إلى أي مدى توصي مديرين آخرين باختيار البرنامج؟", "default": "באיזו מידה תמליץ למנהלים נוספים לבחור בתוכנית?"}, "options": [], "scoring": {"allow_na": true, "question_number": 8, "rating_scale": "staff_final"}}, {"number": 9, "type": "single_select", "wording": {"ar": "هل تنوي شراء هذا البرنامج أيضًا في السنة القادمة؟", "default": "האם בכוונתך לרכוש תוכנית זו גם בשנה הבאה?"}, "options": [{"label": "כן", "value": "opt_0", "label_ar": "نعم"}, {"label": "לא", "value": "opt_1", "label_ar": "لا"}, {"label": "אולי", "value": "opt_2", "label_ar": "ربما"}], "scoring": {"question_number": 9, "section_title": "רכישה חוזרת, עלות ותועלת", "section_title_ar": "شراء البرنامج مجددًا والتكلفة والمنفعة"}}, {"number": 10, "type": "single_select", "wording": {"ar": "إذا لم تكن تنوي شراء البرنامج مجددًا، يُرجى اختيار السبب الرئيسي لذلك:", "default": "במידה ואין בכוונתך לרכוש שוב, אנא בחר/י את הסיבה המרכזית לכך:"}, "options": [{"label": "התוכנית אינה מתאימה לצורכי בית הספר", "value": "opt_0", "label_ar": "البرنامج غير ملائم لاحتياجات المدرسة"}, {"label": "התכנים אינם מתאימים לרמת התלמידים", "value": "opt_1", "label_ar": "مضامين البرنامج غير ملائمة لمستوى الطلاب"}, {"label": "איכות ההדרכה לא עמדה בציפיות", "value": "opt_2", "label_ar": "جودة الإرشاد لم تلبِّ التوقعات"}, {"label": "התוכנית לא השיגה את מטרותיה", "value": "opt_3", "label_ar": "البرنامج لم يحقق أهدافه"}, {"label": "קשיים בתיאום ובהפעלת התוכנית", "value": "opt_4", "label_ar": "صعوبات في تنسيق البرنامج وتنفيذه"}, {"label": "עלות התוכנית גבוהה ביחס לתועלת", "value": "opt_5", "label_ar": "تكلفة البرنامج مرتفعة مقارنةً بفائدته"}, {"label": "מגבלות תקציביות של בית הספר", "value": "opt_6", "label_ar": "قيود في ميزانية المدرسة"}, {"label": "העדפה לתוכנית אחרת", "value": "opt_7", "label_ar": "تفضيل برنامج آخر"}, {"label": "התוכנית הושלמה ואין צורך בהפעלתה מחדש", "value": "opt_8", "label_ar": "اكتمل البرنامج ولا توجد حاجة لتنفيذه مرة أخرى"}, {"label": "אחר", "value": "opt_9", "label_ar": "أخرى"}], "scoring": {"question_number": 10, "other_value": "opt_9", "other_max_length": 250}}, {"number": 11, "type": "single_select", "wording": {"ar": "برأيك، ما نسبة المنفعة إلى تكلفة البرنامج؟", "default": "להערכתך, מהו היחס בין העלות לתועלת של התוכנית?"}, "options": [{"label": "0", "value": "opt_0", "label_ar": "0"}, {"label": "1", "value": "opt_1", "label_ar": "1"}, {"label": "2", "value": "opt_2", "label_ar": "2"}, {"label": "3", "value": "opt_3", "label_ar": "3"}, {"label": "4", "value": "opt_4", "label_ar": "4"}, {"label": "5", "value": "opt_5", "label_ar": "5"}, {"label": "6", "value": "opt_6", "label_ar": "6"}, {"label": "7", "value": "opt_7", "label_ar": "7"}, {"label": "8", "value": "opt_8", "label_ar": "8"}, {"label": "9", "value": "opt_9", "label_ar": "9"}, {"label": "10", "value": "opt_10", "label_ar": "10"}], "scoring": {"question_number": 11, "scale_endpoints": {"low": "תועלת נמוכה ביחס לעלות", "high": "תועלת גבוהה ביחס לעלות", "low_ar": "منفعة منخفضة مقارنةً بالتكلفة", "high_ar": "منفعة مرتفعة مقارنةً بالتكلفة"}}}, {"number": 12, "type": "free_text", "wording": {"ar": "يمكنك ذكر إيجابيات البرنامج هنا", "default": "באפשרותך לציין כאן את יתרונות התוכנית"}, "options": [], "scoring": {"question_number": 12, "max_length": 250}}, {"number": 13, "type": "free_text", "wording": {"ar": "يمكنك ذكر سلبيات البرنامج و/أو الصعوبات التي واجهتك فيه هنا", "default": "באפשרותך לציין כאן את חסרונות ו/או הקשיים בתוכנית"}, "options": [], "scoring": {"question_number": 13, "max_length": 250}}, {"number": 14, "type": "rating_1_5", "wording": {"ar": "إلى أي مدى حقق البرنامج الأهداف التي اخترته من أجلها؟", "default": "באיזו מידה התוכנית השיגה את המטרות לשמם התוכנית נבחרה על ידך?"}, "options": [], "scoring": {"allow_na": true, "question_number": 14, "rating_scale": "staff_final", "section_title": "השגת מטרות התוכנית", "section_title_ar": "تحقيق أهداف البرنامج"}}, {"number": 15, "type": "rating_1_5", "wording": {"ar": "مضامين البرنامج ومحاوره الرئيسية", "default": "תכני התוכנית ודגשיה"}, "options": [], "scoring": {"allow_na": true, "question_number": 15, "rating_scale": "staff_final", "section_title": "הלימה בין מאפייני התוכנית ליישומה", "section_title_ar": "التطابق بين خصائص البرنامج وتطبيقه", "instruction": "בשאלות הבאות ציין באיזו מידה הייתה הלימה בין המאפיינים המוצהרים של התוכנית (כפי שהוצגו בפנייך במערכת הגפ\"ן ועל ידי מנהלי התוכנית לפני ההחלטה על רכישתה של התוכנית) לבין יישומם בפועל בבית ספרך", "instruction_ar": "في الأسئلة التالية، يُرجى تحديد مدى التطابق بين الخصائص المعلنة للبرنامج (كما عُرضت عليك في منظومة جفِن ومن قِبل المسؤولين عن البرنامج قبل اتخاذ قرار شرائه) وبين تطبيقها الفعلي في مدرستك."}}, {"number": 16, "type": "rating_1_5", "wording": {"ar": "تأهيل أفراد طاقم البرنامج", "default": "ההכשרה של אנשי צוות התוכנית"}, "options": [], "scoring": {"allow_na": true, "question_number": 16, "rating_scale": "staff_final"}}, {"number": 17, "type": "rating_1_5", "wording": {"ar": "الملاءمة لمضامين / أنشطة أخرى في المدرسة", "default": "התאמה לתכנים / פעילויות נוספות בבית הספר"}, "options": [], "scoring": {"allow_na": true, "question_number": 17, "rating_scale": "staff_final"}}, {"number": 18, "type": "rating_1_5", "wording": {"ar": "الملاءمة لاحتياجات الطلاب والطالبات وقدراتهم", "default": "התאמה לצרכים וליכולות של התלמידים והתלמידות"}, "options": [], "scoring": {"allow_na": true, "question_number": 18, "rating_scale": "staff_final"}}, {"number": 19, "type": "rating_1_5", "wording": {"ar": "الملاءمة للمرحلة العمرية التي خُصص لها البرنامج", "default": "התאמה לשלב הגיל לו יועדה התוכנית"}, "options": [], "scoring": {"allow_na": true, "question_number": 19, "rating_scale": "staff_final"}}, {"number": 20, "type": "rating_1_5", "wording": {"ar": "جودة المواد / المضامين", "default": "איכות החומרים / התכנים"}, "options": [], "scoring": {"allow_na": true, "question_number": 20, "rating_scale": "staff_final", "section_title": "הלימה בין המתווה המתוכנן ליישום בפועל", "section_title_ar": "التطابق بين الخطة والتنفيذ الفعلي", "instruction": "בשאלות הבאות אנא ציין באיזו מידה הייתה הלימה בין המתווה המתוכנן של התוכנית לבין יישומו בפועל בבית ספרך", "instruction_ar": "في الأسئلة التالية، يُرجى تحديد مدى التطابق بين الخطة الموضوعة للبرنامج وتنفيذها الفعلي في مدرستك."}}, {"number": 21, "type": "rating_1_5", "wording": {"ar": "جودة الطاقم المنفّذ", "default": "איכות הצוות המפעיל"}, "options": [], "scoring": {"allow_na": true, "question_number": 21, "rating_scale": "staff_final"}}, {"number": 22, "type": "rating_1_5", "wording": {"ar": "الموارد المخصصة لتأهيل الطاقم المدرسي", "default": "תשומות להכשרת הצוות הבית ספרי"}, "options": [], "scoring": {"allow_na": true, "question_number": 22, "rating_scale": "staff_final"}}, {"number": 23, "type": "rating_1_5", "wording": {"ar": "نُفّذ البرنامج بانتظام على مدار السنة", "default": "התוכנית יושמה בעקביות במהלך השנה"}, "options": [], "scoring": {"allow_na": true, "question_number": 23, "rating_scale": "staff_final", "section_title": "תפעול התוכנית", "section_title_ar": "تنفيذ البرنامج", "instruction": "בשאלות הבאות אנא ציין באיזו מידה התקיימו ההיבטים השונים בתפעול התוכנית", "instruction_ar": "في الأسئلة التالية، يُرجى تحديد مدى تحقق الجوانب المختلفة المتعلقة بتنفيذ البرنامج."}}, {"number": 24, "type": "rating_1_5", "wording": {"ar": "توفرت مرونة في تنفيذ البرنامج بما يتلاءم مع احتياجات المدرسة", "default": "הייתה גמישות בהפעלת התוכנית בהתאם לצרכיי בית הספר"}, "options": [], "scoring": {"allow_na": true, "question_number": 24, "rating_scale": "staff_final"}}, {"number": 25, "type": "rating_1_5", "wording": {"ar": "جرى إبلاغ الطاقم التربوي المسؤول بصورة منتظمة، وكان هناك تعاون بنّاء معه", "default": "התקיים דיווח שוטף ושיתוף פעולה מקדם עם הצוות החינוכי המפעיל"}, "options": [], "scoring": {"allow_na": true, "question_number": 25, "rating_scale": "staff_final"}}, {"number": 26, "type": "free_text", "wording": {"ar": "إذا لم يُنفّذ البرنامج بانتظام ومرونة مع إبلاغ مستمر، يُرجى توضيح الأسباب", "default": "במידה ולא יושמה בעקביות, בגמישות ותוך דיווח שוטף אנא פרט/י את הסיבות לכך"}, "options": [], "scoring": {"question_number": 26, "max_length": 250}}, {"number": 27, "type": "single_select", "wording": {"ar": "هل كانت للبرنامج تأثيرات غير متوقعة؟", "default": "האם היו לתוכנית השפעות לא צפויות?"}, "options": [{"label": "כן", "value": "opt_0", "label_ar": "نعم"}, {"label": "לא", "value": "opt_1", "label_ar": "لا"}, {"label": "אולי", "value": "opt_2", "label_ar": "ربما"}], "scoring": {"question_number": 27, "section_title": "השפעות התוכנית", "section_title_ar": "تأثيرات البرنامج"}}, {"number": 28, "type": "free_text", "wording": {"ar": "إذا أجبت بنعم أو ربما (بشأن التأثيرات غير المتوقعة للبرنامج)، يُرجى التوضيح", "default": "במידה וענית כן או אולי (לתוכנית השפעות לא צפויות), אנא פרט/י"}, "options": [], "scoring": {"question_number": 28}}, {"number": 29, "type": "single_select", "wording": {"ar": "كيف تقيّم تأثير البرنامج مقارنةً بالأهداف التي حددتها له؟", "default": "כיצד היית מעריכ/ה את השפעת על התוכנית ביחס למטרות שהצבת לה?"}, "options": [{"label": "0", "value": "opt_0", "label_ar": "0"}, {"label": "1", "value": "opt_1", "label_ar": "1"}, {"label": "2", "value": "opt_2", "label_ar": "2"}, {"label": "3", "value": "opt_3", "label_ar": "3"}, {"label": "4", "value": "opt_4", "label_ar": "4"}, {"label": "5", "value": "opt_5", "label_ar": "5"}, {"label": "6", "value": "opt_6", "label_ar": "6"}, {"label": "7", "value": "opt_7", "label_ar": "7"}, {"label": "8", "value": "opt_8", "label_ar": "8"}, {"label": "9", "value": "opt_9", "label_ar": "9"}, {"label": "10", "value": "opt_10", "label_ar": "10"}], "scoring": {"question_number": 29, "scale_endpoints": {"low": "השפעה שלילית", "high": "השפעה חיובית", "low_ar": "تأثير سلبي", "high_ar": "تأثير إيجابي"}}}, {"number": 30, "type": "multi_select", "wording": {"ar": "ما أنواع الأدلة (الكمية أو غيرها) التي تستند إليها في هذا التقييم؟", "default": "אילו סוגי עדויות (כמותיות או אחרות) יש להערכה זו שלך?"}, "options": [{"label": "הישגי תלמידים ותוצאות הערכה", "value": "opt_0", "label_ar": "تحصيل الطلاب ونتائج التقييم"}, {"label": "תוצרים ועבודות של תלמידים", "value": "opt_1", "label_ar": "منتجات الطلاب وأعمالهم"}, {"label": "נתוני השתתפות ונוכחות", "value": "opt_2", "label_ar": "بيانات المشاركة والحضور"}, {"label": "תצפיות במהלך המפגשים", "value": "opt_3", "label_ar": "ملاحظات ومشاهدات أثناء اللقاءات"}, {"label": "משובים של תלמידים", "value": "opt_4", "label_ar": "آراء الطلاب وتقييماتهم"}, {"label": "משובים של מורים וצוות חינוכי", "value": "opt_5", "label_ar": "آراء المعلمين والطاقم التربوي"}, {"label": "שינוי במוטיבציה ובמעורבות התלמידים", "value": "opt_6", "label_ar": "تغيّر دافعية الطلاب ومشاركتهم"}, {"label": "יישום ידע ומיומנויות שנרכשו", "value": "opt_7", "label_ar": "تطبيق المعرفة والمهارات المكتسبة"}, {"label": "לא נאספו עדויות", "value": "opt_8", "label_ar": "لم تُجمع أدلة"}, {"label": "אחר", "value": "opt_9", "label_ar": "أخرى"}], "scoring": {"question_number": 30, "other_value": "opt_9", "other_max_length": 250, "exclusive_value": "opt_8"}}, {"number": 31, "type": "free_text", "wording": {"ar": "هل ترغب في إضافة تفاصيل؟", "default": "היית רוצה להרחיב?"}, "options": [], "scoring": {"question_number": 31, "empty_detail_text": "אפשר להשיב: אין מה להוסיף", "empty_detail_text_ar": "يمكن الإجابة: لا توجد تفاصيل إضافية"}}, {"number": 32, "type": "free_text", "wording": {"ar": "ما أبرز إنجاز أو تغيير لاحظته لدى الطلاب خلال البرنامج؟", "default": "מהו ההישג או השינוי המשמעותי ביותר שראית אצל התלמידים במהלך התוכנית?"}, "options": [], "scoring": {"question_number": 32, "section_title": "שתי שאלות פתוחות משלימות של תעשיידע", "section_title_ar": "سؤالان مفتوحان إضافيان من تاعسييداع"}}, {"number": 33, "type": "free_text", "wording": {"ar": "ما الذي ترى أنه من المهم الحفاظ عليه، وما الذي ينبغي تحسينه عند تنفيذ البرنامج مرة أخرى؟", "default": "מה לדעתך חשוב לשמר ומה כדאי לשפר בהפעלה הבאה של התוכנית?"}, "options": [], "scoring": {"question_number": 33}}]$spec$::jsonb;
  ver record;
  item jsonb;
  ids jsonb;
  rules jsonb;
  ordinal integer;
BEGIN
  IF (select count(*) from public.feedback_template_versions v join public.feedback_templates t on t.id=v.template_id
    where v.notes='Approved Hebrew final 2026; pending Arabic and conditional UI' and v.status='draft'
      and t.audience='educational_staff' and t.stage='final') <> 11 THEN
    RAISE EXCEPTION 'staff_final_expected_11_existing_drafts';
  END IF;
  FOR ver IN select v.id from public.feedback_template_versions v join public.feedback_templates t on t.id=v.template_id
    where v.notes='Approved Hebrew final 2026; pending Arabic and conditional UI' and v.status='draft'
      and t.audience='educational_staff' and t.stage='final'
  LOOP
    IF (select count(*) from public.feedback_template_questions where version_id=ver.id) <> 33
       OR exists(select 1 from public.feedback_responses where template_version_id=ver.id) THEN
      RAISE EXCEPTION 'staff_final_draft_shape_or_usage_changed';
    END IF;
    select jsonb_object_agg((sort_order/10)::text,id::text) into ids
      from public.feedback_template_questions where version_id=ver.id;
    FOR item IN select value from jsonb_array_elements(defs) LOOP
      ordinal := (item->>'number')::integer;
      IF NOT exists(select 1 from public.feedback_template_questions q where q.version_id=ver.id
        and q.sort_order=ordinal*10 and q.wording->>'default'=item#>>'{wording,default}'
        and q.question_type=item->>'type') THEN RAISE EXCEPTION 'staff_final_approved_hebrew_changed_%',ordinal; END IF;
      rules := item->'scoring';
      IF ordinal=10 THEN rules := rules || jsonb_build_object('visible_when',jsonb_build_object('parent_id',ids->>'9','operator','in','values',jsonb_build_array('opt_1','opt_2'))); END IF;
      IF ordinal=28 THEN rules := rules || jsonb_build_object('visible_when',jsonb_build_object('parent_id',ids->>'27','operator','in','values',jsonb_build_array('opt_0','opt_2'))); END IF;
      IF ordinal=26 THEN rules := rules || jsonb_build_object('visible_when',jsonb_build_object('any',
        (select jsonb_agg(jsonb_build_object('parent_id',ids->>n::text,'operator','in','values',jsonb_build_array('1','2'))) from generate_series(23,25) n))); END IF;
      update public.feedback_template_questions set required=true,scoring=rules,wording=item->'wording',options=item->'options'
        where version_id=ver.id and sort_order=ordinal*10;
    END LOOP;
  END LOOP;
END $staff_drafts$;
NOTIFY pgrst, 'reload schema';

-- Conditional instructor follow-up questions. All published questionnaires remain untouched.

CREATE OR REPLACE FUNCTION private.feedback_question_visible(p_answers jsonb, p_scoring jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $condition$
DECLARE
  v_rule jsonb := p_scoring->'visible_when';
  v_parent jsonb;
  v_id text;
  v_operator text;
BEGIN
  IF v_rule IS NULL OR v_rule = 'null'::jsonb THEN RETURN true; END IF;
  IF jsonb_typeof(v_rule) <> 'object' THEN RETURN false; END IF;
  v_id := v_rule->>'parent_id';
  v_operator := v_rule->>'operator';
  IF coalesce(v_id,'') = '' OR coalesce(v_operator,'') NOT IN ('nonempty','not_equals') THEN RETURN false; END IF;
  v_parent := p_answers -> v_id;
  IF v_parent IS NULL OR v_parent = 'null'::jsonb THEN RETURN false; END IF;
  IF v_operator = 'nonempty' THEN
    IF jsonb_typeof(v_parent) = 'array' THEN RETURN jsonb_array_length(v_parent) > 0; END IF;
    IF jsonb_typeof(v_parent) = 'string' THEN RETURN length(btrim(v_parent #>> '{}')) > 0; END IF;
    RETURN false;
  END IF;
  IF jsonb_typeof(v_parent) NOT IN ('string','number','boolean') THEN RETURN false; END IF;
  RETURN v_parent #>> '{}' <> coalesce(v_rule->>'value','');
END $condition$;
REVOKE ALL ON FUNCTION private.feedback_question_visible(jsonb,jsonb) FROM PUBLIC;


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
        'visible_when',tq.scoring->'visible_when'
      ) order by tq.sort_order,tq.id)
      from public.feedback_template_questions tq
      where tq.version_id=c.template_version_id
    ),'[]'::jsonb) end
  );
end
$function$
;

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
    -- Ignore inactive conditional questions for required validation AND persistence.
    if not private.feedback_question_visible(p_answers, tq.scoring) then continue; end if;
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
end $function$
;

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
    where child.version_id = v.id and child.scoring ? 'visible_when'
      and (coalesce(child.scoring #>> '{visible_when,operator}', '') not in ('nonempty','not_equals')
        or not exists (
          select 1 from public.feedback_template_questions parent
          where parent.version_id = child.version_id
            and parent.id::text = child.scoring #>> '{visible_when,parent_id}'
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
end $function$
;

DO $adaptive_seed$
DECLARE
  v_defs jsonb := $payload$[{"suffix":"time_detail","parent":"content_load","sort":75,"section":"core","metric":"content","required":false,"op":"not_equals","value":"v1","he":"באילו מפגשים הרגשת שהזמן שהוקצה לתוכן אינו מתאים? מה היית משנה בחלוקת הזמן? (רשות)","ar":"في أي لقاءات شعرت أن الوقت المخصص للمحتوى غير مناسب؟ ماذا تقترح تغييره في توزيع الوقت؟ (اختياري)"},{"suffix":"content_detail","parent":"content_improvements","sort":95,"section":"core","metric":"content","required":true,"op":"nonempty","he":"לאיזה מפגש או נושא מתייחסים השיפורים שסימנת? מה בדיוק היית ממליץ/ה לתקן, לעדכן, להוסיף או להסיר?","ar":"إلى أي لقاء أو موضوع تتعلق التحسينات التي اخترتها؟ ما الذي تقترح تصحيحه أو تحديثه أو إضافته أو حذفه تحديدًا؟"},{"suffix":"slides_detail","parent":"slides_improvements","sort":145,"section":"core","metric":"content","required":true,"op":"nonempty","he":"באיזו מצגת או שקופית נדרש השינוי? מה הבעיה שזיהית ומה היית ממליץ/ה לעשות אחרת?","ar":"في أي عرض أو شريحة يلزم التغيير؟ ما المشكلة التي لاحظتها وما الذي تقترح فعله بشكل مختلف؟"},{"suffix":"activities_detail","parent":"activities_problems","sort":205,"section":"core","metric":"delivery","required":true,"op":"nonempty","he":"באיזו פעילות או מפגש נתקלת בקושי שסימנת? מה קרה בפועל ומה היית מציע/ה לשנות?","ar":"في أي نشاط أو لقاء واجهت الصعوبة التي اخترتها؟ ماذا حدث فعليًا وما الذي تقترح تغييره؟"},{"suffix":"course_detail","parent":"__COURSE___components","sort":275,"section":"course","metric":"content","required":false,"op":"nonempty","he":"באילו מפגשים נמצאים המרכיבים שסימנת? מה לדעתך לא עבד וכיצד היית משפר/ת אותם? (רשות)","ar":"في أي لقاءات توجد المكوّنات التي حددتها؟ ما الذي لم ينجح برأيك وكيف تقترح تحسينه؟ (اختياري)"}]$payload$::jsonb;
  v_template record;
  v_def jsonb;
  v_parent_key text;
  v_qkey text;
  v_parent_id uuid;
  v_question_id uuid;
  v_sco jsonb;
  v_added integer;
BEGIN
  IF (SELECT count(*) FROM public.feedback_templates t
      JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
      JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
      WHERE t.audience='instructor' AND t.stage='final') <> 10 THEN
    RAISE EXCEPTION 'Expected exactly ten instructor-final drafts';
  END IF;
  FOR v_template IN
    SELECT t.program_key,v.id AS version_id
    FROM public.feedback_templates t
    JOIN public.feedback_template_versions v ON v.template_id=t.id AND v.status='draft'
    JOIN public.feedback_programs p ON p.key=t.program_key AND p.is_active
    WHERE t.audience='instructor' AND t.stage='final'
  LOOP
    IF (SELECT count(*) FROM public.feedback_template_questions WHERE version_id=v_template.version_id) <> 30 THEN
      RAISE EXCEPTION 'Draft has unexpected source question count: %', v_template.program_key;
    END IF;
    v_added := 0;
    FOR v_def IN SELECT value FROM jsonb_array_elements(v_defs) LOOP
      v_parent_key := 'in_final_20261013_' || replace(v_def->>'parent','__COURSE__',v_template.program_key);
      SELECT tq.id INTO v_parent_id
      FROM public.feedback_template_questions tq
      JOIN public.feedback_questions bq ON bq.id=tq.question_id
      WHERE tq.version_id=v_template.version_id AND bq.question_key=v_parent_key;
      IF v_parent_id IS NULL THEN RAISE EXCEPTION 'Missing parent %',v_parent_key; END IF;
      v_qkey := 'in_final_followup_20261013_' || (CASE WHEN v_def->>'section'='course' THEN v_template.program_key||'_' ELSE '' END)
         || (v_def->>'suffix');
      v_sco := jsonb_build_object('include_in_score',false,'visible_when',
         jsonb_build_object('parent_id',v_parent_id::text,'operator',v_def->>'op'));
      IF v_def ? 'value' THEN
        v_sco := jsonb_set(v_sco,'{visible_when,value}',to_jsonb(v_def->>'value'));
      END IF;
      INSERT INTO public.feedback_questions (
        question_key,program_key,metric_key,question_type,audiences,stages,
        is_comparison,wording,options,scoring,default_required,sort_order
      )
      VALUES(v_qkey,CASE WHEN v_def->>'section'='course' THEN v_template.program_key ELSE NULL END,
        v_def->>'metric','free_text',ARRAY['instructor']::text[],ARRAY['final']::text[],
        false,jsonb_build_object('default',v_def->>'he','ar',v_def->>'ar'),
        '[]'::jsonb,jsonb_build_object('include_in_score',false),
        (v_def->>'required')::boolean,(v_def->>'sort')::integer)
      ON CONFLICT (question_key) DO NOTHING;
      SELECT id INTO STRICT v_question_id FROM public.feedback_questions WHERE question_key=v_qkey;
      INSERT INTO public.feedback_template_questions (
        version_id,question_id,section,sort_order,required,metric_key,question_type,
        is_comparison,wording,options,scoring
      ) VALUES(v_template.version_id,v_question_id,v_def->>'section',(v_def->>'sort')::integer,
        (v_def->>'required')::boolean,v_def->>'metric','free_text',false,
        jsonb_build_object('default',v_def->>'he','ar',v_def->>'ar'),
        '[]'::jsonb,v_sco);
      v_added := v_added + 1;
    END LOOP;
    IF v_added <> 5 OR (SELECT count(*) FROM public.feedback_template_questions WHERE version_id=v_template.version_id) <> 35 THEN
      RAISE EXCEPTION 'Adaptive follow-up count mismatch for %',v_template.program_key;
    END IF;
  END LOOP;
END $adaptive_seed$;

NOTIFY pgrst, 'reload schema';
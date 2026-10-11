-- Approved DOCX sources: biomimicry elementary student Arabic pre (8 ratings)
-- and post (10 ratings + 2 optional free-text questions).
-- Reuse Hebrew wording, shared question IDs, scale scoring and submitted answers.
-- Existing campaign snapshots stay intact; only the Arabic public presentation
-- is localized to the approved copy by matching stable question_id.
create table if not exists private.feedback_biomimicry_approved_question_ar (
  question_id uuid primary key,
  wording_ar text not null check(btrim(wording_ar)<>'')
);
create table if not exists private.feedback_biomimicry_approved_intro_ar (
  stage text primary key check(stage in ('pre','post')),
  intro_text_ar text not null check(btrim(intro_text_ar)<>'')
);
revoke all on private.feedback_biomimicry_approved_question_ar from PUBLIC, anon, authenticated;
revoke all on private.feedback_biomimicry_approved_intro_ar from PUBLIC, anon, authenticated;

create temporary table biomimicry_docx_question_map (
  position integer primary key,
  approved_ar text not null
) on commit drop;
insert into biomimicry_docx_question_map(position,approved_ar) values
(1,'يهمّني أن أكتشف أشياء جديدة عن الطبيعة.'),
(2,'عندما أرى شيئًا مثيرًا للاهتمام في الطبيعة، أريد أن أفهم كيف يعمل.'),
(3,'أنتبه إلى تفاصيل مميّزة في النباتات والحيوانات.'),
(4,'أستطيع أن أشرح كيف تساعد صفة معيّنة حيوانًا على العيش في الطبيعة.'),
(5,'أستطيع أن أفكّر في أفكار جديدة مستوحاة من الطبيعة.'),
(6,'عندما تكون هناك مشكلة، أحاول التفكير في أكثر من حلّ واحد.'),
(7,'أستطيع أن أعمل مع أصدقائي لإيجاد حلّ لمشكلة.'),
(8,'أشعر بالثقة عندما أقدّم فكرة من أفكاري أمام الآخرين.'),
(9,'كانت الأنشطة في الدورة ممتعة ومثيرة للاهتمام.'),
(10,'خلال الدورة، أتيحت لي فرصة لاقتراح أفكار من عندي.'),
(11,'أيّ نشاط في الدورة أحببت أكثر؟'),
(12,'ما الذي تودّ تغييره أو إضافته في الدورة؟');
insert into private.feedback_biomimicry_approved_intro_ar (stage,intro_text_ar) values
('pre','هل فكّرتم يومًا ماذا يمكننا أن نتعلّم من الطبيعة من حولنا؟
خلال الدورة، سنستكشف العالم من حولنا، ونكتشف حلولًا مدهشة موجودة في الطبيعة، ونتعلّم كيف نستمدّ منها الإلهام لأفكار جديدة.
قبل أن نبدأ، نودّ أن نعرف ما الذي يثير فضولكم، وكيف تفكّرون، وكيف تتعاملون مع التحديات.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('post','خلال الدورة، استكشفنا الطبيعة وتعلّمنا كيف نستمدّ منها الإلهام لأفكار جديدة.
نودّ أن نعرف ما رأيكم وكيف كانت تجربتكم.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.')
on conflict(stage) do update set intro_text_ar=excluded.intro_text_ar;

-- Both approved documents share exactly the first eight question concepts.
do $validate_document_structure$
declare n integer; common_n integer;
begin
 select count(*) into n
 from public.feedback_templates t
 join public.feedback_template_questions q on q.version_id=t.current_version_id
 where t.program_key='biomimicry' and t.audience='student'
   and ((t.stage='pre' and q.question_type='rating_1_5') or (t.stage='post' and q.question_type in ('rating_1_5','free_text')));
 if n<>20 then raise exception 'biomimicry_docx_question_count_mismatch: %',n; end if;
 if (select count(*) from public.feedback_templates where program_key='biomimicry' and audience='student')<>2
    then raise exception 'biomimicry_docx_expected_two_templates'; end if;
 if exists(
    select 1 from public.feedback_templates t
    join public.feedback_template_questions q on q.version_id=t.current_version_id
    where t.program_key='biomimicry' and t.audience='student'
      and ((t.stage='pre' and (q.sort_order>80 or q.question_type<>'rating_1_5' or not q.required))
        or (t.stage='post' and ((q.sort_order<=100 and (q.question_type<>'rating_1_5' or not q.required))
          or (q.sort_order>100 and (q.question_type<>'free_text' or q.required)))))
 ) then raise exception 'biomimicry_docx_question_structure_mismatch'; end if;
 select count(*) into common_n
 from public.feedback_templates t1
 join public.feedback_template_questions q1 on q1.version_id=t1.current_version_id
 join public.feedback_templates t2 on t2.program_key=t1.program_key and t2.audience=t1.audience and t2.stage='post'
 join public.feedback_template_questions q2 on q2.version_id=t2.current_version_id
   and q2.sort_order=q1.sort_order and q2.question_id=q1.question_id
 where t1.program_key='biomimicry' and t1.audience='student' and t1.stage='pre';
 if common_n<>8 then raise exception 'biomimicry_docx_comparison_id_mismatch: %',common_n; end if;
end $validate_document_structure$;

insert into private.feedback_biomimicry_approved_question_ar (question_id,wording_ar)
select distinct q.question_id,m.approved_ar
from public.feedback_templates t
join public.feedback_template_questions q on q.version_id=t.current_version_id
join biomimicry_docx_question_map m on m.position=q.sort_order / 10
where t.program_key='biomimicry' and t.audience='student'
on conflict(question_id) do update set wording_ar=excluded.wording_ar;

-- Keep the reusable question bank aligned with the approved terminology.
update public.feedback_questions q
set wording=jsonb_set(q.wording,'{ar}',to_jsonb(m.wording_ar),true)
from private.feedback_biomimicry_approved_question_ar m
where q.id=m.question_id and q.wording->>'ar' is distinct from m.wording_ar;

-- Only create drafts where the currently published template differs from DOCX.
create temporary table biomimicry_docx_targets (
  template_id uuid primary key,
  stage text not null
) on commit drop;
insert into biomimicry_docx_targets(template_id,stage)
select t.id,t.stage
from public.feedback_templates t
join public.feedback_template_versions v on v.id=t.current_version_id
join private.feedback_biomimicry_approved_intro_ar a on a.stage=t.stage
where t.program_key='biomimicry' and t.audience='student'
  and (v.intro_text_ar is distinct from a.intro_text_ar
       or exists(select 1 from public.feedback_template_questions q
                 join private.feedback_biomimicry_approved_question_ar m on m.question_id=q.question_id
                 where q.version_id=t.current_version_id
                   and q.wording->>'ar' is distinct from m.wording_ar));

insert into public.feedback_template_versions (
  template_id,version_no,status,intro_text,intro_text_ar,notes
)
select t.id,(select coalesce(max(x.version_no),0)+1 from public.feedback_template_versions x where x.template_id=t.id),
'draft',v.intro_text,a.intro_text_ar,'נוסח ערבי מאושר לפי מסמכי פתיחה וסיום'
from public.feedback_templates t
join biomimicry_docx_targets target on target.template_id=t.id
join public.feedback_template_versions v on v.id=t.current_version_id
join private.feedback_biomimicry_approved_intro_ar a on a.stage=t.stage
where not exists(select 1 from public.feedback_template_versions d where d.template_id=t.id and d.status='draft');

insert into public.feedback_template_questions (
  version_id,question_id,section,sort_order,required,metric_key,question_type,
  is_comparison,wording,options,scoring
)
select d.id,q.question_id,q.section,q.sort_order,q.required,q.metric_key,q.question_type,
 q.is_comparison,q.wording,q.options,q.scoring
from public.feedback_templates t
join biomimicry_docx_targets target on target.template_id=t.id
join public.feedback_template_versions d on d.template_id=t.id and d.status='draft'
join public.feedback_template_questions q on q.version_id=t.current_version_id
where not exists(select 1 from public.feedback_template_questions existing where existing.version_id=d.id and existing.question_id=q.question_id);

update public.feedback_template_questions q
set wording=jsonb_set(q.wording,'{ar}',to_jsonb(m.wording_ar),true)
from private.feedback_biomimicry_approved_question_ar m, public.feedback_template_versions v
where q.version_id=v.id and v.status='draft'
and v.template_id in (select template_id from biomimicry_docx_targets)
and q.question_id=m.question_id
and q.wording->>'ar' is distinct from m.wording_ar;

update public.feedback_template_versions v
set intro_text_ar=a.intro_text_ar
from private.feedback_biomimicry_approved_intro_ar a, biomimicry_docx_targets target
where v.template_id=target.template_id and v.status='draft' and a.stage=target.stage
and v.intro_text_ar is distinct from a.intro_text_ar;

do $validate_before_publish$
declare n integer;
begin
 select count(*) into n
 from public.feedback_template_questions q
 join public.feedback_template_versions v on v.id=q.version_id
 join biomimicry_docx_targets t on t.template_id=v.template_id
 join private.feedback_biomimicry_approved_question_ar a on a.question_id=q.question_id
 where v.status='draft' and q.wording->>'ar'=a.wording_ar;
 if n<>(select coalesce(sum(case stage when 'pre' then 8 else 12 end),0) from biomimicry_docx_targets)
 then raise exception 'biomimicry_docx_translation_validation_failed: %',n; end if;
end $validate_before_publish$;

-- Keep existing invitations on historical versions to preserve response IDs.
do $publish_approved$
declare r record;
begin
 for r in select v.id from public.feedback_template_versions v
   join biomimicry_docx_targets t on t.template_id=v.template_id
   where v.status='draft'
 loop
   perform private.feedback_publish_version(r.id);
 end loop;
end $publish_approved$;

-- Public links already issued may use archived version snapshots. Override
-- only biomimicry student Arabic presentation, never Hebrew or response keys.
do $adjust_public_feedback$
declare original_def text; adjusted_def text;
begin
 select pg_get_functiondef(p.oid) into original_def
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='feedback_public_get';
 if original_def is null then raise exception 'feedback_public_get_missing'; end if;
 adjusted_def:=original_def;
 if position('''program_key'',c.program_key' in adjusted_def)=0 then
   if position('''age_band'',c.age_band,' in adjusted_def)=0 then
     raise exception 'unexpected_feedback_public_get_program_key_shape';
   end if;
   adjusted_def:=replace(adjusted_def,'''age_band'',c.age_band,',
    '''age_band'',c.age_band,''program_key'',c.program_key,');
 end if;
 if position('private.feedback_biomimicry_approved_intro_ar' in adjusted_def)=0 then
   if position('''intro_text_ar'',coalesce(' in adjusted_def)=0 or
      position('where v.id=c.template_version_id and m.kind=''intro''))' in adjusted_def)=0 then
     raise exception 'unexpected_feedback_public_get_intro_shape';
   end if;
   adjusted_def:=replace(adjusted_def,'''intro_text_ar'',coalesce(',
      '''intro_text_ar'',case when c.program_key=''biomimicry'' and c.audience=''student'' then
      (select b.intro_text_ar from private.feedback_biomimicry_approved_intro_ar b where b.stage=c.stage)
      else coalesce(');
   adjusted_def:=replace(adjusted_def,
      'where v.id=c.template_version_id and m.kind=''intro''))',
      'where v.id=c.template_version_id and m.kind=''intro'')) end');
 end if;
 if position('private.feedback_biomimicry_approved_question_ar' in adjusted_def)=0 then
   if position('coalesce(nullif(tq.wording->>''ar'',''''),' in adjusted_def)=0 then
     raise exception 'unexpected_feedback_public_get_question_shape';
   end if;
   adjusted_def:=replace(adjusted_def,
      'coalesce(nullif(tq.wording->>''ar'',''''),',
      'coalesce((select b.wording_ar from private.feedback_biomimicry_approved_question_ar b
        where c.program_key=''biomimicry'' and c.audience=''student'' and b.question_id=tq.question_id),
        nullif(tq.wording->>''ar'',''''),');
 end if;
 if adjusted_def<>original_def then execute adjusted_def; end if;
end $adjust_public_feedback$;

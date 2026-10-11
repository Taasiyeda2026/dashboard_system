-- Age-appropriate student intros based on attached syllabi: D-V green/space, Z-Y trailblazers/pharma/ofek.
-- Do not alter question IDs, choices, metric keys, scoring, or submitted answers.
create table if not exists private.feedback_student_syllabus_intros(
  program_key text not null,
  stage text not null check(stage in ('pre','post')),
  intro_text_he text not null check(btrim(intro_text_he)<>''),
  intro_text_ar text not null check(btrim(intro_text_ar)<>''),
  primary key(program_key,stage)
);
revoke all on private.feedback_student_syllabus_intros from PUBLIC,anon,authenticated;
insert into private.feedback_student_syllabus_intros(program_key,stage,intro_text_he,intro_text_ar) values
('green_leadership','pre','האם שמתם לב לדברים בסביבה שלכם שהייתם רוצים לשנות?
במהלך תוכנית מנהיגות ירוקה נחקור את הסביבה הקרובה, נלמד על משאבים ועל אחריות סביבתית, ונפתח רעיונות שאפשר ליישם בבית הספר ובקהילה.
לפני שנתחיל, נשמח לדעת מה מסקרן אתכם, מה אתם כבר יודעים ואיך אתם ניגשים לבעיות סביבתיות.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','هل لاحظتم أشياء في بيئتكم المحيطة تودّون تغييرها؟
خلال برنامج القيادة الخضراء، سنستكشف بيئتنا القريبة، ونتعرّف إلى الموارد والمسؤولية البيئية، ونطوّر أفكارًا يمكن تطبيقها في المدرسة والمجتمع.
قبل أن نبدأ، نودّ أن نعرف ما الذي يثير فضولكم، وما تعرفونه، وكيف تتعاملون مع المشكلات البيئية.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('green_leadership','post','במהלך תוכנית מנהיגות ירוקה חקרנו את הסביבה הקרובה, למדנו לזהות בעיות סביבתיות ופיתחנו רעיונות לשיפור בבית הספר ובקהילה.
נשמח לשמוע מה אתם חושבים עכשיו, אילו פעילויות היו משמעותיות עבורכם ומה אפשר לשפר בתוכנית.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','خلال برنامج القيادة الخضراء، استكشفنا بيئتنا القريبة، وتعلّمنا تحديد المشكلات البيئية، وطوّرنا أفكارًا لتحسين المدرسة والمجتمع.
نودّ أن نعرف ما رأيكم الآن، وما الأنشطة التي كانت مهمّة بالنسبة إليكم، وما الذي يمكن تحسينه في البرنامج.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('space_tech','pre','האם תהיתם פעם איך אפשר לחיות בחלל ומה אפשר ללמוד מהטכנולוגיות שפותחו עבורו?
במהלך קורס טכנולוגיות החלל נכיר את תנאי החיים בחלל, נחקור אתגרים ונגלה כיצד מדע וטכנולוגיה עוזרים למצוא להם פתרונות.
לפני שנתחיל, נשמח לדעת מה מסקרן אתכם בעולם החלל, מה אתם כבר מכירים ואיך אתם חושבים על רעיונות חדשים.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','هل تساءلتم يومًا كيف يمكن للإنسان أن يعيش في الفضاء، وماذا نتعلّم من التقنيات التي طُوّرت من أجله؟
خلال دورة تكنولوجيا الفضاء، سنتعرّف إلى ظروف الحياة في الفضاء، ونستكشف التحدّيات، ونكتشف كيف يساعد العلم والتكنولوجيا في إيجاد حلول لها.
قبل أن نبدأ، نودّ أن نعرف ما الذي يثير فضولكم في عالم الفضاء، وما تعرفونه عنه، وكيف تفكّرون في أفكار جديدة.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('space_tech','post','במהלך קורס טכנולוגיות החלל למדנו על תנאי החיים בחלל, חקרנו אתגרים ותכננו רעיונות לפתרונות בעזרת מדע וטכנולוגיה.
נשמח לשמוע איך הייתה החוויה שלכם, מה עניין אתכם במיוחד ומה אפשר לשפר בקורס.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','خلال دورة تكنولوجيا الفضاء، تعلّمنا عن ظروف الحياة في الفضاء، وبحثنا في التحدّيات، وخطّطنا لأفكار تساعد على حلّها بالعلم والتكنولوجيا.
نودّ أن نعرف كيف كانت تجربتكم، وما الذي أثار اهتمامكم أكثر، وما الذي يمكن تحسينه في الدورة.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('trailblazers','pre','האם חשבתן פעם איך רעיון שלכן יכול להפוך ליוזמה שמחוללת שינוי?
בתוכנית פורצות דרך נכיר נשים שפעלו לשינוי במדע ובטכנולוגיה, נזהה אתגרים מהחיים ונלמד לפתח רעיונות, לעבוד בצוות ולהציג פתרונות.
לפני שנתחיל, נשמח לשמוע מה מסקרן אתכן, איך אתן רואות את היכולות שלכן ועד כמה נוח לכן להשמיע רעיון בפני אחרות.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתן באמת חושבות ומרגישות.','هل فكّرتنّ يومًا كيف يمكن لفكرة من أفكاركنّ أن تتحوّل إلى مبادرة تصنع تغييرًا؟
في برنامج رائدات الطريق، سنتعرّف إلى نساء أحدثن تغييرًا في العلوم والتكنولوجيا، ونحدّد تحدّيات من حياتنا، ونتعلّم تطوير الأفكار والعمل ضمن فريق وعرض الحلول.
قبل أن نبدأ، نودّ أن نعرف ما الذي يثير فضولكنّ، وكيف تنظرن إلى قدراتكنّ، ومدى ارتياحكنّ للتعبير عن أفكاركنّ أمام الأخريات.
لا توجد إجابات صحيحة أو خاطئة. أجبن بحسب ما تفكّرن وتشعرن به فعلًا.'),
('trailblazers','post','במהלך תוכנית פורצות דרך הכרנו נשים פורצות דרך, זיהינו אתגרים, פיתחנו רעיונות בצוותים והתנסינו בהצגת פתרונות.
נשמח לשמוע מה למדתן על עצמכן, מה היה משמעותי עבורכן ומה כדאי לשפר בתוכנית.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתן באמת חושבות ומרגישות.','خلال برنامج رائدات الطريق، تعرّفنا إلى نساء رائدات، وحدّدنا تحدّيات، وطوّرنا أفكارًا ضمن فرق، وتدرّبنا على عرض الحلول.
نودّ أن نعرف ما الذي اكتشفتنّه عن أنفسكنّ، وما كان مهمًّا بالنسبة إليكنّ، وما الذي يمكن تحسينه في البرنامج.
لا توجد إجابات صحيحة أو خاطئة. أجبن بحسب ما تفكّرن وتشعرن به فعلًا.'),
('pharma','pre','איך מפתחים פתרון רפואי שעונה על צורך אמיתי של אנשים?
בתוכנית רוקחים עולם נבחן את הקשר בין מדע, רפואה ותעשייה, נכיר שלבים בפיתוח מוצר רפואי ונתנסה בזיהוי צרכים, חקר ופיתוח פתרונות.
לפני שנתחיל, נשמח לדעת מה אתם חושבים על פיתוח תרופות, איך אתם בוחנים בעיות ואיך אתם עובדים עם אחרים כדי למצוא פתרונות.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','كيف نطوّر حلًّا طبيًّا يلبّي حاجة حقيقية لدى الناس؟
في برنامج نصنع عالم الأدوية، سنستكشف العلاقة بين العلم والطب والصناعة، ونتعرّف إلى مراحل تطوير منتج طبي، ونتدرّب على تحديد الاحتياجات والبحث وتطوير الحلول.
قبل أن نبدأ، نودّ معرفة آرائكم حول تطوير الأدوية، وكيف تفحصون المشكلات وتتعاونون مع الآخرين لإيجاد حلول.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('pharma','post','בתוכנית רוקחים עולם הכרנו את הדרך שבה מתפתח מוצר רפואי: מזיהוי צורך וחקר ועד לפיתוח דגם והצגת פתרון.
נשמח לשמוע מה השתנה בדרך שבה אתם חושבים על מדע, רפואה ופיתוח מוצרים, ומה כדאי לשפר בתוכנית.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','في برنامج نصنع عالم الأدوية، تعرّفنا إلى مراحل تطوير منتج طبي، بدءًا من تحديد الحاجة والبحث، وصولًا إلى إعداد نموذج وعرض الحلّ.
نودّ أن نعرف ما الذي تغيّر في طريقة تفكيركم بشأن العلم والطب وتطوير المنتجات، وما الذي يمكن تحسينه في البرنامج.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('ofek','pre','איך הופכים רעיון למוצר או למיזם שנותן מענה לצורך אמיתי?
בתוכנית אופק יזמות פרימיום נלמד לזהות צרכים, לחקור את קהל היעד, לפתח רעיונות, לבחון פתרונות ולתכנן כיצד להציג אותם.
לפני שנתחיל, נשמח לדעת איך אתם ניגשים לאתגרים, כיצד אתם בוחנים רעיונות ועד כמה אתם מרגישים בטוחים לפעול בצוות ולהציג אותם.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','كيف نحوّل فكرة إلى منتج أو مشروع يلبّي حاجة حقيقية؟
في برنامج أوفِك لريادة الأعمال المتميّزة، سنتعلّم تحديد الاحتياجات، ودراسة الفئة المستهدفة، وتطوير الأفكار، وفحص الحلول والتخطيط لعرضها.
قبل أن نبدأ، نودّ أن نعرف كيف تتعاملون مع التحدّيات، وكيف تقيّمون الأفكار، ومدى ثقتكم بالعمل ضمن فريق وعرض أفكاركم.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.'),
('ofek','post','בתוכנית אופק יזמות פרימיום למדנו לזהות צורך, לחקור קהל יעד, לפתח דגם, לשפר רעיון בעקבות משוב ולהציג פתרון.
נשמח לשמוע מה למדתם על יזמות ועבודת צוות, אילו שלבים היו משמעותיים עבורכם ומה אפשר לשפר בתוכנית.
אין תשובות נכונות או לא נכונות. ענו לפי מה שאתם באמת חושבים ומרגישים.','في برنامج أوفِك لريادة الأعمال المتميّزة، تعلّمنا تحديد الحاجة ودراسة الفئة المستهدفة، وتطوير نموذج، وتحسين الفكرة بناءً على الملاحظات، وعرض الحلّ.
نودّ معرفة ما تعلّمتموه عن ريادة الأعمال والعمل الجماعي، وما المراحل التي كانت مهمّة لكم، وما الذي يمكن تحسينه في البرنامج.
لا توجد إجابات صحيحة أو خاطئة. أجيبوا بحسب ما تفكّرون وتشعرون به فعلًا.')
on conflict(program_key,stage) do update set intro_text_he=excluded.intro_text_he,intro_text_ar=excluded.intro_text_ar;

do $validate$
declare num integer;
begin
 select count(*) into num from public.feedback_templates t
 where t.program_key in ('green_leadership','space_tech','trailblazers','pharma','ofek') and t.audience='student';
 if num<>10 then raise exception 'unexpected template count: %',num; end if;
 if exists (select 1 from public.feedback_template_versions v
 join public.feedback_templates t on t.id=v.template_id
 where t.program_key in ('green_leadership','space_tech','trailblazers','pharma','ofek')
 and t.audience='student' and v.status='draft')
 then raise exception 'student templates have pending drafts'; end if;
 if exists (select 1 from public.feedback_templates t
 join public.feedback_template_questions q on q.version_id=t.current_version_id
 where t.program_key in ('green_leadership','space_tech','trailblazers','pharma','ofek') and t.audience='student'
 group by t.program_key,t.stage
 having count(*)<>case when t.program_key in ('green_leadership','space_tech')
    then case when t.stage='pre' then 8 else 12 end
    else case when t.stage='pre' then 10 else 14 end end
 or count(*) filter(where q.is_comparison)<>case when t.program_key in ('green_leadership','space_tech') then 8 else 10 end)
 then raise exception 'unexpected student question / comparison structure'; end if;
end $validate$;

create temporary table syllabus_targets(template_id uuid primary key,program_key text,stage text) on commit drop;
insert into syllabus_targets
select t.id,t.program_key,t.stage
from public.feedback_templates t
join public.feedback_template_versions v on v.id=t.current_version_id
join private.feedback_student_syllabus_intros i on i.program_key=t.program_key and i.stage=t.stage
where t.audience='student' and (v.intro_text is distinct from i.intro_text_he or v.intro_text_ar is distinct from i.intro_text_ar);

insert into public.feedback_template_versions(template_id,version_no,status,intro_text,intro_text_ar,notes)
select x.template_id,(select coalesce(max(v.version_no),0)+1 from public.feedback_template_versions v where v.template_id=x.template_id),
'draft',i.intro_text_he,i.intro_text_ar,'התאמת פתיחים לגיל ולסילבוס; שאלות מדידה נשמרו'
from syllabus_targets x join private.feedback_student_syllabus_intros i on i.program_key=x.program_key and i.stage=x.stage;

insert into public.feedback_template_questions(version_id,question_id,section,sort_order,required,metric_key,question_type,is_comparison,wording,options,scoring)
select v.id,q.question_id,q.section,q.sort_order,q.required,q.metric_key,q.question_type,q.is_comparison,q.wording,q.options,q.scoring
from syllabus_targets x join public.feedback_templates t on t.id=x.template_id
join public.feedback_template_versions v on v.template_id=x.template_id and v.status='draft'
join public.feedback_template_questions q on q.version_id=t.current_version_id;

do $publish$
declare r record;
begin
 for r in select v.id from public.feedback_template_versions v join syllabus_targets x on x.template_id=v.template_id where v.status='draft'
 loop perform private.feedback_publish_version(r.id); end loop;
end $publish$;

-- Also show the latest approved copy in old invitation URLs, preserving linked question/answer IDs.
do $rpc$
declare old_def text;new_def text;
begin
 select pg_get_functiondef(p.oid) into old_def from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='feedback_public_get';
 if old_def is null then raise exception 'feedback_public_get missing'; end if;
 new_def:=old_def;
 if position('private.feedback_student_syllabus_intros' in new_def)=0 then
  if position('''intro_text'',(select intro_text from public.feedback_template_versions where id=c.template_version_id)' in new_def)=0
   or position('''intro_text_ar'',case when c.program_key=''biomimicry''' in new_def)=0
  then raise exception 'unexpected feedback_public_get intro structure'; end if;
  new_def:=replace(new_def,'''intro_text'',(select intro_text from public.feedback_template_versions where id=c.template_version_id)',
   '''intro_text'',coalesce((select i.intro_text_he from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage and c.audience=''student''),(select intro_text from public.feedback_template_versions where id=c.template_version_id))');
  new_def:=replace(new_def,'''intro_text_ar'',case when c.program_key=''biomimicry''',
   '''intro_text_ar'',case when c.audience=''student'' and exists(select 1 from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage) then (select i.intro_text_ar from private.feedback_student_syllabus_intros i where i.program_key=c.program_key and i.stage=c.stage) when c.program_key=''biomimicry''');
 end if;
 if new_def<>old_def then execute new_def; end if;
end $rpc$;

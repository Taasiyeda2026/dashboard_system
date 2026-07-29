-- Allow the תשפ״ז proposal type to contain courses, workshops, or both.
-- Existing summer pricing rows remain the single source of truth; no workshop is duplicated.

insert into public.proposal_activity_groups (
  group_key,
  display_name,
  template_key,
  included_group_keys,
  sort_order,
  is_active
)
values
  ('next_year_courses', 'קורסים', 'next_year', array[]::text[], 201, true),
  ('next_year_workshops', 'סדנאות', 'summer', array[]::text[], 202, true)
on conflict (group_key) do update set
  display_name = excluded.display_name,
  template_key = excluded.template_key,
  included_group_keys = excluded.included_group_keys,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active,
  updated_at = now();

update public.proposal_activity_groups
set included_group_keys = array['next_year_courses', 'next_year_workshops']::text[],
    updated_at = now()
where group_key = 'next_year';

update public.proposal_template_sections
set template_name = 'הצעת מחיר {{quote_number}} פעילויות תעשיידע | תשפ״ז',
    updated_at = now()
where template_key = 'next_year';

update public.proposal_template_sections
set section_body = 'להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז. בהתאם לבחירה, ההצעה יכולה לכלול קורסים, סדנאות או שילוב ביניהם. פירוט התכנים והמידע הפדגוגי מצורף כנספח להצעה זו.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'activity_intro';

update public.proposal_template_sections
set section_body = E'ביצוע הקורסים והסדנאות בהתאם לתוכן החינוכי המאושר, באמצעות מדריכים מקצועיים מטעם תעשיידע.\nאספקת חומרי ההדרכה, הציוד, חומרי הפעילות והמשאבים הנדרשים לקיום הפעילות.\nליווי מקצועי ותיאום שוטף מול צוות בית הספר לאורך תקופת הפעילות.\nקיום משוב והערכה לבחינת שביעות הרצון, איכות ההדרכה והתאמת המענה.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'taasiyeda_responsibility';

update public.proposal_template_sections
set section_title = 'אחריות בית הספר / הגוף המזמין',
    section_body = E'מינוי איש קשר לתיאום שוטף מול תעשיידע.\nנוכחות איש צוות מטעם בית הספר או הגוף המזמין לאורך כל קורס, מפגש או סדנה.\nעדכון תעשיידע מראש בכל שינוי הנוגע למועדי הפעילות או ללוחות הזמנים.\nהעמדת מרחב מתאים לפעילות, הכולל מקרן, לוח וחיבור תקין לאינטרנט.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'school_responsibility';

update public.proposal_template_sections
set section_body = E'עבור קורס, התשלום יחולק לשתי חשבוניות: הראשונה תונפק עם תחילת הקורס והשנייה לאחר השלמת מחצית מהיקפו.\nעבור סדנה, חשבונית לתשלום תונפק עם תחילת הפעילות.\nכל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'payment_terms';

update public.proposal_template_sections
set section_body = E'ביטול קורס ביוזמת המזמין יחויב בתשלום מלא על המפגשים שהתקיימו וב-10% מעלות יתרת המפגשים שלא התקיימו.\nסדנה או מפגש שיבוטלו על ידי המזמין בהתראה של פחות משני ימי עבודה ייחשבו כפעילות שהתקיימה בפועל ויחויבו בהתאם.\nבמקרה של הפסקת לימודים פרונטליים בהתאם להנחיות משרד החינוך או בשל מצב חירום, קורס יותאם ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הקורס יימשך בהתאם לתיאום בין הצדדים.\nכאשר לא ניתן לקיים סדנה באופן פרונטלי, יתואם מועד חלופי בכפוף לזמינות הצדדים.',
    updated_at = now()
where template_key = 'next_year'
  and section_key = 'cancellation_terms';

-- The digital escape room intentionally remains summer-only.
-- Historical proposal items, locked snapshots and sent PDFs are not modified.

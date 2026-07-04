-- Reconstructed migration from Supabase schema_migrations
-- version: 20260530
-- name: activity_exceptions_end_date_sync
-- This replaces the incorrectly named/local 20260530_exact_proposal_templates_multiline.sql.

-- ============================================================
-- Combined migration section from: 20260530_activity_exceptions_end_date_sync.sql
-- Original migration version prefix: 20260530
-- ============================================================

-- Keep public.activities.end_date synchronized with the latest meeting date.
-- If a row has no date_1..date_35 values, the trigger leaves end_date unchanged.

alter table public.activities add column if not exists district text;

create or replace function public.activities_calculated_end_date_from_meetings(p_row public.activities)
returns text
language plpgsql
immutable
as $$
declare
  latest_date text;
begin
  select max(v)
    into latest_date
  from unnest(array[
    nullif(btrim(p_row.date_1), ''),  nullif(btrim(p_row.date_2), ''),
    nullif(btrim(p_row.date_3), ''),  nullif(btrim(p_row.date_4), ''),
    nullif(btrim(p_row.date_5), ''),  nullif(btrim(p_row.date_6), ''),
    nullif(btrim(p_row.date_7), ''),  nullif(btrim(p_row.date_8), ''),
    nullif(btrim(p_row.date_9), ''),  nullif(btrim(p_row.date_10), ''),
    nullif(btrim(p_row.date_11), ''), nullif(btrim(p_row.date_12), ''),
    nullif(btrim(p_row.date_13), ''), nullif(btrim(p_row.date_14), ''),
    nullif(btrim(p_row.date_15), ''), nullif(btrim(p_row.date_16), ''),
    nullif(btrim(p_row.date_17), ''), nullif(btrim(p_row.date_18), ''),
    nullif(btrim(p_row.date_19), ''), nullif(btrim(p_row.date_20), ''),
    nullif(btrim(p_row.date_21), ''), nullif(btrim(p_row.date_22), ''),
    nullif(btrim(p_row.date_23), ''), nullif(btrim(p_row.date_24), ''),
    nullif(btrim(p_row.date_25), ''), nullif(btrim(p_row.date_26), ''),
    nullif(btrim(p_row.date_27), ''), nullif(btrim(p_row.date_28), ''),
    nullif(btrim(p_row.date_29), ''), nullif(btrim(p_row.date_30), ''),
    nullif(btrim(p_row.date_31), ''), nullif(btrim(p_row.date_32), ''),
    nullif(btrim(p_row.date_33), ''), nullif(btrim(p_row.date_34), ''),
    nullif(btrim(p_row.date_35), '')
  ]) as dates(v)
  where v ~ '^\d{4}-\d{2}-\d{2}$';

  return latest_date;
end;
$$;

create or replace function public.activities_sync_end_date_from_meetings()
returns trigger
language plpgsql
as $$
declare
  calculated_end text;
begin
  calculated_end := public.activities_calculated_end_date_from_meetings(new);
  if calculated_end is not null then
    new.end_date := calculated_end;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_activities_sync_end_date_from_meetings on public.activities;

create trigger trg_activities_sync_end_date_from_meetings
before insert or update of
  date_1, date_2, date_3, date_4, date_5, date_6, date_7, date_8, date_9, date_10,
  date_11, date_12, date_13, date_14, date_15, date_16, date_17, date_18, date_19, date_20,
  date_21, date_22, date_23, date_24, date_25, date_26, date_27, date_28, date_29, date_30,
  date_31, date_32, date_33, date_34, date_35
on public.activities
for each row
execute function public.activities_sync_end_date_from_meetings();

-- ============================================================
-- Combined migration section from: 20260530_exact_proposal_templates_multiline.sql
-- Original migration version prefix: 20260530
-- ============================================================

-- Refresh proposal template sections with exact multiline copy.
-- The section_body values intentionally contain real line breaks.
DO $$
BEGIN
  IF to_regclass('public.proposal_template_sections') IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.proposal_template_sections
  SET is_active = false
  WHERE template_key NOT IN ('summer', 'next_year', 'combined');

  DELETE FROM public.proposal_template_sections
  WHERE template_key IN ('summer', 'next_year', 'combined');

  INSERT INTO public.proposal_template_sections
    (template_key, template_name, activity_type_group, section_key, section_title, section_body, sort_order, is_active)
  VALUES
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'intro', 'פתיח',
$body$תעשיידע היא עמותה חינוכית מיסודה של התאחדות התעשיינים, הפועלת לקידום החינוך הטכנולוגי בישראל. באמצעות קורסים וסדנאות בתחומי STEM, העמותה מחברת תלמידים לעולמות המדע, הטכנולוגיה, ההנדסה והתעשייה ומובילה למידה חווייתית, התנסות מעשית ופיתוח מיומנויות לעולם טכנולוגי משתנה.$body$,
     10, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'activity_intro', 'הפעילות המוצעת',
$body$ההצעה כוללת סדנאות מייקרים וחדרי בריחה דיגיטליים, המיועדים להפעלה במסגרת פעילות הקיץ.

 ההצעה מיועדת לקבוצה של עד 20 משתתפים.
 בכל סדנת מייקרים יכין כל משתתף תוצר אישי.
 דף מידע המפרט את מגוון הפעילויות המוצעות מצורף להצעה זו.$body$,
     20, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'taasiyeda_responsibility', 'אחריות תעשיידע',
$body$ ביצוע הסדנאות בהתאם לתוכן חינוכי מאושר ומותאם לשכבת הגיל.
 העברת הסדנאות באמצעות מדריכים מקצועיים מטעם תעשיידע.
 אספקת הציוד, החומרים והאמצעים הנדרשים לקיום הסדנאות.
 תיאום, ארגון וליווי שוטף של ההפעלה מול בית הספר או הגוף המזמין.$body$,
     30, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'school_responsibility', 'אחריות בית הספר / הגוף המזמין',
$body$ מינוי איש קשר לתיאום שוטף מול תעשיידע.
 נוכחות איש צוות מטעם בית הספר או הגוף המזמין לאורך כל סדנה.
 עדכון תעשיידע מראש בכל שינוי הנוגע ללוחות הזמנים או לתנאי ההפעלה.
 העמדת מרחב מתאים לסדנה, הכולל מקרן, לוח וחיבור תקין לאינטרנט, ככל שנדרש לפי אופי הסדנה.$body$,
     40, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'payment_terms', 'עלות ותנאי תשלום',
$body$ חשבונית לתשלום תונפק עם תחילת הסדנה.
 תנאי התשלום: שוטף + 30 ממועד הנפקת החשבונית.$body$,
     50, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'cancellation_terms', 'שינויים, ביטולים והתאמות',
$body$ סדנה שתבוטל על ידי בית הספר או הגוף המזמין בהתראה של פחות משני ימי עבודה, תיחשב כסדנה שהתקיימה בפועל ותחויב בהתאם.
 במקרה שבו לא ניתן לקיים את הסדנה בשל הנחיות משרד החינוך, מצב חירום או נסיבות שאינן מאפשרות קיום פרונטלי, יתואם מועד חלופי לקיום הסדנה, בכפוף לזמינות הצדדים.$body$,
     60, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'notes', 'הערות', '', 70, true),
    ('summer', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו', 'קיץ תשפ״ו', 'signature', 'חתימה', '', 80, true),

    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'intro', 'פתיח',
$body$תעשיידע היא עמותה חינוכית מיסודה של התאחדות התעשיינים, הפועלת לקידום החינוך הטכנולוגי בישראל. באמצעות קורסים וסדנאות בתחומי STEM, העמותה מחברת תלמידים לעולמות המדע, הטכנולוגיה, ההנדסה והתעשייה ומובילה למידה חווייתית, התנסות מעשית ופיתוח מיומנויות לעולם טכנולוגי משתנה.$body$,
     10, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'activity_intro', 'הפעילות המוצעת',
$body$להלן הקורסים המוצעים לשנת הלימודים תשפ״ז. פירוט מלא של הקורסים מצורף כנספח להצעה זו.$body$,
     20, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'taasiyeda_responsibility', 'אחריות תעשיידע',
$body$ ביצוע הקורס בהתאם לסילבוס המאושר, באמצעות מדריך מקצועי מטעם תעשיידע.
 אספקת חומרי ההדרכה, חומרי הפעילות והמשאבים הנדרשים לקיום הקורס.
 ליווי מקצועי ותיאום שוטף מול צוות בית הספר לאורך תקופת הקורס.
 קיום משוב והערכה לבחינת שביעות הרצון, איכות ההדרכה והתאמת המענה.$body$,
     30, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'school_responsibility', 'אחריות בית הספר',
$body$ מינוי איש קשר מטעם בית הספר לתיאום שוטף מול תעשיידע.
 נוכחות איש צוות מטעם בית הספר לאורך כל מפגשי הקורס.
 עדכון תעשיידע מראש בכל שינוי הנוגע למועדי הקורס או ללוחות הזמנים.
 העמדת מרחב מתאים לקורס, הכולל מקרן, לוח וחיבור תקין לאינטרנט.$body$,
     40, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'payment_terms', 'עלות ותנאי תשלום',
$body$ התשלום עבור הקורס יחולק לשני חלקים: חשבונית ראשונה תונפק עם תחילת הקורס. חשבונית שנייה תונפק לאחר השלמת מחצית מהיקף הקורס.
 כל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.$body$,
     50, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'cancellation_terms', 'שינויים, ביטולים והתאמות',
$body$ במקרה של הפסקת הקורס ביוזמת בית הספר, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות יתרת המפגשים שלא התקיימו.
 מפגש שיבוטל על ידי בית הספר בהתראה של פחות משני ימי עבודה, ייחשב כמפגש שהתקיים בפועל ויחויב בהתאם.
 במקרה של הפסקת לימודים פרונטליים בהתאם להנחיות משרד החינוך או בשל מצב חירום, הקורס יותאם ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הקורס יימשך בבית הספר בהתאם לתיאום בין הצדדים.$body$,
     60, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'notes', 'הערות', '', 70, true),
    ('next_year', 'הצעת מחיר לקורסי תעשיידע | שנת הלימודים תשפ״ז', 'שנת הלימודים תשפ״ז', 'signature', 'חתימה', '', 80, true),

    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'intro', 'פתיח',
$body$תעשיידע היא עמותה חינוכית מיסודה של התאחדות התעשיינים, הפועלת לקידום החינוך הטכנולוגי בישראל. באמצעות קורסים וסדנאות בתחומי STEM, העמותה מחברת תלמידים לעולמות המדע, הטכנולוגיה, ההנדסה והתעשייה ומובילה למידה חווייתית, התנסות מעשית ופיתוח מיומנויות לעולם טכנולוגי משתנה.$body$,
     10, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'summer_activity_intro', 'הפעילות המוצעת לקיץ תשפ״ו',
$body$ההצעה כוללת סדנאות מייקרים וחדרי בריחה דיגיטליים, המיועדים להפעלה חווייתית, מעשית ומותאמת גיל במסגרת פעילות הקיץ.

 ההצעה מיועדת לקבוצה של עד 20 משתתפים.
 בכל סדנת מייקרים יכין כל משתתף תוצר אישי.
 דף מידע המפרט את מגוון הפעילויות המוצעות מצורף להצעה זו.$body$,
     20, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'next_year_activity_intro', 'הפעילות המוצעת לשנת הלימודים תשפ״ז',
$body$להלן הקורסים המוצעים לשנת הלימודים תשפ״ז. פירוט מלא של הקורסים מצורף כנספח להצעה זו.$body$,
     30, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'taasiyeda_responsibility', 'אחריות תעשיידע',
$body$ ביצוע הסדנה או הקורס בהתאם לתוכן המאושר, באמצעות מדריך מקצועי מטעם תעשיידע.
 אספקת חומרי ההדרכה, חומרי הפעילות והמשאבים הנדרשים לקיום הסדנה או הקורס.
 ליווי מקצועי ותיאום שוטף מול צוות בית הספר או הגוף המזמין לאורך תקופת ההפעלה.
 קיום משוב והערכה לבחינת שביעות הרצון, איכות ההדרכה והתאמת המענה.$body$,
     40, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'school_responsibility', 'אחריות בית הספר / הגוף המזמין',
$body$ מינוי איש קשר לתיאום שוטף מול תעשיידע.
 נוכחות איש צוות מטעם בית הספר או הגוף המזמין לאורך כל סדנה או מפגש.
 עדכון תעשיידע מראש בכל שינוי הנוגע למועדי הפעילות או ללוחות הזמנים.
 העמדת מרחב מתאים לפעילות, הכולל מקרן, לוח וחיבור תקין לאינטרנט.$body$,
     50, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'payment_terms', 'עלות ותנאי תשלום',
$body$ עבור סדנה, חשבונית לתשלום תונפק עם תחילת הסדנה.
 עבור קורס, התשלום יחולק לשני חלקים: חשבונית ראשונה תונפק עם תחילת הקורס. חשבונית שנייה תונפק לאחר השלמת מחצית מהיקף הקורס.
 כל חשבונית תשולם בתנאי שוטף + 30 ממועד הנפקתה.$body$,
     60, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'cancellation_terms', 'שינויים, ביטולים והתאמות',
$body$ במקרה של הפסקת קורס ביוזמת בית הספר או הגוף המזמין, ייגבה תשלום מלא עבור המפגשים שהתקיימו בפועל וכן 10% מעלות יתרת המפגשים שלא התקיימו.
 סדנה או מפגש שיבוטלו על ידי בית הספר או הגוף המזמין בהתראה של פחות משני ימי עבודה, ייחשבו כפעילות שהתקיימה בפועל ויחויבו בהתאם.
 במקרה של הפסקת לימודים פרונטליים בהתאם להנחיות משרד החינוך או בשל מצב חירום, קורס יותאם ללמידה מקוונת ללא שינוי בעלות. עם חזרת הלימודים הפרונטליים, הקורס יימשך בבית הספר בהתאם לתיאום בין הצדדים.
 במקרה שבו לא ניתן לקיים סדנה בשל הנחיות משרד החינוך, מצב חירום או נסיבות שאינן מאפשרות קיום פרונטלי, יתואם מועד חלופי לקיום הסדנה, בכפוף לזמינות הצדדים.$body$,
     70, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'notes', 'הערות', '', 80, true),
    ('combined', 'הצעת מחיר לפעילויות תעשיידע | קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'קיץ תשפ״ו ושנת הלימודים תשפ״ז', 'signature', 'חתימה', '', 90, true);
END $$;

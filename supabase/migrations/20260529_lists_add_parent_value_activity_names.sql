-- Add parent_value column to public.lists to enable per-type filtering of activity names.
alter table public.lists
  add column if not exists parent_value text;

-- Populate parent_value for all existing activity_names rows based on the canonical mapping.
-- Rows that already have a non-null parent_value are left untouched.

update public.lists
set parent_value = 'workshop'
where category = 'activity_names'
  and parent_value is null
  and value in (
    'אסטרונאוט על חוטים',
    'מעבורת חלל תלת-ממדית',
    'רוטוקופטר',
    'פרפרטוס',
    'צמידי שמש',
    'קלידוסקופ',
    'ג׳וני השלד',
    'נשכן מפרקים',
    'פרוגי המקפצת',
    'מכונית מגנטית',
    'ציפור שיווי משקל',
    'גלגל הקסם',
    'חללית בראשית',
    'מערכת השמש בתלת-ממד',
    'טלסקופ קפלר',
    'כדור מולקולה',
    'משקפת מתקפלת',
    'מצפן',
    'מכונית תנע',
    'גשר לאונרדו',
    'קטפולטה',
    'כדורי ברנולי',
    'ספינר',
    'קופת קסם (ד''-ו'')',
    'גיטרה - מנגנים פיזיקה',
    'יוסי התוכי',
    'קסם האנימציה',
    'מאזניים',
    'קופת קסם – מדע או אשליה?',
    'הגיטרה הראשונה שלי',
    'שעון רובוט – הזמן שלנו',
    'הנדסת זמן – שעון רובוט',
    'פריסקופ'
  );

update public.lists
set parent_value = 'escape_room'
where category = 'activity_names'
  and parent_value is null
  and value in (
    'תמיר - חדר בריחה קווסט',
    'תמיר - איפה דדי?'
  );

update public.lists
set parent_value = 'tour'
where category = 'activity_names'
  and parent_value is null
  and value in (
    'התנסות בתעשייה'
  );

update public.lists
set parent_value = 'after_school'
where category = 'activity_names'
  and parent_value is null
  and value in (
    'חוג מייקרים'
  );

update public.lists
set parent_value = 'course'
where category = 'activity_names'
  and parent_value is null
  and value in (
    'ביומימיקרי',
    'טכנולוגיות החלל',
    'מנהיגות ירוקה',
    'משחקי קופסה',
    'מייקרים',
    'ביומימיקרי לחטיבה',
    'בינה מלאכותית',
    'השמיים אינם הגבול',
    'יישומי AI',
    'פורצות דרך',
    'פרימיום',
    'רוקחים עולם',
    'אופק לתעשייה',
    'תלמידים להייטק'
  );

-- Index to speed up category + parent_value lookups.
create index if not exists lists_category_parent_value_idx
  on public.lists(category, parent_value);

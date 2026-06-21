-- ============================================================
-- Combined migration section from: 20260617_workshop_stock_distributions.sql
-- Original migration version prefix: 20260617
-- ============================================================

-- טבלת חלוקת מלאי למדריכים לפי סדנה
-- להריץ ב-Supabase SQL Editor לפני שימוש בתכונת "כמות שקיבל מדריך"

CREATE TABLE IF NOT EXISTS workshop_stock_distributions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_group_key text NOT NULL,
  instructor_name text NOT NULL,
  quantity_received integer,
  period_start date NOT NULL,
  period_end date,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (stock_group_key, instructor_name, period_start)
);

COMMENT ON TABLE workshop_stock_distributions IS 'רישום חלוקת מלאי סדנאות למדריכים לפי תקופה';
COMMENT ON COLUMN workshop_stock_distributions.stock_group_key IS 'מזהה קבוצת המלאי מטבלת lists';
COMMENT ON COLUMN workshop_stock_distributions.instructor_name IS 'שם מדריך (תצוגה בלבד — מזהה הוא stock_group_key + period_start)';
COMMENT ON COLUMN workshop_stock_distributions.quantity_received IS 'כמות שהמדריך קיבל בפועל (ניפוק)';
COMMENT ON COLUMN workshop_stock_distributions.period_start IS 'תחילת תקופה (למשל 2026-06-15 לקיץ 2026)';
COMMENT ON COLUMN workshop_stock_distributions.period_end IS 'סוף תקופה (למשל 2026-09-01)';

-- הפעלת RLS
ALTER TABLE workshop_stock_distributions ENABLE ROW LEVEL SECURITY;

-- מדיניות גישה — מותאמת לאפליקציה שלכם (anon key)
-- אם יש לכם RLS מחמיר יותר, להחליף בהתאם
CREATE POLICY "workshop_dist_all" ON workshop_stock_distributions
  FOR ALL USING (true) WITH CHECK (true);

-- אינדקס לחיפוש מהיר
CREATE INDEX IF NOT EXISTS idx_wsd_stock_group ON workshop_stock_distributions (stock_group_key, period_start);


-- ============================================================
-- Combined migration section from: 20260617_workshop_stock_group_keys.sql
-- Original migration version prefix: 20260617
-- ============================================================

-- הגדרת stock_group_key לסדנאות המשתמשות באותו מלאי פיזי
-- יש להריץ ב-Supabase SQL Editor
-- לפני הרצה: לוודא את ערכי activity_no המדויקים בטבלת lists

-- 1. קופת קסם — סדנאות 024 ו-029
UPDATE lists
SET stock_group_key = 'kofet_kesem'
WHERE category = 'activity_names'
  AND type = 'workshop'
  AND activity_no IN ('024', '029');

-- 2. שעון רובוט — סדנאות 031 ו-032
UPDATE lists
SET stock_group_key = 'shaon_robot'
WHERE category = 'activity_names'
  AND type = 'workshop'
  AND activity_no IN ('031', '032');

-- אם יש סדנאות גיטרה נוספות עם אותו מלאי, להוסיף כאן:
-- UPDATE lists
-- SET stock_group_key = 'gitara'
-- WHERE category = 'activity_names'
--   AND type = 'workshop'
--   AND activity_no IN ('XXX', 'YYY');

-- לאחר הרצה: לבדוק שהעדכון בוצע
SELECT activity_no, activity_name, stock_group_key, stock_quantity
FROM lists
WHERE category = 'activity_names'
  AND type = 'workshop'
ORDER BY stock_group_key, activity_no;

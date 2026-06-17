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

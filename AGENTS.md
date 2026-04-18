# AGENTS.md — dashboard_system execution brief

## מקור אמת חובה
לפני כל שינוי, יש להשתמש בשני מקורות אמת יחד:
1. הקוד הקיים בריפו
2. קובץ מקור הנתונים שיועלה לריפו בשם:
   `system_dashboard_source_of_truth.json`

אם יש סתירה בין הנחות hard-coded בקוד לבין מקור הנתונים — מקור הנתונים גובר.

---

## החלטות עסקיות מחייבות

1. `exceptions` נשאר לוגית כפי שהוא.
   - מותר רק bugfix / polish / usability / mobile / RTL
   - אסור לשנות את ההיגיון העסקי שלו

2. חייבים להיות שני מסכים נפרדים:
   - `instructors`
   - `instructor-contacts`

3. `contacts` לא ישמש כתחליף ל-`instructor-contacts`

4. `instructor` הוא read-only בכל המערכת
   - למדריכים מותרת צפייה בלבד
   - אין עריכה למדריכים בשום מסך

5. כל משתמש שאינו `instructor`, ואם יש לו הרשאת צפייה במסך עבודה —
   אמורה להיות לו גם אפשרות עריכה רלוונטית באותו מסך

6. לא להחזיר את workflow הישן של:
   - edit requests
   - approvals
   - eden
   - final approvals
   כזרימת העבודה הראשית

7. לא לבצע rewrite
8. לא להחליף stack
9. לא לשבור routes / state / API contracts / business logic תקין

---

## סדר עבודה מחייב

### PHASE 1 — Source schema alignment
יישור מלא של המערכת מול מקור הנתונים הראשי.

לבצע:
- לעבור גיליון-גיליון לפי `system_dashboard_source_of_truth.json`
- ליישר שמות גיליונות
- ליישר כותרות עמודות
- ליישר data start row
- להסיר הנחות hard-coded שסותרות את המקור
- ליישר `data_long`, `data_short`, `activity_meetings`, `permissions`, `settings`, `lists`,
  `contacts_schools`, `contacts_instructors`, `operations_private_notes`, `edit_requests`, `אפיון`

דגשים:
- `data_long` ו-`data_short` חייבים להיות ממופים בדיוק לפי המקור
- `activity_meetings` הוא מקור המפגשים האמיתיים
- `settings` ו-`lists` צריכים להפוך למקורות נתונים פעילים
- `default_view` חייב להיות מיושר לערכים בפועל
- מודל ההרשאות חייב להיות מיושר לשדות ההרשאות בגיליון

### PHASE 2 — Permissions + routes + bootstrap alignment
- ליישר `buildRoutesFromPermission_`
- ליישר `default_view`
- ליישר bootstrap
- ליישר screen labels
- ליישר permission mapping
- להוסיף routes חסרים מהמקור

חובה להוסיף:
- `end-dates`
- `instructor-contacts`

### PHASE 3 — Dashboard business alignment
- להרחיב KPI בהתאם למקור הנתונים ולאפיון
- לא להסתפק ב-4 KPI הקיימים
- כל KPI חייב להיות מחושב נכון
- כל KPI חייב להוביל למסך או למצב מסונן ברור
- אם האפיון אומר להציג רק KPI עם ערך — ליישם זאת

### PHASE 4 — Activities as real work screen
- להפוך את `activities` למסך עבודה אמיתי
- להרחיב פילטרים לפי מקור הנתונים והאפיון
- להוסיף direct edit למי שאינו `instructor`
- `instructor` נשאר צפייה בלבד

### PHASE 5 — Week + Month from real meetings
- לתקן את `week`
- לתקן את `month`
- שניהם חייבים להישען על `activity_meetings`
- לא להישען רק על `start_date` / `end_date`

### PHASE 6 — End dates
- ליצור מסך `end-dates` ייעודי
- לחבר אותו ל-routes / permissions / bootstrap
- לא להסתפק בפילטר מתוך `activities`

### PHASE 7 — Finance rebuild
- להפוך את `finance` למסך כספים אמיתי
- לא להשאיר אותו כמיפוי גנרי של `allActivities_()`
- ליישם כלל עסקי ברור אילו רשומות נכנסות למסך
- direct edit מותר למי שאינו `instructor`

### PHASE 8 — Contacts split
- ליצור `instructor-contacts`
- להוציא את אנשי הקשר של מדריכים מתוך `contacts`
- להשאיר `contacts` לגורמי קשר כלליים / בתי ספר / רשויות
- לשמור `instructors` כמסך נפרד

### PHASE 9 — Permissions UI expansion
- להרחיב את מסך `permissions`
- לא להסתפק רק ב-`display_role` ו-`active`
- לנהל גם:
  - `default_view`
  - `view_*`
  - `can_add_activity`
  - וכל שדה הרשאה רלוונטי שקיים במקור

### PHASE 10 — Final pass
- בדיקת RTL
- בדיקת mobile
- בדיקת drawer flows
- בדיקת edit flows
- בדיקת cache invalidation
- בדיקת instructor read-only
- בדיקה ש-`exceptions` לא שונה לוגית

---

## מה לא לעשות
- לא לחזור שוב על mobile drawer foundation
- לא לבנות shared interaction layer מחדש
- לא לעשות rewrite למסכים שכבר קיימים
- לא להתעלם ממקור הנתונים הראשי
- לא להשאיר hard-coded assumptions שסותרות את הגיליונות

---

## פורמט דיווח חובה
בסיום כל שלב לדווח בדיוק:
1. מה בוצע
2. אילו קבצים שונו
3. אילו הנחות hard-coded הוסרו או יושרו למקור
4. אילו מסכים חדשים נוספו
5. מה עדיין נשאר פתוח
6. האם יש חסימה או סיכון

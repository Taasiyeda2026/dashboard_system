משימה: ייעול ביצועי המערכת הקיימת בלי rewrite ובלי החלפת בסיס

מטרה
להאיץ משמעותית את טעינת המסכים והמעבר ביניהם במערכת הקיימת, תוך הישארות על:
- Frontend קיים
- Apps Script backend
- Google Sheets
- ללא מעבר לפלטפורמה חדשה
- ללא rewrite

חוקים
1. לא לבצע rewrite.
2. לא להחליף בסיס טכנולוגי.
3. לא לשבור פיצ'רים קיימים.
4. לעבוד בשלבים קטנים עם בדיקה אחרי כל שלב.
5. להתמקד רק בביצועים אמיתיים.

סדר עבודה מחייב

שלב 1 — מדידה
להוסיף מדידה לזמני:
- backend action
- קריאת sheets
- בניית payload
- render frontend
- גודל response

להחזיר או לרשום debug ברור למסכים הכבדים.

שלב 2 — פיצול רשימה / פירוט
לממש separation מלא בין:
- summary list payload
- detail payload

מסכי רשימה לא יקבלו שדות כבדים.
drawer / detail ייטענו לפי RowID בלבד.

שלב 3 — filtering בשרת
להעביר ל-backend את:
- search
- activity_type
- manager
- family
- status
- tab
- month
- date_from/date_to
- pagination בסיסית אם צריך

המטרה:
לא לטעון הכל ואז לסנן ב-client.

שלב 4 — קריאה חלקית מהשיטס
להוסיף פונקציית projected read:
- קריאה רק של עמודות נדרשות
- mapper ל-summary
- mapper ל-detail

לא להשתמש יותר בקריאה מלאה כשלא צריך.

שלב 5 — cache יעיל
לשמור cache רק לנתונים קלים:
- summary rows
- aggregates
- month/week indexes
- finance summary
- manager lists

לא לשמור cache של responses כבדים שלא באמת נשמרים.

שלב 6 — ייעול מסכי זמן
לייעל:
- dashboard
- week
- month

לא לבנות כל פעם מבני נתונים מלאים אם המסך צריך רק טווח זמן מצומצם.

שלב 7 — שיפורי frontend
לבצע:
- debounce לחיפוש
- event delegation כשאפשר
- load more / pagination פשוטה במסכים ארוכים
- לצמצם rerender מלא כשאפשר

קבצים עיקריים
Backend:
- backend/actions.gs
- backend/sheets.gs
- backend/router.gs
- backend/script-cache.gs

Frontend:
- frontend/src/main.js
- frontend/src/api.js
- frontend/src/screens/activities.js
- frontend/src/screens/operations.js
- frontend/src/screens/finance.js

קריטריוני הצלחה
1. מסכים נטענים מהר יותר בפועל.
2. payloadים קטנים יותר.
3. פחות קריאות כבדות ל-Apps Script.
4. רשימות נטענות בלי detail כבד.
5. detail נטען רק לפי דרישה.
6. אין regression בפיצ'רים קיימים.

פורמט דיווח אחרי כל שלב
- מה שונה
- אילו קבצים שונו
- למה זה משפר ביצועים
- איך לבדוק
- מה עדיין נשאר לביצוע

מה לא לעשות
- לא rewrite
- לא מעבר לפלטפורמה אחרת
- לא refactor אסתטי בלבד
- לא שינוי UX לא נדרש
- לא מחיקת פיצ'רים

התחל עכשיו משלב 1, ואז המשך לפי הסדר בלי לדלג.

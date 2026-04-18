קבצי Apps Script מוכנים להעלאה.

מה לעשות:
1. פתח את פרויקט ה-Apps Script.
2. השאר את הקבצים:
   - Code.gs
   - config.gs
   - helpers.gs
   - sheets.gs
   - auth.gs
   - actions.gs
   - router.gs
3. אם כבר יש אצלך קבצים באותם שמות, החלף את התוכן שלהם בתוכן שבקבצים כאן.
4. בתוך config.gs עדכן:
   CONFIG.SPREADSHEET_ID
5. שמור.
6. פריסה > ניהול פריסות > עריכה/פריסה מחדש.
7. בדוק את כתובת /exec.

הערה:
Code.gs נשאר ריק בכוונה, כדי שלא תישאר גרסה ישנה שמתנגשת עם CONFIG או עם doGet/doPost.

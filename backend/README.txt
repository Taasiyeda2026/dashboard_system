קבצי Apps Script מוכנים להעלאה.

מה לעשות:
1. פתחו פרויקט Apps Script.
2. העתיקו את כל קבצי `backend/*.gs` לפרויקט:
   - Code.gs (entrypoint)
   - router.gs
   - actions.gs
   - auth.gs
   - sheets.gs
   - helpers.gs
   - script-cache.gs
   - config.gs
3. בתוך `config.gs` עדכנו:
   - `CONFIG.SPREADSHEET_ID`
4. שמרו את הקבצים.
5. פריסה > ניהול פריסות > עריכה/פריסה מחדש.
6. בדקו את כתובת `/exec`.

הערה:
`Code.gs` מכיל את `doGet`/`doPost` ומפנה ל־router, כדי לשמור setup ברור ועקבי.

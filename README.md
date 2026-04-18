# Internal Dashboard System (Google Sheets + Apps Script + Vanilla JS)

מערכת ניהול פנימית מבוססת:

- Frontend: Vanilla JS (ES modules)
- Backend: Google Apps Script
- Data source: Google Sheets
- UI: RTL + עברית
- PWA: manifest + service worker

## מבנה ריפו בפועל

- `frontend/` — קוד הממשק (`src/` לקוד, `assets/` למדיה).
- `backend/` — קבצי Apps Script הפעילים.
  - `Code.gs` — **entrypoint** לפריסה (`doGet`, `doPost`).
  - `router.gs` — ניתוב בקשות והפעלת handlers.
  - `actions.gs` — פעולות API.
  - `auth.gs` — אימות והרשאות.
  - `sheets.gs` — גישת נתונים ל־Sheets.
  - `helpers.gs` — utilities כלליים.
  - `script-cache.gs` — cache לביצועים.
  - `config.gs` — קונפיגורציית backend.
- `index.html` — נקודת כניסה ל־frontend.
- `sw.js` — service worker.

## גיליונות נתונים צפויים

- `data_short`
- `data_long`
- `activity_meetings`
- `permissions`
- `lists`
- `contacts_instructors`
- `contacts_schools`
- `edit_requests`
- `operations_private_notes`

## Frontend setup

1. הגדירו API URL באחת מהדרכים הבאות:
   - ערך runtime לפני טעינת האפליקציה:
     ```html
     <script>
       window.__DASHBOARD_CONFIG__ = {
         apiUrl: 'https://script.google.com/macros/s/.../exec'
       };
     </script>
     ```
   - או פרמטר query בזמן פתיחה (לבדיקות):
     `?apiUrl=https://script.google.com/macros/s/.../exec`
2. הריצו שרת סטטי מהשורש (למשל `python -m http.server 5173`).
3. פתחו `http://localhost:5173`.

## Backend setup (Apps Script)

1. צרו/פתחו פרויקט Apps Script.
2. העתיקו את כל הקבצים מתוך `backend/*.gs` לפרויקט.
3. ודאו שהקבצים כוללים את `Code.gs` עם `doGet/doPost` כ־entrypoint.
4. עדכנו `CONFIG.SPREADSHEET_ID` בתוך `backend/config.gs`.
5. ודאו שורת headers תואמת לשמות השדות במערכת.
6. פרסו כ־Web App (execute as owner + access לפי צורך ארגוני).
7. עדכנו את `apiUrl` ב־frontend לנקודת `/exec` של הפריסה.

## הערות תחזוקה

- אין לפזר URL קשיח של API בקוד מסכים/שירותים; המקור היחיד הוא `frontend/src/config.js`.
- בשינוי סכימה/שדות ב־Sheets, יש לעדכן mapping מתאים ב־`backend/actions.gs` ו־`backend/sheets.gs`.

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
  - `Code.gs` — **entrypoint** לפריסה (`doGet`, `doPost`); מעביר ל־`handleGet_` / `handlePost_` ב־`router.gs` (אין לשכפל לוגיקת HTTP כאן).
  - `router.gs` — ניתוב בקשות והפעלת handlers (`handleGet_`, `handlePost_`, מיפוי `handlers`).
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

### בדיקת PWA בסיסית (Phase 11)

1. ודאו ש־`index.html` טוען את `frontend/public/manifest.json`.
2. ודאו שבדפדפן מופיע service worker פעיל (`sw.js`) תחת אותו origin.
3. לאחר שינויי frontend משמעותיים (כולל CSS/מסכים), העלו את `CACHE_VERSION` ב־`sw.js` כדי לרענן cache shell ולא לשרת גרסה ישנה.
4. בדקו שהאייקונים ב־manifest נטענים מהנתיבים ב־`frontend/assets/pwa/`.

## Backend setup (Apps Script)

1. צרו/פתחו פרויקט Apps Script.
2. העתיקו את כל הקבצים מתוך `backend/*.gs` לפרויקט.
3. ודאו שהקבצים כוללים את `Code.gs` עם `doGet/doPost` כ־entrypoint.
4. עדכנו `CONFIG.SPREADSHEET_ID` בתוך `backend/config.gs`.
5. ודאו שורת headers תואמת לשמות השדות במערכת.
6. פרסו כ־Web App (execute as owner + access לפי צורך ארגוני).
7. עדכנו את `apiUrl` ב־frontend לנקודת `/exec` של הפריסה.

### Backend deploy hygiene (ללא ambiguity)

- מקור האמת לקוד backend הוא רק `backend/*.gs` (לא להעתיק חלקית מקבצים חיצוניים).
- בכל פריסה יש לוודא שקיים `Code.gs` עם `doGet/doPost`, וש־`router.gs` כולל את ה־handlers המעודכנים.
- לאחר שינוי הרשאות/פעולות, בצעו deploy חדש ל־Web App ועדכנו את URL ב־frontend config.
- מומלץ לשמור מזהה פריסה (Deployment ID) ותאריך בפרויקט/כרטיס שינוי.

## הערות תחזוקה

- אין לפזר URL קשיח של API בקוד מסכים/שירותים; המקור היחיד הוא `frontend/src/config.js` (או `window.__DASHBOARD_CONFIG__` / פרמטר `?apiUrl=` לפי סעיף Frontend setup).
- שכבת אינטראקציה משותפת (drawer/modal) נמצאת ב־`frontend/src/screens/shared/interactions.js` ומוזנת מ־`main.js` ל־`bind` של מסכים (`ui`).
- בשינוי סכימה/שדות ב־Sheets, יש לעדכן mapping מתאים ב־`backend/actions.gs` ו־`backend/sheets.gs`.
- לשחרור frontend: להריץ בדיקה מקומית, לוודא טעינת manifest+SW, ולעדכן cache version במידת הצורך כדי למנוע shell מיושן.

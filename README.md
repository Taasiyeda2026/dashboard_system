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

## מפת תחזוקה קריטית (לאחר שלבי 1–6)

### קבצים קריטיים לביצועים ויציבות

- `frontend/src/main.js` — routing, mount/render flow, screen cache key/TTL, in-flight request dedup, shell loading/error states.
- `frontend/src/api.js` — timeout/retry/error policy, unauthorized handling, write invalidation policy.
- `frontend/src/state.js` — session state, cache state, route-specific view params (`dashboardMonthYm`, `weekOffset`, `monthYm`).
- `frontend/src/screens/dashboard.js` — חודש בדשבורד (local month navigation, area-only loading, per-month cache usage).
- `frontend/src/screens/activities.js` — heavy list interactions, filter/rerender flow, drawer edit flow.
- `frontend/src/screens/week.js` + `frontend/src/screens/month.js` — calendar navigation params and cache key alignment.
- `backend/router.gs` — API action dispatch and payload passthrough.
- `backend/actions.gs` — business aggregation logic (`dashboard`, `week`, `month`) and role-dependent filtering.
- `backend/script-cache.gs` — script cache keys/versioning/invalidation.
- `backend/sheets.gs` — read/write behavior and request-scope cache layer.

### אם המערכת שוב נהיית איטית — איפה בודקים קודם

1. האם `screenDataCacheKey()` תואם לכל state רלוונטי (למשל חודש/שבוע/מסננים).
2. האם יש cache hit עם TTL טרי לפני fetch (ב־`loadScreenDataWithCache`).
3. האם נוצרת כפילות בקשות בזמן ניווט מהיר (בדיקת `inflightRequests`).
4. האם `clearScreenDataCache` מנקה רחב מדי בעקבות פעולת write.
5. האם `actionDashboard_`/`actionWeek_`/`actionMonth_` מקבלים payload מלא מה־router.
6. האם script cache ב־Apps Script מחזיר payload מתאים לפי key/version.

### אזורים רגישים במיוחד לרגרסיה

- מעבר חודש בדשבורד: cache key + render חלקי + race guards.
- ניווט שבוע/חודש: התאמה בין state, API params, ו־backend payload.
- unauthorized באמצע session: מעבר נקי ל־login ללא shell שבור.
- invalidate אחרי save: הימנעות מ־stale data מצד אחד, והימנעות ממחיקה אגרסיבית מצד שני.
- bind/rebind במסכי רשימות: לא להצמיד listeners גלובליים חוזרים בלי guard.

### מה לא לשנות בלי בדיקת רגרסיה מלאה

- חוזה payload של `dashboard/week/month` בין frontend ל־backend.
- לוגיקת timeout/retry ב־`frontend/src/api.js`.
- state keys שמשפיעים על cache keys במסכים.
- `setSession(null)` וזרימת restore/login במצבי unauthorized.

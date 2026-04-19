# Internal Dashboard System (Google Sheets + Apps Script + Vanilla JS)

מערכת ניהול פנימית מבוססת:

- Frontend: Vanilla JS (ES modules)
- Backend: Google Apps Script
- Data source: Google Sheets
- UI: RTL + עברית, dark shell + light panels
- PWA: manifest + service worker

## מבנה ריפו בפועל

```
frontend/
  src/
    config.js          ← מקור יחיד לכתובת ה-API (שנו רק כאן)
    api.js             ← קריאות API (מייבא config.js בלבד)
    main.js            ← app shell, ניווט, mobile drawer, routing
    state.js           ← global state
    screens/           ← מסכים (login, dashboard, activities, week, month, ...)
      shared/          ← רכיבים/utils משותפים (interactions, html, ui-hebrew)
    styles/
      main.css         ← design tokens + layout + קומפוננטות
  assets/              ← מדיה (לוגו, PWA icons)
backend/
  Code.gs              ← entrypoint (doGet/doPost) → router.gs
  router.gs            ← ניתוב + handlers
  actions.gs           ← פעולות API
  auth.gs              ← אימות והרשאות
  sheets.gs            ← גישת נתונים ל-Sheets
  helpers.gs           ← utilities כלליים
  script-cache.gs      ← cache לביצועים
  config.gs            ← קונפיגורציית backend (SPREADSHEET_ID וכו')
index.html             ← נקודת כניסה ל-frontend
sw.js                  ← service worker (PWA)
```

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

### הגדרת API URL

**כלל:** כתובת ה-API מוגדרת אך ורק ב-`frontend/src/config.js`. אין URL קשיח בשום קובץ אחר.

סדר עדיפויות בקביעת ה-URL:

1. **runtime config** — מומלץ לייצור. הוסיפו לפני `<script type="module">` ב-`index.html`:
   ```html
   <script>
     window.__DASHBOARD_CONFIG__ = {
       apiUrl: 'https://script.google.com/macros/s/.../exec'
     };
   </script>
   ```
2. **query param** — לבדיקות/dev:
   `?apiUrl=https://script.google.com/macros/s/.../exec`
3. **DEFAULT_API_URL** ב-`frontend/src/config.js` — ברירת מחדל לייצור.

### הרצה מקומית

```bash
npx serve . -l 5000
# ואז פתחו: http://localhost:5000
```

## Shell וניווט

### Desktop (≥960px)
- Sidebar קבוע מצד ימין (RTL), רוחב 228px, עם לוגו ורשימת מסכים
- ניווט בלחיצה על כפתור המסך — מסך פעיל מודגש

### Mobile (<960px)
- **Top bar** עם כפתור המבורגר (☰) + שם המסך הנוכחי + כפתור התנתקות
- לחיצה על ☰ פותחת **off-canvas drawer** מצד ימין עם backdrop כהה (`is-mobile-nav-open`)
- סגירה: לחיצה על backdrop, כפתור ✕ בתפריט, מעבר מסך, או מקש Escape
- `body.is-shell-nav-open` מונע גלילת רקע בזמן שהתפריט פתוח
- מיושם ב-`main.js` (פונקציות `setMobileNavOpen`, `closeMobileNav`) ו-`styles/main.css`

## Design tokens

כל ערכי העיצוב מוגדרים ב-`frontend/src/styles/main.css` תחת `:root`:

| Token | תפקיד |
|-------|--------|
| `--ds-shell` / `--ds-shell-2` | רקע ה-sidebar |
| `--ds-surface` / `--ds-surface-subtle` | רקע panels/content |
| `--ds-radius-sm/md/lg/xl` | עיגול פינות (6/10/14/18px) |
| `--ds-shadow-xs/sm/md/lg` | צלליות |
| `--ds-accent` | צבע ראשי (כחול כהה) |
| `--ds-sidebar-w` | רוחב sidebar (228px) |

## PWA

1. ודאו ש-`index.html` טוען את `frontend/public/manifest.json`.
2. ודאו שבדפדפן מופיע service worker פעיל (`sw.js`) תחת אותו origin.
3. לאחר שינויי frontend משמעותיים — העלו את `CACHE_VERSION` ב-`sw.js`.
4. בדקו שהאייקונים ב-manifest נטענים מ-`frontend/assets/pwa/`.

## Backend setup (Apps Script)

1. צרו/פתחו פרויקט Apps Script.
2. העתיקו את כל הקבצים מתוך `backend/*.gs` לפרויקט.
3. ודאו שהקבצים כוללים את `Code.gs` עם `doGet/doPost` כ-entrypoint.
4. עדכנו `CONFIG.SPREADSHEET_ID` בתוך `backend/config.gs`.
5. ודאו שורת headers תואמת לשמות השדות במערכת.
6. פרסו כ-Web App (execute as owner + access לפי צורך ארגוני).
7. העתיקו את כתובת `/exec` ועדכנו `DEFAULT_API_URL` ב-`frontend/src/config.js`.

### Backend deploy hygiene

- מקור האמת לקוד backend הוא רק `backend/*.gs`.
- בכל פריסה ודאו ש-`Code.gs` כולל `doGet/doPost` וש-`router.gs` כולל handlers מעודכנים.
- לאחר שינוי הרשאות/פעולות — deploy חדש + עדכון URL.
- שמרו Deployment ID ותאריך בתיעוד הפרויקט.

## הערות תחזוקה

- **API URL** — מקור יחיד: `frontend/src/config.js`. אין לשים URL קשיח בשום קובץ אחר.
- **שכבת אינטראקציה** — drawer/modal ב-`frontend/src/screens/shared/interactions.js`, מוזן ל-`bind` דרך `ui`.
- **Cache מסכים** — `state.screenDataCache` מונע קריאות כפולות; logout/reload מנקה cache.
- **בשינוי סכימה** — עדכנו mapping ב-`backend/actions.gs` ו-`backend/sheets.gs`.

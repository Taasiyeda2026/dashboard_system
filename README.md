# Internal Dashboard System

מערכת ניהול פנימית מבוססת Google Sheets + Google Apps Script + Vanilla JS, עם ממשק RTL בעברית, תמיכה ב־PWA, והרצה כאתר סטטי שמדבר מול Web App של Apps Script.

## מה יש במערכת

המערכת כוללת מסכי עבודה ותפעול עבור:

- התחברות והרשאות
- לוח בקרה
- פעילויות
- שבוע
- חודש
- חריגות
- כספים
- מדריכים
- אנשי קשר מדריכים
- אנשי קשר
- תאריכי סיום
- הנתונים שלי
- תפעול
- אישורים
- הרשאות

## ארכיטקטורה

- Frontend: Vanilla JS עם ES Modules
- Backend: Google Apps Script
- מקור נתונים: Google Sheets
- פריסה צד לקוח: אתר סטטי
- PWA: `manifest.json` + `sw.js`

ה־frontend נטען מ־`index.html`, מרנדר את האפליקציה דרך `frontend/src/main.js`, ומבצע קריאות POST ל־Apps Script דרך `frontend/src/api.js`.

ה־backend נפרס כ־Web App של Apps Script, כאשר `backend/Code.gs` הוא entrypoint שמפנה ל־`router.gs`.

## מבנה הריפו

```text
.
├── index.html
├── package.json
├── sw.js
├── frontend/
│   ├── assets/
│   ├── public/
│   │   └── manifest.json
│   └── src/
│       ├── api.js
│       ├── cache-persist.js
│       ├── config.js
│       ├── main.js
│       ├── state.js
│       ├── styles/
│       │   └── main.css
│       └── screens/
│           ├── login.js
│           ├── dashboard.js
│           ├── activities.js
│           ├── week.js
│           ├── month.js
│           ├── exceptions.js
│           ├── finance.js
│           ├── instructors.js
│           ├── instructor-contacts.js
│           ├── contacts.js
│           ├── end-dates.js
│           ├── my-data.js
│           ├── operations.js
│           ├── edit-requests.js
│           ├── permissions.js
│           └── shared/
├── backend/
│   ├── Code.gs
│   ├── config.gs
│   ├── helpers.gs
│   ├── script-cache.gs
│   ├── settings.gs
│   ├── sheets.gs
│   ├── auth.gs
│   ├── router.gs
│   ├── actions.gs
│   └── README.txt
└── tests/
    └── interactions.test.mjs
```

## קבצים מרכזיים

### Frontend

- `index.html`  
  נקודת הכניסה. טוען את ה־manifest, את ה־CSS הראשי, ואת `frontend/src/main.js`.

- `frontend/src/config.js`  
  קובע את כתובת ה־API.  
  סדר העדיפויות הוא:
  1. `window.__DASHBOARD_CONFIG__.apiUrl`
  2. `?apiUrl=...`
  3. `DEFAULT_API_URL`

- `frontend/src/api.js`  
  שכבת קריאות ה־API. כוללת retry לקריאות read, invalidation ממוקד אחרי mutations, ותרגום שגיאות לממשק.

- `frontend/src/main.js`  
  app shell, routing, cache מסכים, instant restore, background refresh, prefetch, service worker registration, skeleton loading.

- `frontend/src/state.js`  
  state גלובלי, token/session, route נוכחי, client settings, ו־screen cache.

- `frontend/src/styles/main.css`  
  כל ה־design system: tokens, shell, cards, tables, drawers, chips, calendar, skeleton loading, ועוד.

### Backend

- `backend/Code.gs`  
  entrypoint של Apps Script. כולל `doGet`, `doPost`, וגם `keepWarm()`.

- `backend/router.gs`  
  ניתוב פעולות API והרשאות גישה למסכים.

- `backend/actions.gs`  
  לוגיקת הנתונים המרכזית של המערכת.

- `backend/config.gs`  
  הגדרות מערכת, כולל `SPREADSHEET_ID`, שמות גיליונות, ו־TTL של caches.

- `backend/README.txt`  
  הוראות Apps Script מפורטות להעלאה, פריסה, trigger חימום, smoke tests ועוד.

## מסכי המערכת בפועל

המסכים שמוגדרים ב־frontend כרגע הם:

- `dashboard`
- `activities`
- `week`
- `month`
- `exceptions`
- `finance`
- `instructors`
- `instructor-contacts`
- `contacts`
- `end-dates`
- `my-data`
- `operations`
- `edit-requests`
- `permissions`

ה־backend ממפה actions למסכים תואמים, והגישה לכל מסך נבדקת גם לפי route וגם לפי role/permissions.

## מקורות הנתונים ב־Google Sheets

המערכת מצפה לגיליונות הבאים:

- `data_short`
- `data_long`
- `activity_meetings`
- `permissions`
- `settings`
- `lists`
- `contacts_instructors`
- `contacts_schools`
- `edit_requests`
- `operations_private_notes`

אם גיליון נדרש חסר, `handleGet_()` יחזיר סטטוס `missing_sheets`.

## הגדרת API URL

מקור האמת ב־frontend הוא `frontend/src/config.js`.

אפשר להגדיר API URL בשלוש דרכים:

### 1. runtime config
מומלץ לייצור כאשר רוצים להחליף endpoint בלי לשנות קוד:

```html
<script>
  window.__DASHBOARD_CONFIG__ = {
    apiUrl: 'https://script.google.com/macros/s/.../exec'
  };
</script>
```

את הסקריפט הזה יש לשים לפני טעינת `frontend/src/main.js`.

### 2. query param
לבדיקות:

```text
http://localhost:5000/?apiUrl=https://script.google.com/macros/s/.../exec
```

### 3. DEFAULT_API_URL
ברירת המחדל שנמצאת בתוך `frontend/src/config.js`.

## הרצה מקומית

אין כאן build step חובה. זה אתר סטטי עם מודולים.

### אפשרות פשוטה

```bash
npx serve . -l 5000
```

או:

```bash
python -m http.server 5000
```

ואז לפתוח:

```text
http://localhost:5000
```

## בדיקות

יש כרגע test suite מבוסס `node:test` + `jsdom`.

### התקנה

```bash
npm install
```

### הרצת בדיקות

```bash
npm test
```

כרגע `package.json` כולל:

- `type: module`
- script של `npm test`
- תלות `jsdom`

הבדיקות הקיימות בודקות בעיקר את שכבת `interactions.js`, כולל פתיחה/סגירה של drawer ו־modal.

## פריסת Frontend

ה־frontend נבנה כאתר סטטי.

כדי לפרוס:

1. ודאו שהקבצים המעודכנים נמצאים ב־repo
2. ודאו ש־`frontend/src/config.js` מצביע ל־Web App הנכון, או השתמשו ב־runtime config
3. אם שיניתם קבצי shell/JS/CSS משמעותיים, העלו את `CACHE_VERSION` ב־`sw.js`
4. בצעו deploy של האתר הסטטי

## פריסת Backend ל־Apps Script

המקור לפריסה הוא `backend/*.gs`.

### סדר עבודה מומלץ

1. פתחו פרויקט Apps Script
2. העתיקו את כל הקבצים מתוך `backend/`
3. ודאו ש־`Code.gs` כולל:
   - `doGet`
   - `doPost`
   - `keepWarm`
4. עדכנו את `CONFIG.SPREADSHEET_ID` ב־`backend/config.gs`
5. בצעו Deploy כ־Web App
6. העתיקו את כתובת `/exec`
7. עדכנו את ה־frontend

### Warmup trigger

יש תמיכה בפונקציית `keepWarm()` שמבצעת warming בלבד, בלי כתיבה.

מומלץ להגדיר trigger:

- Event source: Time-driven
- Every 10 minutes

## Cache וביצועים

המערכת כוללת כמה שכבות שיפור ביצועים:

### Backend

- Script cache
- TTL כללי ב־`CONFIG.SCRIPT_CACHE_SECONDS`
- TTL ייעודי ל־meetings map דרך `MEETINGS_MAP_CACHE_SECONDS`
- read cache ל־actions קריאים
- request-level cache
- warmup function (`keepWarm()`)

### Frontend

- `inflightRequests` למניעת קריאות כפולות
- `screenDataCache`
- persist ל־localStorage
- instant restore למסלולים ו־cache
- background refresh
- prefetch למסכים נפוצים
- invalidation ממוקד אחרי mutations
- skeleton loading
- debounce במסכי week/month

## ניווט וממשק

### Desktop

- sidebar קבוע מימין
- shell כהה
- אזור תוכן בהיר
- כותרת עליונה
- header quick-nav למשתמשים רלוונטיים

### Mobile

- drawer צד ימין
- backdrop
- כפתור hamburger
- סגירה דרך backdrop / Escape / מעבר מסך

## PWA

המערכת כוללת:

- `frontend/public/manifest.json`
- `sw.js`
- app shell precache
- אייקונים מתוך `frontend/assets/pwa/`

כאשר משנים shell או assets חשובים:

1. לעדכן `CACHE_VERSION`
2. לפרוס מחדש
3. לבצע רענון קשיח בדפדפן במידת הצורך

## פעולות API עיקריות

ה־backend תומך כרגע בפעולות:

- `login`
- `bootstrap`
- `dashboard`
- `activities`
- `activityDetail`
- `week`
- `month`
- `exceptions`
- `finance`
- `financeDetail`
- `instructors`
- `instructorContacts`
- `contacts`
- `endDates`
- `myData`
- `operations`
- `operationsDetail`
- `editRequests`
- `permissions`
- `addActivity`
- `saveActivity`
- `submitEditRequest`
- `reviewEditRequest`
- `savePermission`
- `addUser`
- `deactivateUser`
- `reactivateUser`
- `deleteUser`
- `savePrivateNote`
- `saveFinanceRow`
- `syncFinance`
- `listSheets`


## תפעול snapshot מקצה לקצה (Apps Script + Sheets)

נוסף סקריפט תפעולי להרצה ידנית מקצה לקצה: `scripts/apps_script_snapshot_ops.mjs`.

### דרישות

- `GOOGLE_OAUTH_ACCESS_TOKEN`
- `GAS_SCRIPT_ID`
- `SPREADSHEET_ID`

אופציונלי לאימות idempotency מורחב:

- `SNAPSHOT_REFRESH_RUNS` (ברירת מחדל: `5`)
- `SYNC_ACTIVE_PROJECT` (ברירת מחדל: `true`, מסנכרן את קבצי `backend/*.gs` לפרויקט Apps Script הפעיל לפני האימות)

אופציונלי ל-redeploy של Web App פעיל:

- `REDEPLOY_WEBAPP=true`
- `WEBAPP_DEPLOYMENT_ID=<deployment id>`

### הרצה

```bash
GOOGLE_OAUTH_ACCESS_TOKEN=... \
GAS_SCRIPT_ID=... \
SPREADSHEET_ID=... \
node scripts/apps_script_snapshot_ops.mjs
```

הסקריפט מבצע:
1. סנכרון `backend/*.gs` לפרויקט Apps Script הפעיל (אם `SYNC_ACTIVE_PROJECT` לא מכובה).
2. הרצת `refreshDashboardSnapshots` מספר פעמים רצופות (ברירת מחדל: 5).
3. אימות שאין כפילויות:
   - `dashboard_summary_snapshot`: שורה אחת לכל `month_ym`
   - `dashboard_by_manager_snapshot`: שורה אחת לכל `snapshot_key`
   - `dashboard_refresh_control`: שורה אחת לכל `key`
4. אימות שאין גידול שורות בין ריצות.
5. בדיקה שמספר ה-triggers עבור `refreshDashboardSnapshotsTrigger` אינו גדול מ-1.
6. redeploy (אם הופעל בדגלים המתאימים).

## תחזוקה נכונה

### כשמחליפים URL של Apps Script
לא מפזרים URL בקבצים שונים. משנים רק ב־`frontend/src/config.js`, או מגדירים runtime config.

### כשמשנים schema בגיליונות
צריך לעדכן לפי הצורך:

- `backend/actions.gs`
- `backend/sheets.gs`
- mappings למסכים הרלוונטיים

### כשמשנים קבצי shell / CSS / shared JS
בודקים:

- `sw.js`
- `manifest.json`
- רענון cache בדפדפן

### כשמשנים הרשאות/מסכים
בודקים גם:

- `backend/router.gs`
- `backend/auth.gs`
- `frontend/src/main.js`
- `frontend/src/state.js`

## Smoke checklist אחרי deploy

### Backend
- `doGet` מחזיר `ready`
- `doPost` פועל
- כל הגיליונות הנדרשים קיימים
- `login` עובד
- `bootstrap` מחזיר routes + profile + client settings

### Frontend
- טעינת login
- מעבר למסכים
- drawer/modal פועלים
- פעילויות נפתחות
- שבוע/חודש נטענים
- service worker נרשם
- manifest נטען
- אין שגיאות API בסיסיות

## קבצים שכדאי לא לשכוח

- `README.md` — תיעוד ראשי של הריפו
- `backend/README.txt` — תיעוד מפורט ל־Apps Script
- `frontend/src/config.js` — כתובת API
- `backend/config.gs` — Spreadsheet ID + caches
- `sw.js` — app shell cache
- `package.json` — בדיקות Node

## הערה חשובה

הקובץ `backend/README.txt` עדיין חשוב גם אם יש README ראשי.  
ה־README הראשי צריך להסביר את התמונה המלאה של המערכת, אבל `backend/README.txt` עדיין משמש כתיעוד פרקטי מפורט לפריסת Apps Script, triggers, ורשימת smoke tests.

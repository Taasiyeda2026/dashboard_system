# Dashboard Taasiyeda

מערכת ניהול פנימית מבוססת Supabase + Vanilla JS, עם ממשק RTL בעברית ותמיכה ב-PWA.

> **הערה:** המערכת עברה מהגרה מלאה מ-Google Apps Script ל-Supabase. תיקיית `OLD-GAS/` שומרת את קבצי ה-GAS לצורכי ארכיב בלבד — אין להם שימוש פעיל.

---

## ארכיטקטורה

- **Frontend:** Vanilla JS עם ES Modules, בנוי ב-Vite, מוגש כאתר סטטי מ-`dist/`
- **Backend / נתונים:** Supabase (PostgreSQL + Auth)
- **PWA:** `manifest.json` + `sw.js` עם precache
- **בדיקות דפדפן:** Playwright עם Chromium זמין לבדיקה ידנית לפי צורך; בדיקות דפדפן כבדות אינן רצות אוטומטית בכל Pull Request

כל הקריאות, לקריאה ולכתיבה, מתבצעות ישירות מה-frontend ל-Supabase דרך `frontend/src/api.js`.

---

## הרצה מקומית ופריסה

מקור האמת להרצה ולפריסה הוא פלט ה-build בתיקיית `dist/`. אין להגיש את ה-root ישירות כאתר הייצור.

```bash
npm install
npm run build
npx serve dist -l 5000
```

ב-Replit, workflow **"Start application"** מריץ `npm run build` ואז מגיש את `dist/`. גם Static Deployment מוגדר להריץ `npm run build` ולפרסם את `dist/`, כדי למנוע מצב שבו קוד המקור התעדכן אבל האתר מציג פלט build ישן או קבצים מה-root.

---

## מבנה הריפו

```text
.
├── .github/workflows/
│   ├── basic-pr-check.yml             ← בדיקה אוטומטית קלה לקבצים שהשתנו בכל PR אל main
│   └── deploy.yml                     ← build ופריסה ל-GitHub Pages לאחר שינוי ב-main
├── e2e/
│   ├── tests/                         ← בדיקות מסכים, פעולות וביצועים להרצה ידנית לפי צורך
│   ├── helpers/                       ← ניווט, ניטור רשת, מדידה וכלי עזר
│   ├── smoke/                         ← בדיקות האתר החי להרצה ידנית
│   ├── baselines/                     ← baseline ביצועים מחויב לריפו
│   └── artifacts/                     ← דוחות וראיות מקומיות, לא נשמרים ב-Git
├── frontend/
│   ├── src/
│   │   ├── api.js                     ← כל הקריאות ל-Supabase
│   │   ├── main.js                    ← app shell, routing, login
│   │   ├── state.js
│   │   ├── supabase-client.js         ← אתחול Supabase
│   │   ├── config.js                  ← legacy (GAS URL) — לא בשימוש
│   │   ├── styles/main.css
│   │   └── screens/                   ← קובץ אחד לכל מסך
│   └── sw.js                          ← Service Worker, כולל CACHE_VERSION
├── scripts/select-e2e-scope.mjs       ← כלי עזר לבחירת היקף בדיקות E2E כאשר מריצים אותן ידנית
├── dist/                              ← פלט ה-build שמוגש בייצור
├── tests/                             ← Node test-runner ובדיקות helpers
├── supabase/migrations/               ← קבצי SQL להרצה ידנית ב-Supabase
├── docs/proposal-print-layout.md      ← הדפסת/PDF הצעות מחיר: מה לא להחזיר ואיך לבדוק
└── OLD-GAS/                           ← ארכיב בלבד, קבצי Apps Script ישנים
```

---

## טבלאות Supabase

| טבלה | תוכן |
|---|---|
| `activities` | מקור האמת היחיד לפעילויות — נטען ידנית מ-`activities_system_ready.csv`, `row_id` הוא המזהה הייחודי |
| `contacts_instructors` | אנשי קשר — מדריכים |
| `contacts_schools` | אנשי קשר — בתי ספר |
| `lists` | רשימות dropdown |
| `edit_requests` | בקשות עריכה |
| `operations_private_notes` | הערות תפעול פרטיות |
| `users` | משתמשים והרשאות |
| `settings` | הגדרות מערכת |

---

## מסכי המערכת

`dashboard` · `activities` · `week` · `month` · `exceptions` · `instructors` · `instructor-contacts` · `contacts` · `end-dates` · `my-data` · `operations` · `edit-requests` · `permissions` · `admin-settings` · `admin-lists`

---

## Service Worker

`dist/` הוא מקור האמת להרצה ולפריסה. אין להגיש את root כאתר production, כי זה עלול לעקוף את פלט ה-build ולחשוף קבצים לא מעודכנים.

לקראת פריסה של שינוי ב-JS, CSS או Service Worker (ולא כאימות מקומי אוטומטי לכל עריכה):

1. העלו את `CACHE_VERSION` ב-`frontend/sw.js` בלבד.
2. הריצו `npm run build`.
3. פרסו את `dist/`.

Root `sw.js` הוא entry בלבד שטוען את המימוש המרכזי מ-`frontend/sw.js`. אין להוסיף לו גרסת cache נפרדת.

---

## בדיקות ממוקדות ובנייה

```bash
npm run check:changed
```

ברירת המחדל היא בדיקות ממוקדות בלבד כדי לא לבזבז זמן על suite רחב או ישן:

- `npm run check:changed` — `node --check` לקבצי JS ו-MJS ששונו, כולל בדיקת מסך רלוונטית כאשר קיימת.
- `npm run check:frontend` — בדיקת syntax לכל קבצי ה-frontend.
- `npm run check:build` — build מלא באמצעות `npm run build`.
- `npm run test:all:legacy` — suite מלא של `tests/*.test.mjs`. יש להריץ רק כשמבקשים במפורש או כשמתקנים את בדיקות ה-legacy.

מדיניות עבודה: **Minimum relevant validation only.** במשימות רגילות של Cursor או Codex לא מריצים `npm run test:all:legacy` או Full Regression. בוחרים בדיקה לפי ההתנהגות ששונתה בפועל, ולא רק לפי שם קובץ או תחום. כאשר השתנו רק תרחישים בודדים בקובץ בדיקות גדול, **Prefer test-name-pattern over entire large test files when only specific scenarios changed.**

אין להריץ build לשינוי שאינו דורש build validation, ואין להריץ בדיקות עסקיות לשינוי CSS, טקסט או cache marker בלבד. שינוי DB/RPC/migration נבדק רק בבדיקות ה-DB הרלוונטיות; מרחיבים כיסוי רק בשינוי רחב או בתלות משותפת אמיתית. **No test is required when the change has no meaningful automated test coverage.** במקרה כזה אפשר להסתפק ב-`node --check`, ב-`git diff --check`, בבדיקה ידנית/ויזואלית ממוקדת, או ללא בדיקה נוספת בשינוי תיעוד בלבד.

**Do not rerun an already-passing test or suite unless relevant code changed after that run.** הכלל חל גם על subsets של הרצה שכבר עברה, syntax, build, PWA, DB, E2E ו-Quick PR checks. בסיום העבודה אפשר להריץ `npm run ci:quick` פעם אחת אם הוא רלוונטי; אין להריץ לפניו ידנית את אותם checks אלא אם הם נדרשו ל-debugging. בדוח הסיום מציינים מה נבדק, מדוע, כמה test cases הורצו, ואם הייתה הרצה חוזרת—מדוע הייתה הכרחית.

---

## בדיקות Playwright E2E וביצועים

תשתית Playwright מריצה Chromium אמיתי, מתחברת באמצעות משתמש בדיקה ייעודי ובודקת מסכים מרכזיים, ניווט, פעולות, בקשות רשת, שגיאות Console, טעינות כבדות ומדדי ביצועים.

הבדיקות האלה **אינן חלק מהבדיקה האוטומטית של כל Pull Request**. מריצים אותן ידנית רק כאשר השינוי באמת מצריך בדיקת דפדפן, Smoke או ביצועים.

בהרצה מקומית ראשונה:

```bash
npm install
npx playwright install chromium
```

פקודות זמינות:

```bash
npm run test:e2e
npm run test:e2e:smoke
npm run test:e2e:baseline
npm run test:e2e:helpers
```

- `npm run test:e2e` — מריץ את בדיקות ה-E2E ואת שער הביצועים ידנית.
- `npm run test:e2e:smoke` — מריץ Smoke מול האתר החי באופן ידני.
- `npm run test:e2e:baseline` — מודד וכותב baseline ביצועים חדש.
- `npm run test:e2e:helpers` — בודק את כלי העזר של ניטור הרשת והביצועים.

כשל בבדיקה שומר לפי הצורך דוח HTML, צילום מסך, וידאו, Trace, נתוני Network ונתוני Console תחת `e2e/artifacts/`.

### מדיניות לשינויים חדשים

- בדיקות Playwright/E2E נבחרות לפי הצורך האמיתי של השינוי ואינן ברירת מחדל לכל משימה.
- כאשר נדרשת בדיקת דפדפן, יש להעדיף תרחיש ממוקד שמכסה את ההתנהגות ששונתה.
- אין ליצור תשתית בדיקות מקבילה כאשר ניתן להרחיב את התשתית הקיימת.
- אין להחליש assertion, סף ביצועים או בדיקת רשת רק כדי להעביר בדיקה.
- אין לעדכן baseline בעקבות הרצה כושלת.
- baseline חדש נוצר רק לאחר הרצה ירוקה ובדיקה שהמדידה מייצגת התנהגות תקינה.
- אין לשמור credentials, קובצי `storageState` או ערכי Secrets בריפו או ב-artifacts.

---

## GitHub Actions

### Basic PR Check

ה-workflow `.github/workflows/basic-pr-check.yml` פועל בכל Pull Request אל `main`.

מטרתו להיות מהיר וקל בלבד:

- בודק תקינות בסיסית של ה-diff.
- מבצע בדיקת syntax רק לקובצי JavaScript שהשתנו.
- בודק JSON רק לקובצי JSON שהשתנו.
- אינו מתקין Chromium.
- אינו מריץ Playwright, E2E, בדיקות ביצועים או Stress.
- אינו מריץ build מלא או suite רחב באופן אוטומטי.

בדיקות נוספות מבוצעות רק באופן ממוקד כאשר הן באמת רלוונטיות לשינוי.

### Deploy to GitHub Pages

ה-workflow `.github/workflows/deploy.yml` פועל לאחר push אל `main` או בהפעלה ידנית. הוא מתקין dependencies, בונה את גרסת ה-production ומפרסם את `dist/` ל-GitHub Pages.

זהו workflow של פריסה ולא בדיקת PR, ולכן ה-build שבו נשאר נדרש.

### GitHub Actions Secrets

הפריסה משתמשת ב-Secrets הבאים:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MICROSOFT_CLIENT_ID`
- `VITE_MICROSOFT_TENANT_ID`
- `VITE_MICROSOFT_REDIRECT_URI`

אין לכתוב את הערכים שלהם ב-README, בקוד, בלוגים, בתגובות PR או בקובצי בדיקה.

---

## Supabase — צעדים ידניים

קובצי migration שחייבים להיות מורצים ב-Supabase SQL editor לפני שה-login יעבוד:

- `supabase/migrations/20260505_users_auth_bootstrap.sql`
- `supabase/migrations/20260505_settings_admin_config.sql`
- `supabase/migrations/20260506_create_public_activities.sql`
- `supabase/migrations/20260506_activities_single_source_cleanup.sql`

לאחר ההרצה:

1. העלו ידנית את `activities_system_ready.csv` לטבלת `public.activities` ב-Supabase.
2. הזינו משתמשים לטבלת `users` לפי השדות `user_id`, `entry_code`, `role`, `name`.
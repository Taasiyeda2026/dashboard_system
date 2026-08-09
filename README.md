# Dashboard Taasiyeda

מערכת ניהול פנימית מבוססת Supabase + Vanilla JS, עם ממשק RTL בעברית ותמיכה ב-PWA.

> **הערה:** המערכת עברה מהגרה מלאה מ-Google Apps Script ל-Supabase. תיקיית `OLD-GAS/` שומרת את קבצי ה-GAS לצורכי ארכיב בלבד — אין להם שימוש פעיל.

---

## ארכיטקטורה

- **Frontend:** Vanilla JS עם ES Modules, בנוי ב-Vite, מוגש כאתר סטטי מ-`dist/`
- **Backend / נתונים:** Supabase (PostgreSQL + Auth)
- **PWA:** `manifest.json` + `sw.js` עם precache
- **בדיקות דפדפן:** Playwright עם Chromium, בדיקות E2E, בדיקות ביצועים ו-Smoke לאחר פריסה

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
│   ├── e2e-performance-gate.yml      ← בדיקות E2E מדורגות ושער ביצועים ל-PRים אל main
│   └── e2e-post-deploy-smoke.yml     ← בדיקת Smoke לאחר פריסה ל-GitHub Pages
├── e2e/
│   ├── tests/                         ← בדיקות מסכים, פעולות וביצועים
│   ├── helpers/                       ← ניווט, ניטור רשת, מדידה וכלי עזר
│   ├── smoke/                         ← בדיקות האתר החי לאחר פריסה
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
├── scripts/select-e2e-scope.mjs       ← מיפוי קבצים שהשתנו להיקף בדיקות מתאים
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

- `npm run test:e2e` — מריץ את בדיקות ה-E2E ואת שער הביצועים.
- `npm run test:e2e:smoke` — מריץ Smoke מול האתר החי לאחר פריסה.
- `npm run test:e2e:baseline` — מודד וכותב baseline ביצועים חדש.
- `npm run test:e2e:helpers` — בודק את כלי העזר של ניטור הרשת והביצועים.

כשל בבדיקה שומר לפי הצורך דוח HTML, צילום מסך, וידאו, Trace, נתוני Network ונתוני Console תחת `e2e/artifacts/`. ב-GitHub Actions הראיות מועלות כ-artifact לתקופה מוגבלת.

### מדיניות לשינויים חדשים

בכל שינוי שמשפיע על ממשק, נתונים, ניווט, טעינה או ביצועים:

1. יש לבדוק אם קיימת בדיקת Playwright מתאימה ולעדכן אותה.
2. כאשר אין כיסוי מתאים, יש להוסיף בדיקה ממוקדת לתרחיש החדש.
3. אין ליצור תשתית בדיקות מקבילה כאשר ניתן להרחיב את התשתית הקיימת.
4. אין להחליש assertion, סף ביצועים או בדיקת רשת רק כדי להעביר CI.
5. אין לעדכן baseline בעקבות הרצה כושלת.
6. baseline חדש נוצר רק לאחר הרצה ירוקה ובדיקה שהמדידה מייצגת התנהגות תקינה.
7. אין לשמור credentials, קובצי `storageState` או ערכי Secrets בריפו או ב-artifacts.

---

## GitHub Actions לבדיקות

### E2E and Performance Gate

ה-workflow `.github/workflows/e2e-performance-gate.yml` פועל בכל Pull Request אל `main`, מזהה את הקבצים שהשתנו ובוחר אוטומטית את היקף הבדיקה:

- שינויי תיעוד וקבצים שאינם משפיעים על המערכת מסיימים בדיקה קצרה ללא Chromium וללא Playwright.
- פתיחת PR חדש שאינו Draft מריצה נקודת בדיקה מלאה אחת.
- עדכון רגיל של PR קיים מריץ בדיקות ממוקדות למסכים שהושפעו.
- מעבר מ-Draft למוכן לבדיקה או פתיחה מחדש של PR מריצים נקודת בדיקה מלאה.
- שינוי בקוד משותף, בתשתית, בבסיס הנתונים, בבדיקות או בקובץ מערכת שלא מופיע במיפוי מריץ את כל הבדיקות.
- הפעלה ידנית של ה-workflow מריצה את כל הבדיקות ויכולה לשמש גם לעדכון baseline מאושר.

מנגנון הבחירה מנוהל בקובץ `scripts/select-e2e-scope.mjs`. קובץ שאינו מזוהה כשינוי מקומי למסך מסוים נשלח כברירת מחדל להרצה מלאה.

שם בדיקת ה-status המדויק:

```text
E2E and Performance Gate / e2e-performance
```

זהו השם שיש להגדיר כ-required status check בהגנת הענף.

### E2E Post-Deploy Smoke

ה-workflow `.github/workflows/e2e-post-deploy-smoke.yml` מופעל לאחר הצלחה של `Deploy to GitHub Pages`. הוא בודק את האתר החי ומוודא שהגרסה שנפרסה תואמת ל-commit הצפוי.

### GitHub Actions Secrets

ה-workflows משתמשים ב-Secrets הבאים:

- `E2E_USERNAME`
- `E2E_PASSWORD`
- `E2E_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

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

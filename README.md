# Dashboard Taasiyeda

מערכת ניהול פנימית מבוססת Supabase + Vanilla JS, עם ממשק RTL בעברית ותמיכה ב-PWA.

> **הערה:** המערכת עברה מהגרה מלאה מ-Google Apps Script ל-Supabase. תיקיית `OLD-GAS/` שומרת את קבצי ה-GAS לצורכי ארכיב בלבד — אין להם שימוש פעיל.

---

## ארכיטקטורה

- **Frontend:** Vanilla JS עם ES Modules, בנוי ב-Vite, מוגש כאתר סטטי מ-`dist/`
- **Backend / נתונים:** Supabase (PostgreSQL + Auth)
- **PWA:** `manifest.json` + `sw.js` עם precache

כל הקריאות (קריאה וכתיבה) מתבצעות ישירות מה-frontend ל-Supabase דרך `frontend/src/api.js`.

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
├── frontend/
│   ├── src/
│   │   ├── api.js              ← כל הקריאות ל-Supabase
│   │   ├── main.js             ← app shell, routing, login
│   │   ├── state.js
│   │   ├── supabase-client.js  ← אתחול Supabase
│   │   ├── config.js           ← legacy (GAS URL) — לא בשימוש
│   │   ├── styles/main.css
│   │   └── screens/            ← קובץ אחד לכל מסך
│   └── sw.js                   ← Service Worker (CACHE_VERSION כאן)
├── dist/                       ← פלט ה-build (מוגש בייצור)
├── tests/                      ← Node test-runner (node --test tests/*.test.mjs)
├── supabase/migrations/        ← קבצי SQL להרצה ידנית ב-Supabase
└── OLD-GAS/                    ← ארכיב בלבד — קבצי Apps Script ישנים
```

---

## טבלאות Supabase

| טבלה | תוכן |
|---|---|
| `activities` | מקור האמת היחיד לפעילויות — נטען ידנית מ-`activities_system_ready.csv`; `row_id` הוא המזהה הייחודי |
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

אחרי כל שינוי ב-JS/CSS:
1. העלו את `CACHE_VERSION` ב-`frontend/sw.js`
2. הריצו `npm run build`
3. פרסו את `dist/`

---

## בדיקות

```bash
npm run check:changed
```

ברירת המחדל היא בדיקות ממוקדות בלבד כדי לא לבזבז זמן על suite רחב/ישן:

- `npm run check:changed` — `node --check` לקבצי JS/MJS ששונו, ובדיקת מסך רלוונטית אם קיימת.
- `npm run check:frontend` — בדיקת syntax לכל קבצי ה-frontend.
- `npm run check:build` — build מלא (`npm run build`).
- `npm run test:all:legacy` — suite מלא של `tests/*.test.mjs`; להריץ רק כשמבקשים במפורש או כשמתקנים את בדיקות ה-legacy.

מדיניות עבודה: במשימות רגילות של Cursor/Codex לא מריצים `npm run test:all:legacy` ולא מריצים suite מלא כברירת מחדל. מריצים בדיקות ממוקדות לפי הקבצים ששונו, ו-`npm run check:build` כאשר יש שינוי בפרונט/Service Worker/קבצי build.

---

## Supabase — צעדים ידניים

שני קבצי migration חייבים להיות מורצים ב-Supabase SQL editor לפני שה-login יעבוד:

- `supabase/migrations/20260505_users_auth_bootstrap.sql`
- `supabase/migrations/20260505_settings_admin_config.sql`
- `supabase/migrations/20260506_create_public_activities.sql`
- `supabase/migrations/20260506_activities_single_source_cleanup.sql`

לאחר ההרצה:
1. העלו ידנית את `activities_system_ready.csv` לטבלת `public.activities` ב-Supabase.
2. הזינו משתמשים לטבלת `users` (user_id, entry_code, role, name).

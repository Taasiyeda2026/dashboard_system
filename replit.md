# Dashboard-Taasiyeda — Project Memory

Hebrew RTL internal dashboard. Fully migrated to Supabase — NO Google Apps Script dependency.
Preserve: RTL, Hebrew, dark shell + light panels. Communication with user: Hebrew.

## Runtime
- Static server: `npx serve dist -l 5000` (workflow: "Start application")
- SW cache bump: edit `CACHE_VERSION` in `frontend/sw.js` after any JS/CSS change.
- **Current versions**: SW v1620 (frontend/sw.js; dist/ service-worker copies synchronized; dist bundle is rebuilt by the deploy/build pipeline)

## User preferences

### כלל SW/CACHE — חובה בכל תיקון Frontend
**נקודת בסיס: v1400. כל גרסה עתידית חייבת להיות גבוהה ממנה (1401, 1402, ...).**
- מקור האמת היחיד: `frontend/sw.js` — `const CACHE_VERSION = NNN`
- אסור להחזיר מספר אחורה לעולם (1300/1330 אסורים)
- dist/sw.js הראשי הוא loader בלבד; אין בו CACHE_VERSION עצמאי

בכל שינוי JS/CSS/HTML חובה לבצע בסיום:
1. `sed -i 's/CACHE_VERSION = NNN/CACHE_VERSION = NNN+1/' frontend/sw.js`
2. `npm run build` (מהתיקייה הראשית)
3. `cp frontend/sw.js dist/sw.js && cp frontend/sw.js dist/frontend/sw.js`
4. לוודא שאין CACHE_VERSION נמוך מהגרסה החדשה בשום קובץ פעיל
5. לעדכן "Current versions" ב-replit.md
6. `gitPush({})` דרך CodeExecution
7. להפעיל מחדש את workflow "Start application"

**קבצים שמחייבים cache bump:**
- `frontend/src/screens/*.js`
- `frontend/src/styles/*.css`
- `frontend/src/api.js`
- `frontend/src/main.js`
- `frontend/src/config.js`
- כל קובץ UI / layout / CSS / תבנית שנטענת בדפדפן

**קבצים שלא מחייבים cache bump:**
- README / MD בלבד
- tests בלבד
- migrations SQL בלבד
- קבצי שרת שאינם נטענים בדפדפן

**בסיום כל תיקון Frontend לדווח:**
- האם עודכן SW/CACHE (גרסה לפני → אחרי)
- האם הורץ build
- אילו קבצי dist השתנו
- האם צריך hard refresh (Ctrl+Shift+R)

## Key identifiers
- Supabase URL: `https://szinlhjuwyiyszdpsdop.supabase.co` (anon key in `frontend/src/supabase-client.js`)
- GAS URL in `frontend/src/config.js` — **legacy, no longer used**

## Test suite
- `node --test tests/*.test.mjs`
- Baseline: 92 pass / 5 fail (pre-existing jsdom-missing failures, unrelated to app logic)

## Architecture
- `frontend/src/api.js` — ALL reads & writes go directly to Supabase. `request()` throws `legacy_gas_api_disabled`.
- `frontend/src/main.js` — app shell, routing, login
- `frontend/src/screens/` — one file per screen
- `OLD-GAS/*.gs` — Google Apps Script (legacy, archived — NOT in use)
- `tests/*.test.mjs` — Node test-runner tests

## Supabase tables
| Table | Contents |
|---|---|
| `data_long` | Long-program activities (source of truth) |
| `data_short` | Short/one-day activities |
| `activity_meetings` | Per-meeting dates for long programs; `meeting_date` = calendar date |
| `contacts_instructors` | Instructor contacts |
| `contacts_schools` | School contacts |
| `lists` | Dropdown option lists |
| `edit_requests` | Edit-request workflow |
| `operations_private_notes` | Private ops notes |
| `users` | Auth/permissions (replaces GAS permissions sheet) ⚠️ SQL pending |
| `settings` | App config / sheet mappings ⚠️ SQL pending |

## ⚠️ Pending manual step — run in Supabase SQL editor
Migration files to apply (in order):
- `supabase/migrations/20260505_users_auth_bootstrap.sql`
- `supabase/migrations/20260505_settings_admin_config.sql`

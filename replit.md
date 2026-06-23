# Dashboard-Taasiyeda — Project Memory

Hebrew RTL internal dashboard. Fully migrated to Supabase — NO Google Apps Script dependency.
Preserve: RTL, Hebrew, dark shell + light panels. Communication with user: Hebrew.

## Runtime
- Static server: `npx serve dist -l 5000` (workflow: "Start application")
- SW cache bump: edit `CACHE_VERSION` in `frontend/sw.js` after any JS/CSS change.
- **Current versions**: SW v887 (frontend/sw.js + dist/sw.js)

## User preferences

### כלל SW/CACHE — חובה בכל תיקון Frontend
בכל שינוי בקבצים הבאים (או דומים להם), חובה לבצע בסיום:
1. `sed -i 's/CACHE_VERSION = NNN/CACHE_VERSION = NNN+1/' frontend/sw.js`
2. `cd frontend && npm run build`
3. `cp frontend/sw.js dist/sw.js`
4. לעדכן "Current versions" ב-replit.md
5. להפעיל מחדש את workflow "Start application"

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
- `supabase/migrations/20260622150000_ensure_contact_school_from_proposal_school_ids.sql`
- `supabase/migrations/20260617_fix_contact_school_id_coalesce_type.sql`  ← **תיקון COALESCE bigint/uuid**

After applying 20260505 files: seed `users` table with existing users (user_id, entry_code, role, name).

**מה עושה 20260617:** מוסיף עמודות `authority_id uuid`, `school_id uuid`, `semel_mosad text` ל-`contacts_schools`; משנה `proposals_agreements.contact_school_id` מ-uuid ל-bigint; מחדש את `proposals_agreements_directory_view` ללא קונפליקט בין bigint ל-uuid.

## API status — all Supabase-only
- **Auth**: `login`, `bootstrap` → `users` table
- **Reads**: all screens read directly from Supabase (no GAS fallback anywhere)
- **Writes**: all writes go directly to Supabase tables
- **Dead code** (safe to delete later): `syncActivityToSupabase`, `syncContactToSupabase`, `requestReadModel`, `getReadModelManifestCached`

## Supabase-only screens
- week ✅ month ✅ dashboard ✅ activities ✅ activityDetail ✅ activityDates ✅
- exceptions ✅ instructors ✅ instructorContacts ✅ contacts ✅ endDates ✅
- myData ✅ operations ✅ operationsDetail ✅ editRequests ✅ permissions ✅
- adminSettings ✅ adminLists ✅ all writes ✅

## Notable fixes (history)
1. **Data-maintenance pipeline**: `runDataMaintenance_` calls `refreshDataViews_()` early-return on view failure.
2. **Exceptions — unique card actions**: format `exception:<RowID>:<exception_type>`.
3. **week/month — Supabase-only**: GAS fallback removed.
4. **Full GAS cutover**: `request()` disabled; all 35+ api methods Supabase-only.

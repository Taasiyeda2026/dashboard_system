# הוראות מימוש לקודקס — מנגנון ביטול זמן אחיד

> **סטטוס:** מפרט מימוש לקודקס / Cursor. לא בוצע שינוי התנהגותי בקוד במסמך זה.
> **תאריך מיפוי בסיס:** 2026-10-12 (מול `main`).
> **עקרון מנחה:** המדריך מדווח את זמן הנסיעה בפועל; המערכת מחשבת את הזמן הצפוי באופן עצמאי; המנהל בודק ומאשר את ביטול הזמן לתשלום.
> **גישה:** מנגנון אחיד אחד — לא תיקונים נקודתיים למסכים. אותה מודל נתונים, אותם סטטוסים ואותו מקור אמת לכל שכבות הממשק.

קרא קודם את `AGENTS.md` ואת `docs/PROJECT_MAP.md`. אם מסמך זה והקוד חולקים — **הקוד מנצח**; עדכן את המסמך באותו שינוי.

---

## 1. כללים עסקיים מחייבים

| # | כלל | פירוט מימושי |
|---|-----|---------------|
| 1 | דיווח בכל נסיעה פיזית | בכל רשומת מקור פיזית (לא זום / לא הכשרה אונליין) המדריך יכול לדווח זמן נסיעה בפועל, **ללא תלות במרחק**. |
| 2 | חישוב אוטומטי מוסתר מהמדריך | `calculated_*` / דקות מערכת / טקסט „ביטול זמן צפוי” **לא מוצגים** בממשק המדריך (כולל הכשרת בסיס). |
| 3 | תזכורת מעל 40 ק״מ | אם מרחק הלוך־חזור (או מרחק חד־כיווני מאומת לפי אותו מקור אמת של המסלול) **> 40 ק״מ**, מוצגת תזכורת ייעודית לדיווח. השדה נשאר פתוח לעריכה תמיד. |
| 4 | זכאות = מעבר ל־45 דק׳ לכל כיוון | `eligible_minutes = max(0, outbound−45) + max(0, return−45)`. נשמר כנוסחה יחידה בשרת + helper משותף. |
| 5 | פער → בקרת מנהל | אם דיווח המדריך ≠ חישוב המערכת (לאחר נרמול לדקות שלמות), הרשומה נכנסת לתור בקרה עם **אישור / תיקון / דחייה**. |
| 6 | רק מאושר נכנס לשכר | שורת `travel_time_cancellation` / סכום לתשלום נגזרים רק מ־`approved_cancellation_minutes`. מניעת כפילויות (unique per source) + היסטוריית שינויים מלאה. |

### החלטות מוצר שנקבעו כאן (ברירת מחדל ליישום)

1. **מה מדווח המדריך:** דקות נסיעה בפועל **לכל כיוון** (`reported_outbound_minutes`, `reported_return_minutes`), לא „ביטול זמן” ישירות. ביטול הזמן נגזר מהנוסחה בשרת.
2. **מתי חובה לדווח:** דיווח אופציונלי בכל נסיעה פיזית; תזכורת חזקה מעל 40 ק״מ; **אין חסימת שליחת חודש** בגלל חוסר דיווח (שומרים על מדיניות non-blocking הקיימת מ־`20260923161300_attendance_instructor_nonblocking_travel.sql`). חוסר דיווח על נסיעה עם מרחק >40 או עם חישוב מערכת >0 מופיע בבקרת מנהל כ־`needs_guide_report` / `pending_review`.
3. **סף פער לבקרה:** כל הפרש ≠ 0 בין `reported_*` ל־`system_*` (לאחר עיגול לדקה) → `pending_review`. אין סף סובלנות אלא אם יתווסף במפורש אחר כך.
4. **אישור אוטומטי:** אם המדריך דיווח ואין פער מול המערכת — סטטוס `auto_matched` והערך המאושר = חישוב הזכאות מהדיווח (שזהה למערכת). אם אין דיווח מדריך וחישוב המערכת = 0 — אין שורת תשלום ואין בקרה.
5. **דחייה:** `approved_cancellation_minutes = 0`, נשמרת סיבת מנהל, נוצרת רשומת audit; שורת generated נמחקת / לא נוצרת.
6. **תיקון מנהל:** המנהל יכול לערוך את הדקות המאושרות (או את outbound/return המאושרים); זה כותב `manually_set` + audit ולא דורס את דיווח המדריך או את חישוב המערכת.

---

## 2. מיפוי מצב קיים (קוד)

### 2.1 מקור אמת נוכחי

| שכבה | נתיב | תפקיד היום |
|------|------|------------|
| טבלה | `attendance_travel_compensations` | סטטוס חישוב, fingerprint מסלול, outbound/return מערכת, `calculated_cancellation_minutes`, `final_cancellation_minutes`, override ידני |
| שורת תשלום | `attendance_records` עם `generation_kind='travel_time_cancellation'` | שורה ייחודית ל־source; שעות = `final/60`; clocks null |
| הקשר מסלול | `av2_attendance_travel_context` / `av2_prepare_attendance_travel` | קובע eligible לפי סוג פעילות + כתובות קנוניות |
| חישוב מסלול | Edge `attendance-travel-compensation` | Google Routes / cache → `av2_reconcile_attendance_travel` |
| נוסחה | `calculateTravelCancellationMinutes` + SQL `greatest(0,x-45)+…` | כבר תואמת כלל 4 |
| Override מדריך | `av2_override_attendance_time_cancellation` | המדריך יכול לשנות `final_cancellation_minutes` ולראות את האוטומטי |
| מנהל | `frontend/src/screens/attendance-control.js` | מציג השוואה final מול calculated; תיקון דרך שדות מנהל / sync ל־compensation |
| שליחת חודש | `av2_submit_attendance_month` | **לא** חוסם על travel pending |

### 2.2 פערים מול היעד

| כלל | מצב היום | נדרש |
|-----|----------|------|
| 1 | חישוב אוטומטי בלבד; דיווח מדריך = override של ביטול זמן | דיווח זמן נסיעה בפועל כשדה ראשון־מעלה |
| 2 | מוצג למדריך (my-reports, followup runtime, base-training preview עם „ביטול זמן צפוי”) | הסתרה מלאה של חישוב מערכת בממשק מדריך |
| 3 | אין תזכורת 40 ק״מ בביטול זמן | תזכורת לפי מרחק מסלול / `roundtrip_km` / cache |
| 4 | מיושם | לשמור כ־single source; לא לשכפל נוסחאות סותרות |
| 5 | Override מדריך / תיקון מנהל בלי workflow אישור־דחייה מפורש | סטטוסי review + פעולות approve/correct/reject |
| 6 | `final_cancellation_minutes` נכנס לתשלום גם בלי אישור מנהל על פער | רק `approved_*`; audit history |

### 2.3 קבצים מרכזיים שיש לגעת בהם (רשימת עבודה)

**DB / RPC**

- `supabase/migrations/20260908100000_attendance_travel_compensation.sql` (בסיס — לא לערוך; migration חדשה)
- הרחבות מאוחרות: `20260922162526_*`, `20260923161300_*`, `20260929120000_*`, `20260927025000_*`, `20260927153000_*` / `20260930103000_*`
- Edge: `supabase/functions/attendance-travel-compensation/index.ts`
- Edge preview: `supabase/functions/attendance-base-training-routes/` (אם קיים) — להסיר חשיפת cancellation למדריך

**Attendance (מדריך)**

- `attendance/src/services/travel-compensation.js`
- `attendance/src/services/time-cancellation.helpers.js`
- `attendance/src/services/attendance.service.js`
- `attendance/src/screens/new-report-screen.js`
- `attendance/src/screens/my-reports-screen.js`
- `attendance/src/attendance-followup-runtime-v2.js` (+ legacy `attendance-followup-runtime.js` אם עדיין בשימוש)
- `attendance/src/components/report-summary-row.js`, `monthly-report-summary.js`, `home-screen.js`

**מנהל / אדמין / שכר**

- `frontend/src/screens/attendance-control.js`
- `frontend/src/screens/payroll-control-finish.js`
- `frontend/src/screens/finance-attendance-summary.js`
- `frontend/src/payroll-attendance-v2-bridge.js`
- RPCs של manager attendance update שכותבים ל־`final_cancellation_minutes`

**בדיקות קיימות לעדכון**

- `tests/attendance-travel-compensation.test.mjs`
- `tests/attendance-time-cancellation-online-training.test.mjs`
- `tests/attendance-control*.test.mjs`
- `tests/attendance-base-training.test.mjs`
- סיכומי finance/payroll שסופרים ביטול זמן

---

## 3. ארכיטקטורת יעד — מנגנון אחיד

```text
Source attendance (physical)
        │
        ├─► guide reports outbound/return (optional; remind if distance > 40km)
        │
        ├─► system route calc (edge, invisible to guide)
        │         └─ system_outbound / system_return / system_distance_km
        │         └─ system_cancellation = f(45)
        │
        └─► review engine (server)
                  ├─ no report + system_cancellation=0 → idle / none
                  ├─ report == system → auto_matched → approved = f(report)
                  ├─ report ≠ system → pending_review
                  ├─ manager approve → approved = f(report)
                  ├─ manager correct → approved = manager value
                  └─ manager reject → approved = 0
                            │
                            ▼
              upsert/delete generated travel_time_cancellation
              + append audit history
                            │
                            ▼
              manager month approval → admin payroll → finance summaries
              (כולם קוראים approved_* בלבד)
```

### 3.1 מודל נתונים מוצע

להרחיב את `attendance_travel_compensations` (לא לפצל טבלה מקבילה למסכים):

| עמודה חדשה / מורחבת | משמעות |
|---------------------|---------|
| `reported_outbound_minutes` | דיווח מדריך הלוך (nullable) |
| `reported_return_minutes` | דיווח מדריך חזור (nullable) |
| `reported_at` / `reported_by` | מטא־דאטה דיווח |
| `system_outbound_minutes` | שם ברור ל־outbound הקיים או rename לוגי |
| `system_return_minutes` | כנ״ל |
| `system_distance_km` | לשימוש בתזכורת 40 ק״מ ובבקרה |
| `system_cancellation_minutes` | = calculated הקיים |
| `review_status` | `none` \| `awaiting_report` \| `auto_matched` \| `pending_review` \| `approved` \| `corrected` \| `rejected` |
| `approved_cancellation_minutes` | **מקור האמת לתשלום** (מחליף שימוש ישיר ב־`final_cancellation_minutes`) |
| `review_by` / `review_at` / `review_note` | החלטת מנהל |

שמירה לאחור:

- להשאיר `final_cancellation_minutes` כ־generated/compat column שמסונכרן מ־`approved_cancellation_minutes` במשך תקופת מעבר, או למפות את כל הקוראים ל־`approved_*` באותה migration.
- `manually_overridden` הקיים הופך לנגזרת של `review_status in ('corrected')` או נשמר לצד review.

טבלת היסטוריה חדשה (חובה לפי כלל 6):

```text
attendance_travel_compensation_events
  id, source_attendance_record_id, emp_id,
  event_type (reported|system_calculated|auto_matched|approved|corrected|rejected|regenerated|cleared),
  actor_user_id, actor_role,
  before_json, after_json,
  note, created_at
```

אינדקס על `(source_attendance_record_id, created_at)`.

### 3.2 חוזה RPC אחיד (לא APIs נפרדים לכל מסך)

| RPC / Edge | אחריות |
|------------|---------|
| `av2_report_attendance_travel_time(source_id, outbound, return)` | כתיבת דיווח מדריך; חישוב זכאות מדווח; עדכון `review_status`; **לא** מחזיר למדריך את ערכי המערכת |
| `av2_prepare_attendance_travel` + edge | ללא שינוי עקרוני באמון כתובות; כותב system_* בלבד; מעדכן review |
| `av2_review_attendance_travel_compensation(source_id, decision, approved_minutes?, note?)` | `approve` \| `correct` \| `reject`; רק manager/admin מתאים לצוות; כותב approved + audit + sync generated row |
| `av2_override_attendance_time_cancellation` | **לצמצם / להחליף**: מדריך לא מאשר לעצמו תשלום; override מדריך הישן מוחלף ב־report RPC |

שורה generated:

- נוצרת/מתעדכנת רק כאשר `approved_cancellation_minutes > 0`
- נמחקת כאשר 0 / rejected / not applicable
- נשמר unique על `source_attendance_record_id`
- כתיבה רק תחת `app.av2_compensation_write`

### 3.3 ממשקים — התאמה אחידה

**מדריך (`attendance/`)**

- שדות דיווח outbound/return בכל טופס נסיעה פיזית (חדש + עריכה + followup).
- תזכורת 40 ק״מ: טקסט קצר ליד השדה; לא חוסם שמירה.
- אסור להציג: דקות מערכת, „ביטול זמן צפוי”, „חזור לחישוב האוטומטי”, השוואת פער.
- מותר להציג: מה שדווח, וסטטוס ידידותי („נשלח לבקרה” / „נרשם”) בלי לחשוף את חישוב המערכת.

**מנהל (`attendance-control.js`)**

- תור/פילטר: `pending_review` + `awaiting_report` (למשל מעל 40 ק״מ או system_cancellation>0 בלי דיווח).
- כרטיס השוואה אחיד: דיווח מדריך | חישוב מערכת | מאושר | פעולות.
- אותן פעולות ב־drilldown חודשי ובאישור רשומה — קוראות ל־RPC הביקורת בלבד.

**אדמין / סיום שכר / פיננסים**

- סיכומי „ביטול זמן” = סכום `approved_cancellation_minutes` / שורות generated מסונכרנות.
- אין מסלול עוקף שמכניס `calculated` או `reported` ישירות לשכר.

---

## 4. טיפול ברשומות היסטוריות

Migration נתונים באותו שינוי schema (או מיד אחריו), בקבוצות idempotent:

### 4.1 חודשים שכבר אושרו לשכר (`approved_for_payroll` / admin approved)

- **Freeze:** לא לחשב מחדש מסלולים.
- Map: `approved_cancellation_minutes = final_cancellation_minutes` הקיים.
- `review_status = 'approved'` אם היה final>0, אחרת `none`.
- `reported_*` נשארים null אם לא היו; לרשום event `migrated_legacy_payroll_freeze`.
- שורות generated קיימות נשארות; אין מחיקה.

### 4.2 חודשים בסטטוס `manager_approved` / `submitted` / פתוחים

- Map ראשוני כמו למעלה מ־`final`→`approved` כדי לא לשבור תצוגה.
- אם `manually_overridden = true` ו־`final ≠ calculated`: `review_status='corrected'` + event מתוך override הישן.
- אם `final = calculated` ו־final>0: `review_status='auto_matched'` (או `approved` אם כבר עבר מנהל חודשי) — **לא** לחשוף רטרואקטיבית את החישוב למדריך.
- חודשים פתוחים לעריכת מדריך: אחרי deploy, דיווח חדש עובר למודל החדש; reconciliation מחדש של system_* מותר רק לחודשים לא נעולים.

### 4.3 רשומות `unavailable` / `pending`

- נשארות; review_status=`awaiting_report` או `none` לפי system.
- אין יצירת תשלום עד resolve+approve.

### 4.4 כפילויות

- לוודא לפני/אחרי: לכל source לכל היותר שורת `travel_time_cancellation` אחת (אינדקס קיים).
- סקריפט בדיקה: sources עם יותר מילד אחד / ילד בלי compensation / compensation עם final>0 בלי ילד.

### 4.5 מה לא לעשות בהיסטוריה

- לא למחוק overrides ישנים בלי event.
- לא לסמן wholesale את כל העבר כ־`pending_review` (יוצר צוואר בקבוק מנהלים).
- לא להריץ Google Routes מחדש על חודשי payroll סגורים.

---

## 5. שלבי מימוש מומלצים לקודקס

בצע לפי הסדר. כל שלב = commit לוגי נפרד כשאפשר.

### שלב A — Schema + review engine (שרת בלבד)

1. Migration: עמודות חדשות, טבלת events, constraints על `review_status`.
2. פונקציית נוסחה יחידה ב־SQL (או שימוש חוזר בביטוי הקיים) + בדיקת זהות ל־JS helper.
3. `av2_report_attendance_travel_time`, `av2_review_attendance_travel_compensation`.
4. עדכון `av2_reconcile_attendance_travel` כך שיכתוב system_* ויעדכן review **בלי** להעתיק אוטומטית ל־approved כשיש פער/דיווח חסר רלוונטי.
5. Backfill היסטורי לפי §4.
6. בדיקות SQL/חוזה ממוקדות.

### שלב B — Edge + helpers משותפים

1. Edge מחזיר/כותב מרחק + זמני מערכת; לא משנה חוזה האמון (אין הזרקת כתובות מהלקוח).
2. Helper משותף לתזכורת 40 ק״מ ולסטטוסים (אפשר מודול ב־`attendance/src/services/` + שימוש מקביל ב־frontend דרך bridge/copy מינימלי — להימנע משכפול לוגיקת review).
3. הסרת/חסימת override מדריך הישן או הפנייתו ל־report RPC.

### שלב C — ממשק מדריך

1. שדות דיווח ב־new/edit/followup.
2. הסתרת כל חישוב אוטומטי (כולל base training preview).
3. תזכורת >40 ק״מ.
4. Cache markers: `HOTFIX_VERSION` + `CACHE_VERSION` אם יש deployable frontend/attendance assets לפי `AGENTS.md`.

### שלב D — ממשק מנהל / אדמין / שכר

1. תור בקרה + פעולות approve/correct/reject.
2. השוואת פרמטרים אחידה.
3. סיכומי payroll/finance על approved בלבד.
4. שמירה על איסור עריכת שורת generated ישירות מחוץ ל־RPC.

### שלב E — בדיקות מלאות לפני פריסה

ראה §6. אין פריסה בלי מעבר הרשימה.

---

## 6. תוכנית בדיקות לפני פריסה

### 6.1 אוטומטי (חובה)

הרץ רק מה שרלוונטי אחרי השינוי; לפי `AGENTS.md` — pattern ממוקד, בלי `test:all:legacy` אלא אם התבקש.

| תחום | מקרי חובה |
|------|-----------|
| נוסחה | 45/45→0; 60/45→15; 30/100→55; ערכי גבול |
| דיווח מדריך | שמירה outbound/return; אין החזרת system_* בתשובת RPC למדריך |
| תזכורת 40 | distance 40.1 מציג תזכורת; 39.9 לא; שדה תמיד editable |
| פער | report≠system ⇒ `pending_review`; אין generated עד החלטה |
| התאמה | report=system ⇒ `auto_matched` + generated לפי זכאות |
| מנהל | approve/correct/reject + event לכל פעולה |
| כפילויות | unique child; reject מוחק child; correct מעדכן hours |
| היסטוריה | backfill freeze לחודש payroll; events קיימים |
| Online/Zoom | לא eligible; אין שדות דיווח נסיעה |
| Non-blocking | submit חודש לא נכשל על pending travel |
| Finance/payroll | סיכום ביטול זמן = approved בלבד |

קבצי בדיקה לעדכון/הרחבה: הרשימה ב־§2.3. הוסף קובץ חדש ממוקד אם נוח יותר, למשל `tests/attendance-travel-review-workflow.test.mjs`.

### 6.2 ידני / E2E לפני פריסה (חובה לשינוי זה)

1. מדריך: דיווח נסיעה קצרה (<40 ק״מ) עם/בלי דיווח זמן — אין חשיפת חישוב מערכת.
2. מדריך: נסיעה >40 ק״מ — תזכורת + אפשרות לשמור בלי דיווח.
3. פער מכוון — מופיע אצל מנהל כ־pending_review.
4. מנהל מאשר / מתקן / דוחה — השכר/סיכום החודש משתנים רק אחרי approved.
5. אדמין מאשר חודש — ה־PDF/snapshot כולל רק ביטול זמן מאושר.
6. רגרסיית הכשרת בסיס: אין „ביטול זמן צפוי” במסך מדריך.
7. רשומת היסטוריה בחודש סגור לשכר — ללא שינוי סכומים אחרי migration.

### 6.3 Checklist פריסה

- [ ] Migration יושמה על staging ו־backfill נבדק (ספירות before/after)
- [ ] Edge function עודכן ופורסם יחד עם ה־RPC
- [ ] `HOTFIX_VERSION` / `CACHE_VERSION` עודכנו אם נדרש
- [ ] בדיקות §6.1 עברו אחרי השינוי האחרון
- [ ] בדיקות §6.2 תועדו (מי / סביבה / תוצאה)
- [ ] אין שימוש נותר ב־UI מדריך ב־`calculated_cancellation_minutes` / „חזור לחישוב האוטומטי” לתשלום
- [ ] Rollback plan: feature flag או אפשרות לקרוא `final_cancellation_minutes` הישן אם approved null בלבד ב־hotfix חירום

---

## 7. מחוץ לתחום

- שינוי נוסחת 45 הדקות.
- שינוי מגבלות שיבוץ 40/60 ק״מ במנוע השיבוצים (כלל 3 כאן הוא **תזכורת דיווח נוכחות בלבד**).
- Rewrite של מסך בקרת הנוכחות.
- חיבור מחדש של blocking submit על travel.
- סריקת `attached_assets/`, `dist/`, ארכיונים.

---

## 8. קריטריוני קבלה

1. מדריך יכול לדווח זמן נסיעה בפועל בכל נסיעה פיזית, בלי לראות את חישוב המערכת.
2. מעל 40 ק״מ מוצגת תזכורת; השדה נשאר פתוח.
3. זכאות תמיד לפי מעבר ל־45 דק׳ לכל כיוון.
4. כל פער עובר למנהל עם approve/correct/reject.
5. רק `approved_cancellation_minutes` מזין שורת תשלום / סיכומי שכר, בלי כפילויות.
6. כל שינוי review/report/system־material נרשם ב־`attendance_travel_compensation_events`.
7. חודשי payroll סגורים לא משנים סכומים אחרי backfill.
8. מדריך, מנהל, אדמין ודוחות שכר חולקים אותו חוזה סטטוסים.

---

## 9. הנחיית פתיחה לקודקס (העתק־הדבק)

```text
Implement the unified attendance travel-time-cancellation mechanism described in
docs/attendance-time-cancellation-unified-implementation.md.

Follow AGENTS.md testing policy (minimum relevant tests only; no legacy full suite).
Do not show system travel estimates to instructors.
Instructors report actual outbound/return minutes; system calculates independently;
managers approve/correct/reject gaps; only approved minutes enter payroll.
Keep one shared review engine (RPC + attendance_travel_compensations), not per-screen forks.
Include historical backfill per §4 and complete §6 checks before claiming done.
After deployable frontend/attendance changes, bump HOTFIX_VERSION and CACHE_VERSION.
```

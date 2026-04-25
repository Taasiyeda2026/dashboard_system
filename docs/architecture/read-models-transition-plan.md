# תוכנית מעבר מדורגת ל־Read Models / Snapshots (Documentation Only)

> סטטוס: **מסמך תיעוד מחייב בלבד**.
>
> בגבולות מסמך זה: **ללא שינויי קוד**, ללא snapshots בפועל, ללא שינוי API, ללא שינוי frontend, ללא שינוי UI/עיצוב, ללא שינוי הרשאות.

---

## 1) מטרה ועקרונות מחייבים

### מטרה
להעביר את המערכת בצורה **מדורגת ובטוחה** למודל שבו:
- גיליונות המקור (Google Sheets) נשארים **Source of Truth**.
- כתיבה מתבצעת רק למקור האמת ובהתאם להרשאות.
- מסכי קריאה נטענים מ־read models/snapshots מוכנים מראש.
- סינון וחיפוש מתבצעים ב־frontend בלבד.
- רענון snapshots מתבצע לפי Trigger מתוזמן ו/או אחרי שינוי רלוונטי.

### מגבלות קשיחות (Non-Negotiable)
1. אין rewrite מלא.
2. אין שינוי UI או עיצוב.
3. אין החלפת כל המסכים יחד.
4. אין מנגנון שמאריך זמני טעינה נטו.
5. CacheService **לא** מקור יחיד לנתונים כבדים.
6. אין full rebuild לכל כניסת משתמש.
7. כתיבה נשארת רק למקור האמת, לא ל־snapshot.
8. לא ממזגים ל־main לפני אישור מפורש.

---

## 2) Gates מחייבים לכל שלב

כל שלב עובר ל־Next רק אם כל התנאים מתקיימים:

1. זמן טעינה במסך היעד **מהיר יותר או לפחות לא איטי יותר**.
2. אין שינוי ויזואלי/עיצובי.
3. אין שינוי התנהגותי לא מכוון.
4. אין שבירת הרשאות.
5. חיפוש/סינון במסך לא מפעילים API מיותר.
6. כל כתיבה נשארת למקור האמת בלבד.
7. קיים rollback מהיר ונבדק.
8. קיימות מדידות ביצועים לפני/אחרי השלב.

---

## 3) שלבי ביצוע מחייבים

---

### שלב 0 — מדידה וגיבוי בלבד

#### מה משתנה
- איסוף baseline ביצועים למסכים:
  `dashboard, activities, month, week, exceptions, finance, instructors, contacts, endDates`.
- מדידת API duration, payload size, render duration.
- מותרת הוספת לוגים/מדידה בלבד.

#### קבצים משתנים (אם בכלל)
- `frontend/src/api.js`
- `frontend/src/main.js`
- `backend/router.gs` / `backend/actions.gs`

#### פונקציות חדשות אפשריות
- `collectPerfBaseline_()`
- `pushScreenPerfSample()`

#### פונקציות שנשארות ללא שינוי
- כל actionים העסקיים וה־routes הקיימים.

#### קריטריון הצלחה
- טבלת baseline מלאה ומוסכמת לכל המסכים.

#### בדיקות אנטי־רגרסיה
- smoke מלא לכל המסכים (ללא שינוי behavior).

#### rollback
- הסרת instrumentation בלבד.

#### אסור לגעת
- API contract / UI / הרשאות / payload structures.

---

### שלב 1 — תשתית Read Models בלבד

#### מה משתנה
- הקמת `read_models_refresh_control`.
- הוספת metadata: `is_stale`, `version`, `last_refresh_at`, `last_status`, `last_message`.
- עדיין לא מחליפים אף מסך לקריאה מ־snapshot.

#### קבצים משתנים
- `backend/config.gs`
- `backend/Code.gs`
- `backend/actions.gs` או `backend/read-models-control.gs`
- `backend/router.gs` (רק אם נדרש action אדמיניסטרטיבי לאבחון)

#### פונקציות חדשות
- `ensureReadModelsControlSheet_()`
- `updateReadModelControl_(snapshotName, patch)`
- `markReadModelStale_(snapshotName, reason)`
- `getReadModelControl_(snapshotName)`
- `refreshReadModelsTrigger()` (entry בלבד)

#### פונקציות שנשארות ללא שינוי
- כל actionי המסכים הקיימים.

#### קריטריון הצלחה
- metadata מתועד ומתעדכן, ללא שינוי תפקודי למשתמש.

#### בדיקות אנטי־רגרסיה
- login + ניווט מלא + בדיקת הרשאות route/action.

#### rollback
- disable hooks של control בלבד.

#### אסור לגעת
- לא להעביר מסכים ל־snapshot בשלב זה.

---

### שלב 2 — activities_snapshot בלבד (ללא חיבור מסך)

#### מה משתנה
- בניית `activities_snapshot`.
- parity checks מול `actionActivities_` / `allActivitiesSummary_`.
- מסך activities עדיין עובד במסלול הקיים.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/activities-snapshot.gs` (חדש)
- `backend/settings.gs`

#### פונקציות חדשות
- `refreshActivitiesSnapshot_()`
- `buildActivitiesSnapshotPayload_()`
- `validateActivitiesSnapshotParity_()`
- `readActivitiesSnapshot_()`

#### פונקציות שנשארות ללא שינוי
- `actionActivities_` כנתיב production פעיל.

#### קריטריון הצלחה
- parity מאושר ברמת שדות מוסכמים.

#### בדיקות אנטי־רגרסיה
- cross-check על פילטרים, תאריכים, סטטוסים, meetings.

#### rollback
- עצירת refresh snapshot והשארת המסלול הקיים.

#### אסור לגעת
- לא לשנות UI activities.
- לא לבצע cutover למסך עדיין.

---

### שלב 3 — החלפת activities בלבד

#### מה משתנה
- `api.activities` עובר ל־snapshot-first.
- fallback מבוקר למסלול מלא:
  - מותר רק ל־`admin` / `operation_manager`.
  - לא לכל משתמש.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/router.gs`
- `frontend/src/api.js`
- `frontend/src/screens/activities.js` (status handling בלבד, ללא UI redesign)

#### פונקציות חדשות
- `actionActivitiesSnapshotFirst_(user, payload)`
- `canUseForceFull_(user)`
- `buildSnapshotMissingResponse_('activities')`

#### פונקציות שנשארות ללא שינוי
- `actionActivityDetail_`
- כל mutations הקיימות.

#### קריטריון הצלחה
- מסך activities לא איטי יותר, עדיפות לשיפור ברור.

#### בדיקות אנטי־רגרסיה
- filters/search/load-more/drawer/save/request edit.

#### rollback
- flag off ל־snapshot-first וחזרה לנתיב הישן מיידית.

#### אסור לגעת
- לא לשנות exceptions/endDates/week/month.

---

### שלב 4 — end_dates_snapshot

#### מה משתנה
- חיבור endDates ל־snapshot-first אחרי יציבות activities.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/end-dates-snapshot.gs` (חדש)
- `frontend/src/screens/end-dates.js` (status בלבד)

#### פונקציות חדשות
- `refreshEndDatesSnapshot_()`
- `actionEndDatesSnapshotFirst_()`

#### פונקציות שנשארות ללא שינוי
- לוגיקת export ותצוגה קיימת.

#### קריטריון הצלחה
- אין פגיעה בזמן טעינה/תוצאה.

#### בדיקות אנטי־רגרסיה
- grouping לפי חודש, export, תקינות dates.

#### rollback
- חזרה ל־`actionEndDates_` legacy.

#### אסור לגעת
- לא לגעת ב־exceptions/finance.

---

### שלב 5 — exceptions_snapshot

#### מה משתנה
- חיבור exceptions ל־snapshot-first אחרי parity מלא.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/exceptions-snapshot.gs` (חדש)
- `frontend/src/screens/exceptions.js` (status handling בלבד)

#### פונקציות חדשות
- `refreshExceptionsSnapshot_()`
- `buildExceptionsSnapshotRow_()`
- `actionExceptionsSnapshotFirst_()`

#### פונקציות שנשארות ללא שינוי
- כללי priority/exception הקיימים.

#### קריטריון הצלחה
- parity מלא ל־counts/rows מול הלוגיקה הקיימת.

#### בדיקות אנטי־רגרסיה
- חריגות לפי סוג, פילטרים, drawer detail.

#### rollback
- מעבר מיידי חזרה ל־`actionExceptions_`.

#### אסור לגעת
- לא לשנות semantics של rules.

---

### שלב 6 — contacts_snapshot + instructors_snapshot

#### מה משתנה
- cutover לשני המסכים (contacts, instructors) בצורה מדורגת באותו שלב.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/contacts-snapshot.gs` (חדש)
- `backend/instructors-snapshot.gs` (חדש)
- `frontend/src/screens/contacts.js`
- `frontend/src/screens/instructors.js`

#### פונקציות חדשות
- `refreshContactsSnapshot_()`
- `refreshInstructorsSnapshot_()`
- `actionContactsSnapshotFirst_()`
- `actionInstructorsSnapshotFirst_()`

#### פונקציות שנשארות ללא שינוי
- add/save contact וההרשאות הקיימות.

#### קריטריון הצלחה
- ללא שינוי behavior ותוצאות משתמש.

#### בדיקות אנטי־רגרסיה
- add/save/edit contacts + instructors counters.

#### rollback
- flags off וחזרה ל־legacy actions.

#### אסור לגעת
- לא לשנות מודל הרשאות.

---

### שלב 7 — finance_snapshot

#### מה משתנה
- finance עובר snapshot-first אחרי יציבות השלבים הקודמים.

#### קבצים משתנים
- `backend/actions.gs`
- `backend/finance-snapshot.gs` (חדש)
- `frontend/src/screens/finance.js`

#### פונקציות חדשות
- `refreshFinanceSnapshot_()`
- `actionFinanceSnapshotFirst_()`
- `validateFinanceParity_()`

#### פונקציות שנשארות ללא שינוי
- saveFinanceRow/syncFinance mutations קיימות.

#### קריטריון הצלחה
- parity מלא ל־aggregates ול־rows + ביצועים לא פחותים.

#### בדיקות אנטי־רגרסיה
- tabs, filters, month/date range, סכומים.

#### rollback
- חזרה מיידית ל־`actionFinance_`.

#### אסור לגעת
- לא לשנות כללי חישוב כספי.

---

### שלב 8 — week/month רק אם עדיין נדרש

#### מה משתנה
- רק אם מדדי ביצועים מוכיחים bottleneck קיים.
- לא מוסיפים `calendar_snapshot` מראש ללא צורך מוכח.

#### קבצים משתנים (רק אם אושר)
- `backend/actions.gs`
- `backend/calendar-snapshot.gs` (חדש)
- `frontend/src/screens/week.js`
- `frontend/src/screens/month.js`

#### פונקציות חדשות
- `refreshCalendarSnapshot_()` (אופציונלי)
- `actionWeekSnapshotFirst_()`
- `actionMonthSnapshotFirst_()`

#### פונקציות שנשארות ללא שינוי
- UX ו־UI של שבוע/חודש.

#### קריטריון הצלחה
- שיפור ביצועים בפועל או אפס פגיעה.

#### בדיקות אנטי־רגרסיה
- ניווט שבוע/חודש, drawer, פילטרים.

#### rollback
- flags off וחזרה ל־`actionWeek_`/`actionMonth_`.

#### אסור לגעת
- לא לבצע optimization יזום ללא evidence.

---

## 4) Feature Flags Matrix

| שלב | שם Flag | ברירת מחדל | Route/Action מושפע | מה קורה כשה־Flag כבוי | מי רשאי להפעיל fallback מלא | Rollback מהיר |
|---|---|---|---|---|---|---|
| 1 | `ff_read_models_control_enabled` | `false` | metadata control בלבד | אין stale/version metadata חדש | לא רלוונטי | `false` + disable trigger |
| 2 | `ff_activities_snapshot_build_enabled` | `false` | refresh job פנימי בלבד | לא נבנה activities snapshot | לא רלוונטי | `false` + עצירת job |
| 2 | `ff_activities_snapshot_parity_enforced` | `true` | parity checker | snapshot לא יקודם אם אין parity | לא רלוונטי | `true` (hard gate) |
| 3 | `ff_activities_snapshot_first` | `false` | `actionActivities_` / `api.activities` | מסלול legacy בלבד | `admin`, `operation_manager` בלבד | `false` מיידי |
| 3 | `ff_activities_force_full_allowed` | `false` | activities fallback behavior | אין force_full בכלל | רק `admin`, `operation_manager` אם דולק | `false` מיידי |
| 4 | `ff_end_dates_snapshot_first` | `false` | `actionEndDates_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 5 | `ff_exceptions_snapshot_first` | `false` | `actionExceptions_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 6 | `ff_contacts_snapshot_first` | `false` | `actionContacts_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 6 | `ff_instructors_snapshot_first` | `false` | `actionInstructors_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 7 | `ff_finance_snapshot_first` | `false` | `actionFinance_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 8 | `ff_week_snapshot_first` | `false` | `actionWeek_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |
| 8 | `ff_month_snapshot_first` | `false` | `actionMonth_` | legacy בלבד | `admin`, `operation_manager` | `false` מיידי |

**הערת מדיניות:**
- fallback מלא למשתמשים לא מורשים (למשל authorized_user/instructor) נשאר כבוי.
- גם כשה־flag דולק: fallback מלא **לא** מפעיל full rebuild לכל כניסה.

---

## 5) Smoke בדיקות ידניות קצרות (מחייב לפני/אחרי כל שלב)

1. Login לפי תפקידים: `instructor`, `authorized_user`, `operation_manager`, `admin`.
2. Dashboard: טעינה + ניווט חודש + KPI קליקים.
3. Activities: חיפוש/פילטרים/Drawer/Edit Request/Save.
4. Week: ניווט שבוע + Drawer + פילטרים.
5. Month: ניווט חודש + פתיחת יום + Drawer.
6. Exceptions: counts + פילטר סוג חריגה + Drawer.
7. Finance: active/archive + פילטר סטטוס/חודש + Save/Sync.
8. Instructors: ספירות + שדות תצוגה.
9. Contacts + Instructor Contacts: add/save/edit + הרשאות.
10. EndDates: grouping לפי חודש + export.

---

## 6) Rollback לפי שלב (אופרטיבי)

- **S0**: הסרת instrumentation.
- **S1**: `ff_read_models_control_enabled=false`, disable trigger.
- **S2**: `ff_activities_snapshot_build_enabled=false`.
- **S3**: `ff_activities_snapshot_first=false` (+ `ff_activities_force_full_allowed=false`).
- **S4**: `ff_end_dates_snapshot_first=false`.
- **S5**: `ff_exceptions_snapshot_first=false`.
- **S6**: `ff_contacts_snapshot_first=false`, `ff_instructors_snapshot_first=false`.
- **S7**: `ff_finance_snapshot_first=false`.
- **S8**: `ff_week_snapshot_first=false`, `ff_month_snapshot_first=false`.

כל rollback חייב לכלול:
1. כיבוי flag.
2. אימות smoke למסך מושפע.
3. תיעוד קצר ב־`read_models_refresh_control`/log תפעולי.

---

## 7) Definition of Done (DoD) כולל לפרויקט

התוכנית תיחשב מוכנה למימוש בפועל רק כאשר:
1. כל השלבים מתועדים עם Gates, Rollback ו־Flags.
2. מוגדרת מדידת baseline מוסכמת לשלב 0.
3. מוגדר owner לכל שלב וקריטריון קבלה.
4. מוגדרת מדיניות fallback והרשאות הפעלה.
5. מאושר שאין שינוי UI/עיצוב/הרשאות במסגרת שלבי המיגרציה.

---

## 8) הערות ניהול שינוי

- PR זה הוא **Documentation PR בלבד**.
- אין להתחיל מימוש לפני אישור מפורש על המסמך.
- תחילת עבודה טכנית לאחר אישור: שלב 0 ואז שלב 1 בלבד.

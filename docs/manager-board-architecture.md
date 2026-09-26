# מיפוי ארכיטקטורה וביצועים — לוח המנהל

> **סטטוס:** מיפוי בלבד, 26.09.2026. לא בוצע שינוי בקוד, ב־Supabase, ב־schema או ב־migration.  
> **תחום:** הנתיב מהלחיצה על **„לוח מנהל”** ועד לתצוגה מלאה, כולל תהליכי רקע שעלולים להתחרות בו.  
> **מגבלת מדידה:** לא היו בסביבת העבודה פרטי משתמש לבדיקה או הרשאת Supabase Dashboard/Logs. לכן המסמך מפריד בין עובדות שנקראו מהקוד, תזמונים קיימים שאפשר לאסוף בייצור, והיפותזות שעדיין מחייבות trace מאומת. אין במסמך מספרי latency או payload מומצאים.

## 1. תקציר מנהלים

לוח המנהל אינו route עצמאי. הוא runtime גלובלי שמזריק כפתור, מנווט ל־`dashboard` במקרה הצורך, ואז מחליף את `#screenRoot` של הדשבורד. במסלול קר הוא מציג מיד „טוען לוח מנהל…”, ממתין ל־Auth, מריץ **שש קריאות במקביל**, מעבד את כל פעילויות העונה בדפדפן, בונה HTML, מחליף את כל ה־root וקושר handlers. רק החלפת ה־`innerHTML` מסירה את מסך הטעינה.

הממצאים החשובים ביותר:

1. **מחסום `Promise.all` רחב:** activities, instructors, profiles, calendar, users ו־birthdays כולם חייבים להסתיים לפני הרינדור הראשון. גם יום הולדת או profile איטי משאיר את כל המסך במצב loading.
2. **שאילתות רחבות מהנדרש:** פעילויות של כל העונה וכל המנהלים; כל אנשי הקשר; כל profiles; וכל אירועי לוח השנה הפעילים. למנהל פעילות עצמי אין סינון server-side לפי המנהל המחובר.
3. **עבודה שנזרקת מיד:** `instructor_scheduling_profiles` משמש לחישוב כרטיסי „מדריכים החודש”, אבל `manager-board-final-fixes-runtime.js` מסיר את כל הפאנל לאחר mount. גם חישוב הסטטיסטיקה וה־HTML שלו נעשים לפני ההסרה.
4. **מרוץ עם route הדשבורד:** פתיחה ממסך שאינו dashboard מתחילה גם navigation/load של dashboard וגם load עצמאי של הלוח. סיום מאוחר של הדשבורד יכול להחליף את הלוח; observer מזהה שהלוח נעלם ומרנדר אותו שוב. ה־data cache מונע בדרך כלל query שני לאחר שהקריאה הראשונה הושלמה, אך לא מונע הבהוב/loading נוסף או עבודה כפולה.
5. **אין single-flight ב־`dataCache`:** ה־cache שומר רק תוצאה גמורה. שני `renderManagerBoard` חופפים לפני סיום הראשון מפעילים שתי קבוצות queries מלאות. `boardRequestId` מונע מתוצאה ישנה לצייר, אך אינו מבטל את הרשת.

מנגד, ה־MutationObservers העיקריים מושהים ב־30/50ms או ב־`requestAnimationFrame`, ורובם אינם חוסמים את הסרת ה־loading. הם כן גורמים למספר passes אחרי mount. אין בסיס לקבוע שהם צוואר הבקבוק הראשי בלי trace.

---

## 2. תרשים הזרימה המלא

```text
Click "לוח מנהל"
  │
  ├─ capture click: manager-board-runtime.handleDocumentClick()
  │    preventDefault + stopPropagation
  │
  ├─ openManagerBoard()
  │    managerBoardOpen=true; lastRenderedSignature=''
  │
  ├─ [רק אם route != dashboard]
  │    dispatch app:navigate('dashboard')
  │      └─ main.js navigateToRoute → state.route='dashboard' → render/mountScreen
  │          ├─ import/get dashboard screen
  │          ├─ cached dashboard: render מיד
  │          └─ cold dashboard: dashboard load ממשיך במקביל ועלול לסיים מאוחר
  │
  └─ setTimeout(0)
       ├─ ensureManagerBoardButtons()
       └─ renderManagerBoard(false)
            ├─ renderLoading(#screenRoot)  ← "טוען לוח מנהל…"
            ├─ loadBoardData(period)
            │    ├─ dataCache hit (<90s)? return synchronously-as-Promise
            │    ├─ waitForSupabaseAuthSession({timeoutMs:7000})
            │    └─ Promise.all([
            │          activities by season (all managers, 35 date columns),
            │          all contacts_instructors projection,
            │          all instructor_scheduling_profiles projection,
            │          school_calendar active+main projection,
            │          active activities_manager users,
            │          employee_birthdays active projection
            │       ])
            ├─ filter closed activities in JS
            ├─ restoreSelections(localStorage/current user)
            ├─ renderBoardMarkup()
            │    ├─ filter selected manager in JS
            │    ├─ scan date_1..date_35 for current month
            │    ├─ scan date_1..date_35 again for next month
            │    ├─ calculate instructor stats/profile targets
            │    ├─ expand/filter school calendar
            │    └─ construct one large HTML string
            ├─ #screenRoot.innerHTML = markup  ← ה-loading נעלם כאן
            ├─ bindBoardControls()
            └─ setBoardActiveNav()
                 │
                 ├─ workspace observer (50ms)
                 │    management: visibility pass only
                 │    restored non-management tab: lazy tab data load
                 ├─ main runtime observer (30ms): signature/nav pass
                 ├─ interactions observer (30ms, admin): DOM cleanup + bind days
                 ├─ final-fixes observer (next animation frame): remove panel/nav fixes
                 ├─ date-state observer: scan milestones/events and move past rows
                 └─ management-docs observer (rAF): attach SharePoint link
```

### מתי ה־loading מוצג ומתי הוא נעלם

- הוא מוצג בתחילת `renderManagerBoard`, אחרי `setTimeout(0)` של `openManagerBoard`. כלומר התגובה ללחיצה היא macrotask הבא, לא באותו call stack.
- הוא נעלם רק אחרי `loadBoardData` כולו, `restoreSelections`, ו־`renderBoardMarkup`, ברגע ש־`root.innerHTML` מוחלף.
- `bindBoardControls` וה־post-render runtimes רצים לאחר ההחלפה ולכן אינם מחזיקים את מסך ה־loading, אף שהם יכולים לעכב אינטראקטיביות/paint קצרות אם העבודה הסינכרונית כבדה.
- כל אחת משש הקריאות הראשוניות יכולה לעכב את כולן בגלל `Promise.all`; אין timeout נפרד לשאילתות.
- אם navigation מקביל של dashboard מסיים לאחר הלוח, הוא יכול לדרוס את ה־DOM. ה־observer של הלוח עשוי להציג loading נוסף ולהרכיב שוב.

---

## 3. קבצים ורכיבים

| קובץ | מתי נטען | תפקיד ו־DOM | Observer | Supabase / יכולת rerender |
|---|---|---|---|---|
| `index.html` | bootstrap, תמיד | טוען CSS ואת כל runtimes כ־ES modules גלובליים | לא | סדר ה־scripts אינו סדר ביצוע מובטח מעבר לתלויות module, אבל כולם מותקנים בתחילת האפליקציה |
| `frontend/src/manager-board-runtime.js` | תמיד; מתחיל ב־DOMContentLoaded | מזריק כפתור, מנהל open/close, loading, data load, markup ו־bindings | `#app`, `childList+subtree`, debounce 30ms | 5 queries + birthday loader; יכול לקרוא `renderManagerBoard` שוב אם root נעלם/period משתנה |
| `frontend/src/manager-board-workspace-runtime.js` | תמיד | מנהל tabs, roster, attendance, tracking ו־admin payroll; משנה visibility ותוכן workspace | `#app`, `childList+subtree`, debounce 50ms | RPC roster; ב־tabs בלבד גם attendance APIs/RPCs; `renderWorkspace` אינו טוען data ב־management |
| `frontend/src/manager-board-final-fixes-runtime.js` | תמיד | מסיר פאנל מדריכים, הופך חצים, משחרר backdrop; ב־attendance מתקן statuses | app/document, `childList+subtree`, coalesce ב־rAF | אין ב־management; ב־attendance קורא workflow RPC ועלול להיות query נוסף לאחר render |
| `frontend/src/manager-board-interactions-runtime.js` | תמיד; פעיל ללוח רק ל־admin | מסיר טקסטים, מוסיף ARIA/tabindex וקושר תאי ימים; drawer לפי יום | `#app`, `childList+subtree`, debounce 30ms | רק בלחיצה על יום: `activities.select('*')` למנהל/עונה; cache נפרד ולכן אינו ממחזר את נתוני הלוח |
| `frontend/src/manager-board-date-state-runtime.js` | תמיד | מסמן היום/עבר ומעביר שורות עבר ל־`details` | `document.body`, added child nodes | ללא queries; pass על containers לאחר mount |
| `frontend/src/manager-board-management-docs-link.js` | import עקיף מ־`main-with-proposal-pdf-hotfix.js` | עוטף tab ניהול ומוסיף קישור SharePoint | app, `childList+subtree`, כל mutation מתזמן rAF | ללא queries; guard מונע link כפול |
| `frontend/src/manager-board-employee-file-tracking.js` | import סטטי של workspace | renderer טהור לטבלת tracking וחוקי מועדים | לא | ללא queries; נתוני roster מגיעים מה־RPC |
| `frontend/src/birthday-calendar.js` | import של runtime וגם feature גלובלי | cache ימי הולדת; מקשט month/week רגילים | observer מסונן של app calendar | query birthdays נמצא ב־critical path של הלוח; `getSession` נוסף ב־decorator, אך לא בתוך `loadActiveBirthdays` |
| `frontend/src/supabase-client.js` | shared bootstrap | יוצר client ומרכז auth-wait single-flight | auth listener זמני בכל wait; unsubscribe בהצלחה | `getSession` מיד, ועוד `getSession` אחרי timeout אם טרם הסתיים |
| `frontend/src/main.js` | bootstrap ראשי | routing, shell, dashboard data cache/render | אין observer רלוונטי כאן | navigation ל־dashboard יכול לרוץ במקביל ולדרוס `#screenRoot`; logs קיימים ל־route אך לא ללוח |
| `frontend/src/api.js` | shared | bootstrap, settings/lists caches ו־attendance APIs | לא | settings/lists אינם query יזום של פתיחת הלוח; attendance calls רק אם tab מתאים |
| `frontend/src/screens/admin-home.js` | route admin/dashboard לפי הרשאה | יוצר tile עם `data-manager-board-open`; אין route ייעודי | לא | ללא query ישיר |
| `frontend/src/staff-message-popup-runtime.js` | תמיד | polling עצמאי להודעות צוות | listeners ל־navigation/focus/visibility + interval | query `staff_messages`, ואחריו acknowledgements; אינו blocker לוגי אך יכול ליצור burst מקביל |
| `frontend/src/payroll-attendance-v2-bridge.js` | תמיד לפני board runtimes | מוסיף ל־`api` snapshot ופעולות attendance v2 | לא רלוונטי לפתיחה | RPC snapshot רק בפתיחת דוח עובד מתוך attendance |
| `frontend/src/screens/shared/summer-activity.js` | import | נרמול period והמרתו לערכי season | לא | ללא query |
| `frontend/src/screens/shared/school-calendar-logic.js` | import | כותרות ו־dedupe של אירועי לוח | לא | ללא query |

`manager-board-copy-fixes-runtime.js` קיים אך **אינו נטען מ־index ואינו מיובא בקוד החי**. לכן ה־query הנוסף שלו ל־activities אינו חלק מהזרימה הנוכחית. אסור לכלול אותו במספר הקריאות בפועל בלי ראיית Network שסותרת זאת.

---

## 4. מפת קריאות נתונים

### 4.1 Critical path — פתיחה קרה של הלוח

| מקור | קובץ / פונקציה | projection וסינון | היקף | חוסם? | כפילות / reuse |
|---|---|---|---|---|---|
| `activities` | `manager-board-runtime.loadBoardData` | `id,row_id,activity_manager,authority,school,school_id,activity_type,activity_name,program_name,sessions,status,start_time,end_time,emp_id,instructor_name,emp_id_2,instructor_name_2,activity_season,date_1..date_35`; `activity_season IN seasons`; order manager | כל פעילויות העונה של כל המנהלים; closed מסונן רק בדפדפן | **כן** | cache נפרד 90s, ללא in-flight; drawer טוען אותן שוב עם `select('*')` |
| `contacts_instructors` | `loadBoardData` | `emp_id,full_name,direct_manager,active`; ללא filter | כל הטבלה המותרת ב־RLS | **כן** | אין reuse עם cache ה־bootstrap ב־`api.js`; roster RPC מאוחר הוא מקור נוסף |
| `instructor_scheduling_profiles` | `loadBoardData` | `emp_id,weekly_target_hours,weekly_max_hours,preferred_work_days,max_fixed_courses`; ללא filter | כל הטבלה | **כן** | רק `weekly_target_hours` משמש; הפאנל שמשתמש בתוצאה מוסר מיד ב־final-fixes |
| `school_calendar` | `loadBoardData` | 13 עמודות; `is_active=true`, `show_on_main_calendar=true` | כל האירועים הפעילים, ללא month/period filter | **כן** | לא ממחזר data של מסך חודש; רק החודש הנבחר נצרך כעת |
| `users` | `loadBoardData` | `user_id,name,full_name,role,is_active`; role activities_manager + active | subset קטן | **כן** | משמש selector. למנהל עצמי אפשר להסתפק בזהות state; לאדמין נדרש catalog שמות אך לא activities שלהם |
| `employee_birthdays` | `birthday-calendar.loadActiveBirthdays` | 4 עמודות; active; 4 orders | כל ימי ההולדת הפעילים | **כן** | יש cache + in-flight promise process-wide, ללא TTL; משותף ללוחות חודש/שבוע |

שגיאה ב־activities מפילה את הלוח. שגיאות חמשת המקורות האחרים מומרות בפועל למערך ריק באמצעות `safeRows` או `.catch`, אבל הן עדיין חייבות **להסתיים** לפני render.

### 4.2 קריאות מותנות/מאוחרות של לוח המנהל

| trigger | מקור | projection / scope | חסימת מסך ראשון | cache |
|---|---|---|---|---|
| פתיחת instructor center | `contacts_instructors` + RPC `get_instructor_employee_file_snapshot` | איש קשר יחיד + snapshot לשנה | לא | `instructorCenterCache`, ללא TTL, key session/year/emp |
| פתיחת יום בלוח (admin) | `activities` | `select('*')`, season + manager | לא; חוסם drawer | 90s, key period/manager; cache נפרד, אין in-flight |
| tab attendance/tracking | RPC `get_manager_team_roster` | manager + school year | לא אם tab ניהול; **כן לתוכן tab משוחזר** | 90s, key manager/year; אין in-flight |
| tab admin payroll | `contacts_instructors` managers + roster RPC לכל manager | כל direct managers ואז fan-out RPC | לא | roster entries 90s; רשימת managers ללא cache |
| attendance summary | external attendance endpoint `getsummary` | לפי מימוש API בפועל הקריאה אינה מעבירה את opts ולכן עלולה להחזיר summary רחב | לא | summary 60s, key month + ids; sequential אחריו approvals |
| attendance summary | `payroll_control_approvals` | `select('*')`, status/month/employee ids | לא | בתוך cache summary 60s |
| final-fixes attendance | RPC `get_payroll_attendance_month_statuses` | month + employee ids | לא | cache נפרד 60s; עלול לכפול מידע שכבר מבוקש ב־tab |
| employee attendance drawer | RPC `get_manager_attendance_review_snapshot` | employee + month | לא | 60s, employee/month |
| staff polling מקביל | `staff_messages`, אז `staff_message_acknowledgements` | active messages, אחר כך user + message ids | לא לוגית | throttle 10s, poll 15s, single-flight |

### 4.3 `settings`, `lists` וה־dashboard

- `settings` ו־`lists` אינם נקראים מ־manager-board. הם נטענים ב־login/bootstrap, נשמרים ב־module caches עם in-flight promises, ויכולים להיות ברשת בזמן הפתיחה אם bootstrap עדיין מתרחש.
- אם הלחיצה מגיעה ממסך שאינו dashboard, `openManagerBoard` מנווט ל־dashboard. `main.js` עשוי לקרוא את loader של dashboard או להשתמש ב־screen cache. זו עבודה מקבילה שאינה נדרשת להצגת לוח המנהל.
- לכן trace אמיתי חייב לתייג calls לפי initiator ולא לייחס אוטומטית כל request שבחלון הזמן ל־`loadBoardData`.

---

## 5. ניתוח `activities`

### למה נטענת כל שנת הפעילות

ה־query מסנן רק `activity_season`. אחר כך `managerActivitiesFor` מסנן מנהל בדפדפן, ו־`buildMeetingRows` סורק 35 שדות תאריך בכל פעילות עבור החודש. הבחירה מאפשרת החלפת מנהל וחודש בלי רשת נוספת, אך הופכת את הפתיחה הראשונה לטעינת snapshot עונתי רחב.

### האם הכול נדרש למסך הראשון

- **מנהל פעילות (`activities_manager`):** לא. ה־UI מקבע את המנהל המחובר ואינו מאפשר לבחור מנהל אחר. אפשר עקרונית להוסיף `.eq('activity_manager', resolvedManager)` server-side, בתנאי שמיפוי השם אמין ונבדק מול RLS/כינויים.
- **admin/operation_manager/finance:** למסך הראשון נדרש מנהל אחד בלבד. רשימת המנהלים יכולה להגיע מ־`users`/contacts; פעילויות של מנהל אחר נדרשות רק כאשר המשתמש בוחר אותו. cache לפי `period|manager` יתאים יותר.
- **date_1..date_35:** לתצוגת ניהול הראשונית נדרשים תאריכי החודש הנבחר וגם החודש הבא (נקודות בקרה). ניווט לחודשים אחרים ו־day drawer דורשים תאריכים מאוחרים יותר, אך לא חייבים להיות ב־critical path.
- **שדות שלא נצרכים במסך הראשוני:** `school_id` לא נמצא בשימוש ב־runtime הראשי. מבין profile fields רק `weekly_target_hours` נצרך. מאחר שפאנל המדריכים מוסר, נכון לעכשיו גם profile זה אינו משפיע על DOM הסופי.
- **drawer:** דורש record עשיר ולכן מבצע כיום `select('*')`, אך רק לאחר לחיצה. אין הצדקה להעביר payload זה לפתיחה.

### טעינה מדורגת אפשרית

1. Shell מיידי עם manager/month controls.
2. query ממוקד למנהל הנבחר ולחלון החודש הנבחר + הבא דרך RPC/view נורמלי של meetings, או זמנית projection קיים עם filter מנהל.
3. catalog מנהלים/צוות ולוח שנה במקביל, עם sections עצמאיים שאינם מחזיקים overlay מלא.
4. full activity row רק בפתיחת drawer; months אחרים לפי ניווט, עם cache לפי manager/month.

סינון date columns ב־PostgREST באמצעות OR של 35 עמודות יהיה מורכב ושביר. פתרון ארכיטקטוני עדיף הוא RPC/view שמחזיר meeting rows מנורמלים עבור טווח תאריכים.

---

## 6. Auth — `waitForSupabaseAuthSession`

1. הפונקציה היא single-flight גלובלית: אם יש promise פעיל או session תקין שכבר נפתר, callers חולקים אותו.
2. בכל התחלה חדשה היא מפעילה `getSession()` מיד ובמקביל נרשמת ל־`onAuthStateChange`.
3. אם `getSession` מחזיר session תקין, היא מסיימת מיד. לכן session קיים אינו אמור להמתין 7 שניות.
4. אם `getSession` מחזיר **ללא session או עם error**, ה־promise אינו מסתיים מיד. הוא ממתין לאירוע Auth או עד timeout, ואז קורא `getSession()` **פעם שנייה**. במקרה זה פתיחת הלוח יכולה להתעכב כמעט 7 שניות עוד לפני query ראשון.
5. אם timeout מסתיים ללא session, cache ה־promise מתאפס, כך שקריאה עתידית תחזור על ההמתנה. אם session נמצא, ה־promise resolved נשמר ללא TTL לכל חיי הדף.
6. `loadBoardData`, workspace, interactions, bootstrap ו־staff messages משתמשים באותה המתנה ולכן בדרך כלל אינם יוצרים waits עצמאיים. `birthday-calendar.decorateBirthdayCalendarViews` כן קורא `supabase.auth.getSession()` ישירות, אבל loader ימי ההולדת של הלוח לא עושה זאת.

**סיכון שינוי:** אין להסיר את ההמתנה באופן גורף מ־shared client. RLS של personal reports, attendance, admin וה־RPCs מסתמך על JWT משוחזר. שינוי low-risk אפשרי בתוך helper: לסיים מיד גם על תוצאת `getSession` ודאית ללא session, או להבחין בין “initialization pending” לבין “anonymous”, אך הוא מחייב tests לאירוע `INITIAL_SESSION`, token refresh, cold restore ו־signed-out.

---

## 7. שכבות cache

| cache | key / TTL | invalidation | Ctrl+F5 / tabs | single-flight |
|---|---|---|---|---|
| board `dataCache` | period / 90s | logout, retry; expiration נבדק בקריאה | נמחק ברענון; משותף למעברי manager/month באותו tab | **לא** |
| `instructorCenterCache` | session identity + schoolYear + empId / ללא TTL | logout בלבד | נמחק ברענון; נשמר במעברי UI | **לא** |
| interactions `activityCache` | period + manager / 90s | expiration בלבד | נמחק ברענון | **לא** |
| workspace `rosterCache` | manager + year / 90s | retry; כניסה ל־tracking מוחקת key; expiration | נמחק ברענון; משותף tabs | **לא** |
| `attendanceSummaryCache` | month + sorted employee ids / 60s | retry clears all; expiration | נמחק ברענון | **לא** |
| `attendanceReviewSnapshotCache` | empId + month / 60s | expiration בלבד | נמחק ברענון | **לא** |
| final-fixes `attendanceWorkflowCache` | month + ordered ids / 60s | expiration בלבד | נמחק ברענון; נפרד מ־summary | **לא** |
| birthdays | singleton / ללא TTL | SIGNED_OUT בלבד | נמחק ברענון; shared בין board/month/week | **כן**, `birthdaysPromise` |
| Supabase auth wait | singleton / ללא TTL כשהצליח | explicit reset / null result | נמחק ברענון | **כן** |
| main screen cache | route-specific, dashboard 5m (לפי map ב־main) + persistence policy | mutations/logout/version logic | יכול לשרוד reload דרך localStorage לפי policy | **כן**, `inflightRequests` |
| API bootstrap settings/lists | singleton / ללא TTL | mutation/logout/bootstrap clear | נמחק ברענון | **כן**, promises |
| staff messages | successful-check timestamp 10s; interval 15s | time/focus/navigation | נמחק ברענון | **כן**, `checkPromise` |

`sessionStorage` יכול לשפר reload רק עבור נתונים לא־רגישים ומסומנים ב־user/session/period/schema version. אין לשמור snapshots של attendance או פרטי עובדים ללא סקירת פרטיות. לפני persistence, עדיף להוסיף single-flight ל־board data ולחלוק cache עם drawer — חיסכון גדול יותר וסיכון נמוך יותר ל־stale/PII.

---

## 8. MutationObservers, passes ולולאות

| runtime | צופה | מפעיל | mutation עצמי / loop assessment |
|---|---|---|---|
| manager board | app child tree | `syncRuntime` אחרי 30ms | הזרקת button, loading ו־markup מפעילים אותו שוב. signature/board-exists guards בדרך כלל עוצרים render נוסף; אם dashboard דרס root הוא מרנדר שוב |
| workspace | app child tree | `syncWorkspace` אחרי 50ms | visibility/markup mutations מתזמנים שוב. signature + `managerWorkspaceReady` עוצרים data render חוזר; management תמיד מבצע visibility pass |
| final fixes | app child tree + navigate/click | `syncBoard` ב־rAF | הסרת פאנל ושינוי text הם child mutations ולכן עוד rAF אפשרי; guard `scheduled` מאחד, ו־second pass idempotent. אינו צופה attributes בכוונה |
| interactions | app child tree | full board cleanup אחרי 30ms | `remove()` של subtitle הוא child mutation ולכן עוד pass; attributes אינם נצפים; WeakSet מונע bind כפול |
| date state | body child tree, רק mutations עם addedNodes | `enhanceAll` מיד | העברת rows/הוספת details יוצרת callbacks נוספים; dataset guard עוצר re-enhance, אך כל callback סורק שוב את כל containers |
| management docs | app child tree + navigate | attach ב־rAF | wrapping/moving tab מוסיף mutations ומתזמן שוב; existence guard עוצר הוספה כפולה |
| birthday calendar | app child tree, סינון selectors | decoration אחרי 50ms | manager-board markup אינו מתאים selectors הרגילים ולכן לרוב אין decoration pass |

לא נמצאה לולאה אינסופית דטרמיניסטית. נמצאה **שרשרת post-render מרובת passes**: mount אחד מפעיל לפחות חמישה observers; כמה מהם משנים DOM ומייצרים callback נוסף. זה מתאים ל־cleanup עתידי, אך יש למדוד long tasks לפני שיוחס לו delay של שניות.

### רינדורים כפולים אפשריים

- `renderManagerBoard`: יכול להיקרא מ־open, observer, בחירת manager/month, retry, auto-open. guard מונע חלק מהכפילויות רק לאחר `lastRenderedSignature`; בזמן loading signature עדיין ישן ולכן overlap אפשרי.
- `renderWorkspace`: observer + click יכולים שניהם לתזמן. signature guards טובים לאחר תחילת render; `force=true` עוקף אותם. ב־management אין data load.
- `syncRuntime`, `scheduleRuntimeSync`, final-fixes ו־interactions בוודאות רצים שוב אחרי החלפת `innerHTML`; זהו pass נוסף, לא בהכרח render data נוסף.
- `final-fixes` מסיר node שהרינדור הראשי יצר; זו עבודה כפולה מכוונת אך מיותרת.

---

## 9. Critical path לעומת secondary/lazy

### A — Critical לפני תוכן שימושי

- auth session תקף.
- זהות/שם המנהל הנבחר.
- פעילויות רלוונטיות למנהל ולחודש הנבחר (ועבור milestones הנוכחיים גם החודש הבא).
- מינימום team/contact data הנדרש ל־team strip.
- build/render של calendar הראשי וקישור controls.

### B — Secondary לאחר הצגת shell/content

- `school_calendar` ותאריכים חשובים: section עצמאי יכול לקבל skeleton משלו.
- birthdays: מידע משני; אסור שיחזיק את כל המסך.
- catalog מנהלים מלא לאדמין, אם ברירת המחדל כבר ידועה.
- accessibility/presentation cleanup, date-state grouping וקישור SharePoint.
- staff messages, dashboard refresh ו־bootstrap refresh צריכים להישאר background ולא להתחרות ללא תיעדוף.

### C — Lazy לפי פעולה

- profiles/יעדי שעות וכרטיסי מדריכים (ובמצב הנוכחי אין לטעון אותם כלל כי הפאנל מוסר).
- instructor employee-file snapshot.
- activity full row עבור drawer.
- roster tracking.
- attendance records, approvals, workflows ו־review snapshot.
- all-team roster fan-out של admin payroll.

---

## 10. מפת ביצועים ותוכנית מדידה

### מה הקוד מודד כיום

`main.js` מדפיס `route-load:start/success/failed`, timers ל־route load/render/bind ו־transition. מדדים אלה מתארים dashboard navigation, **לא** את `loadBoardData` או render הלוח. ללוח עצמו אין `performance.mark`, resource correlation או payload logging.

### מה לא ניתן לקבוע ללא session production

לא ניתן לקבוע כרגע:

- click→`loadBoardData`, זמן auth בפועל, זמן כל query, `Promise.all`, parsing/payload bytes, processing, markup, binding או loading removal;
- מספר rows/bytes אמיתי (לרבות הטענה „253 פעילויות”);
- backend execution מתוך Supabase Logs לעומת RTT/browser queue;
- האם הבעיה הדומיננטית היא Supabase, רשת, auth, JS או DOM.

לא הייתה גישה ל־Supabase Logs, ולכן לא בוצע ייחוס backend. בדיקת Logs עתידית צריכה להשתמש ב־request id/time window של session אחד ולא בנתוני מערכת מצטברים.

### instrumentation זמני מומלץ ל־trace אחד (לא הושאר בקוד)

1. ב־click: `performance.mark('mb:click')`.
2. בתחילת `loadBoardData`, לפני/אחרי auth, ולכל query wrapper mark נפרד.
3. למדוד `Promise.all`, normalization/filter, `renderBoardMarkup`, assignment ל־`innerHTML`, `bindBoardControls`.
4. `requestAnimationFrame` כפול לאחר assignment למדידת painted/settled; `MutationObserver` חד־פעמי לזמן שבו loading node הוסר.
5. ב־PerformanceObserver: `longtask`, resource timing של `/rest/v1` ו־`/rpc`, transferSize/encodedBodySize כאשר Timing-Allow-Origin מאפשר.
6. DevTools Network HAR: initiator, TTFB, content download, size, duplicate URLs.
7. Supabase Logs באותו חלון: query/RPC duration ומספר calls. `frontend duration - backend duration` נותן בקירוב auth/queue/network/download/browser, לא מדד רשת טהור.
8. להריץ cold reload, warm reopen <90s, reopen >90s, dashboard→board ומסך אחר→board, לכל role רלוונטי. להסיר instrumentation בסיום.

### דירוג צווארי בקבוק (היפותזה עד למדידה)

| עדיפות | נקודה | ראיה בקוד | מה יכריע במדידה |
|---|---|---|---|
| 1 | auth יכול להוסיף ~7s במצב no-session/error | helper אינו resolve על null ראשוני | mark auth + Auth event timeline |
| 2 | slowest-of-six `Promise.all` | כל המקורות חוסמים | per-query waterfall ו־TTFB |
| 3 | activities רחב + 35 dates + סריקות כפולות | projection/filter/processing מפורשים | bytes, parse time, buildMeetingRows CPU |
| 4 | dashboard navigation race/rerender | שני owners ל־`#screenRoot` | DOM marks + count renderManagerBoard/dashboard renders |
| 5 | post-render observers/wasted instructor panel | render ואז remove; חמישה observers | long tasks, rAF settled delta |

---

## 11. סיכוני regression ומסכים אחרים

| שינוי עתידי | shared consumers / סיכון | בדיקות חובה |
|---|---|---|
| שינוי `waitForSupabaseAuthSession` | כל `api.bootstrap`, personal reports, attendance, admin, staff popup וכל RPC עם RLS | cold auth restore, warm session, expired token refresh, signed-out, slow INITIAL_SESSION; כל role |
| צמצום activities query | calendar, milestones, instructor center summary; drawer משתמש query אחר; scheduling/attendance/customer file משתמשים ב־api/shared tables אך לא בפונקציה המקומית | managers/roles, current+next month, 35th session, closed status, season aliases, drawer identity |
| cache משותף activities | drawer צריך `select('*')` בעוד board projection צר; סכנת partial row masquerading as full | drawer fields/actions, cache key user/period/manager/projection, mutation invalidation |
| שינוי contacts/profile | team strip, manager matching, tracking roster RPC, employee center | active/inactive, missing emp_id, direct_manager variants, manager self mapping |
| lazy school calendar/birthdays | month/week birthday feature shared; calendar logic shared עם מסכים אחרים | board section hydration, month/week birthdays, holiday spans/dedupe, offline/error |
| route עצמאי ללוח | shell nav, admin hub tiles, auto-open activities_manager, dashboard cache | back/forward, direct URL, all nav buttons, permissions, mobile shell, leave/return |
| הסרת final-fixes workaround | current visual/interaction behavior | RTL arrows, stale backdrop, instructor panel product decision, attendance status labels |
| persistent cache | PII/staleness/cross-user leakage | logout/user switch, TTL/version, storage quota, RLS revoked access, Ctrl+F5 semantics |
| RPC meetings snapshot | schema/RLS/date semantics shared עם scheduling | role matrix, date_1..35 parity, seasons, cancelled rows, timezone, query plan/load |

אין לשנות את query הגלובלי של `api.js` כדי לפתור בעיה מקומית בלי consumer audit. עדיף תחילה data service ייעודי ללוח או פונקציה מקומית עם contract מפורש.

---

## 12. המלצות מדורגות

הערכות החיסכון להלן הן **טווחי יעד מותנים**, לא תוצאה נמדדת. יש להחליף אותן במספרי trace לפני אישור implementation.

### רמה 1 — Low risk

1. **להוסיף single-flight ל־`loadBoardData`.**  
   בעיה: cache מכיל רק completed result. שינוי: Map של promise לפי period ולנקות ב־finally. חיסכון: עד קבוצה מלאה אחת של 6 requests במקרה overlap; 0ms במסלול יחיד. סיכון: נמוך. בדיקות: שני renders חופפים, rejection/retry, logout.
2. **לא לחסום על birthdays; להזריק section מאוחר.**  
   חיסכון: זמן הקריאה כאשר היא ה־straggler (0 ועד latency שלה). סיכון: נמוך־בינוני בגלל DOM hydration. בדיקות: birthdays present/empty/error, month switch, date-state observer.
3. **להפסיק ליצור/לחשב את פאנל המדריכים אם מוצרית הוא מוסר תמיד.**  
   שינוי: לא לטעון profiles ולא לחשב `instructorMonthStats`; לא render-then-remove. חיסכון: query אחד + CPU/DOM pass, מותנה במדידה. סיכון: נמוך רק לאחר אישור שהפאנל אכן אינו רצוי לכל role. בדיקות: role matrix ו־instructor center buttons ב־team strip.
4. **instrumentation זמני מובנה מאחורי flag.**  
   חיסכון ישיר: 0; מונע אופטימיזציה שגויה. סיכון: נמוך אם ללא PII ומוסר/כבוי. בדיקות: marks פעם אחת ובלי שינוי UI.

### רמה 2 — Medium risk

1. **cache/query לפי `period|manager` וסינון server-side.**  
   למנהל עצמי לטעון רק את עצמו; לאדמין לטעון manager ברירת מחדל ואז lazy בבחירה. חיסכון: יחסי לחלקו של המנהל ב־payload, לא ניתן לכמת לפני HAR. סיכון: name mapping, role behavior, RLS. בדיקות: כל roles, stored selection, aliases, switching, seasons.
2. **progressive shell ו־sections עצמאיים.**  
   calendar activities תחילה; calendar events/birthdays/team metadata אחר כך. יעד: useful content 1–2s גם אם secondary איטי. סיכון: observers ו־layout shift. בדיקות: slow/failing כל source בנפרד, keyboard/focus, mobile.
3. **לבטל את dashboard race.**  
   שינוי אפשרי: route/subroute ייעודי או await navigation mount לפני owner יחיד של root. חיסכון: render/loading כפול ועבודת dashboard מיותרת. סיכון: navigation lifecycle. בדיקות: פתיחה מכל route, cached/cold dashboard, back/forward, auto-open.
4. **לשתף data עם day drawer באופן projection-aware.**  
   lightweight rows ללוח; fetch detail לפי row id בעת click במקום `select('*')` לכל המנהל. חיסכון: drawer network/payload. סיכון: fields חסרים. בדיקות: כל drawer sections ומזהי row.
5. **לאחד attendance workflow requests.**  
   להעביר snapshot שכבר נטען ל־final-fixes במקום RPC נוסף. חיסכון: request אחד ב־attendance. סיכון: status semantics. בדיקות: submitted/manager-approved/final/reopened.

### רמה 3 — Architectural

1. **RPC ייעודי `get_manager_board_snapshot(manager, from, to, period)`.**  
   מחזיר activities/meetings מנורמלים, team summary ו־events מינימליים עם RLS server-side. חיסכון צפוי: round trips ו־payload משמעותיים; יש למדוד. סיכון: contract/migration/RLS גבוה. בדיקות: parity snapshot מול UI קיים וכל role/season.
2. **נרמול meeting dates במקום `date_1..date_35`.**  
   מאפשר range query/index ולא 35-column scan. סיכון גבוה מאוד למערכות scheduling/attendance/edit. דורש migration מדורג, dual-read/write ו־reconciliation.
3. **Manager Board כ־screen רשמי/data service משותף.**  
   owner יחיד ל־route, render ו־caches במקום runtimes שמתקנים זה את זה. חיסכון: predictability, פחות observers/races; לא רק latency. סיכון ארכיטקטוני גבוה. בדיקות E2E ידניות מלאות למסלול ולכל tab.

---

## 13. תוכנית תיקון מדורגת מוצעת

1. **Baseline בלבד:** trace מאומת של 5 scenarios, HAR + Supabase logs, ולמלא טבלת timings/bytes.
2. **Quick wins:** single-flight, birthdays non-blocking, והסרת query/profile/panel רק לאחר החלטת מוצר.
3. **Scope activities:** manager-scoped cache/query ו־lazy switching; להשוות payload ו־parity.
4. **Ownership:** לפתור dashboard race ולהפוך shell ל־immediate.
5. **Secondary/lazy:** calendar, roster, attendance ו־drawer לפי tab/action.
6. **רק אם המדידה מצדיקה:** snapshot RPC / meeting normalization.

### שערי הצלחה

- תגובת לחיצה + shell: frame ראשון/כמעט מיידי.
- useful calendar רגיל: יעד 1–2 שניות.
- query זהה: לכל היותר פעם אחת לכל key בזמן in-flight.
- secondary failure אינו מחזיר full-screen loading.
- אין cross-user cache, אין הרחבת הרשאות, ו־RLS נשאר מקור האכיפה.

---

## 14. רשימת regression לפני שינוי קוד

1. roles: admin, operation_manager, activities_manager, finance; unauthorized role אינו רואה/פותח.
2. פתיחה מ־dashboard cached/cold ומכל route אחר; back/forward; mobile sidebar; auto-open manager.
3. Auth: warm, cold restore, refresh token, expired token, signed-out ו־slow network.
4. periods: regular/summer_2026/school_2027; first/last month; stored manager/month invalid.
5. activities: active/closed, 1/2/35 sessions, two instructors, missing times, duplicate row ids, season aliases.
6. calendar: current + next milestones, multi-day holiday, blocking day, dedupe, birthdays, empty/error.
7. switching manager/month בזמן request; no stale result paints; no duplicate query.
8. instructor center: contact, snapshot failure, back, open full profile.
9. day drawer admin: correct date rows, full details, feature load failure, keyboard.
10. tabs: management, attendance, tracking, admin payroll; restored tab; month navigation isolation.
11. attendance statuses and approvals: all workflow states, review snapshot, cache expiry/retry.
12. logout/user switch/Ctrl+F5: caches cleared and no prior-user data.
13. observer stability: count renders/syncs, no feedback loop, no long task regression, no layout shift.
14. other screens: dashboard, Personal Reports, Attendance, Admin, scheduling, customer file, activities month/week.

## מסקנה

יש ראיות קוד ברורות ל־critical path רחב, payload עונתי, query/profile שאינו משפיע על DOM הסופי, היעדר in-flight dedupe ומרוץ ownership עם dashboard. אין עדיין ראיה שמספר הפעילויות כשלעצמו הוא הסיבה לאיטיות, ואין מספרי backend/frontend אמינים ללא session trace ולוגים. לכן הצעד הבא הנכון הוא baseline מדוד, ורק אחריו יישום רמה 1 באישור מפורש.

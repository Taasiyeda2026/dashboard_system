# AGENT EXECUTION TASKS — dashboard_system

## מטרת העבודה

לעבור על המערכת הקיימת ולשדרג אותה כך שתהיה תואמת לאפיון ה־UI/UX שנקבע, בלי לבנות הכל מחדש ובלי להחליף סטאק.

המערכת כבר קיימת ועובדת.
העבודה הנכונה היא:
- לא לעשות rewrite מלא
- לא לעבור לפריימוורק אחר
- לא לשבור את ה־API הקיים מול Apps Script
- כן לחזק את שכבת ה־shell, הניווט, רכיבי ה־UI, האינטראקציות, הלוחות, והמובייל
- כן להפוך את המערכת ליותר עקבית, יותר שימושית, ויותר תואמת לאפיון

---

## סטאק קיים — חובה לשמר

- Frontend: Vanilla JS עם ES modules
- Backend: Google Apps Script
- Data source: Google Sheets
- UI language: Hebrew
- Direction: RTL
- PWA: קיים בסיס
- Routing: client-side state-based, ללא framework router

אין להעביר את המערכת ל־React / Vue / Next / Vite / Tailwind.
יש לעבוד בתוך המבנה הקיים.

---

## עקרונות עבודה מחייבים

1. לא לבצע rewrite מלא אם אפשר לשפר את הקיים.
2. להשתמש ברכיבי ה־design system הקיימים (`ds*`) ולהרחיב אותם במקום לפזר markup חדש אקראי.
3. לשמור על RTL מלא ועברית מלאה למשתמש.
4. לשמור על dark shell + light content.
5. לא להוסיף גרפים, אנימציות כבדות או UI ראוותני.
6. לא לשנות לוגיקת הרשאות, מודל נתונים או חוזי API בלי צורך אמיתי.
7. כל שינוי צריך להיות ממוקד, מודולרי, וניתן לבדיקה.
8. לעבוד לפי שלבים, מהתשתית אל המסכים, ולא להתחיל ממסכים בודדים לפני שיש רכיבי בסיס.

---

## ממצאים עיקריים במערכת הקיימת

### מה כבר קיים
- app shell בסיסי
- sidebar בדסקטופ
- top bar בסיסי
- מסכים בעברית
- RTL ברמת HTML וב־CSS
- כרטיסים, טבלאות, chips, filter bar
- מסכי dashboard / activities / week / month / permissions / my-data
- cache בסיסי למסכים
- service worker בסיסי
- manifest בסיסי

### מה חסר או חלקי
- במובייל אין drawer אמיתי עם hamburger + backdrop + close behavior
- ה־sidebar במובייל מתנהג כרצועת ניווט אופקית, לא כפאנל נפתח
- KPI cards אינם רכיבים לחיצים עם drill-down
- cards של אחראי פעילות אינם אינטראקטיביים
- rows/cards במסכי פעילות אינם פותחים drawer / inline details
- אין מערכת drawer משותפת
- אין מערכת modal משותפת לפעולות קצרות
- מסך שבוע אינו לוח עבודה מלא
- מסך חודש אינו לוח חודש אמיתי עם weekday headers + detail panel
- אין detail side panel עבור יום/פעילות
- טבלאות בחלק מהמסכים אינן מקבלות fallback אוטומטי למובייל
- חלק מהאינטראקציות דורשות polish של hover / active / disabled / focus
- config מכיל API URL קשיח
- ה־README וה־backend packaging אינם עקביים

---

## מה לא לעשות

- לא למחוק את המבנה הקיים ולהתחיל מחדש
- לא להחליף את מנגנון ה־state הקיים
- לא לשבור שמות routes קיימים
- לא לשנות את צורת הקריאות ל־Apps Script בלי צורך
- לא להמציא שפה עיצובית חדשה
- לא להפוך כל פעולה ל־modal
- לא לעבור עמוד חדש כשאפשר drawer / inline expansion
- לא להשאיר מסכי מובייל כגרסת desktop דחוסה
- לא לשנות permissions/business rules ללא צורך

---

## סדר ביצוע מחייב

# PHASE 1 — Foundation cleanup

## Task 1.1 — יישור תיעוד ו־repo setup
בצע audit של מבנה ה־repo ועדכן את התיעוד כך שישקף את המציאות בפועל.

מה לבצע:
- לבדוק איפה באמת נמצא קוד ה־Apps Script הפעיל
- אם `backend/Code.gs` אמור להיות entrypoint אמיתי — למלא אותו/לייצא אליו את הקוד בפועל
- אם הקוד מפוצל לקבצים אחרים — לעדכן README בהתאם
- לוודא שהוראות setup אמיתיות וניתנות לביצוע

תוצאה נדרשת:
- ה־README תואם את מבנה הריפו בפועל
- אין קובץ setup מרכזי ריק כאשר התיעוד מפנה אליו

---

## Task 1.2 — ריכוז טוקנים וקונבנציות UI
הרחב את שכבת ה־design tokens הקיימת במקום להמשיך פיזור סטיילים נקודתיים.

מה לבצע:
- לשמור על palette הקיימת
- להשלים טוקנים לרכיבי interactive states
- להשלים naming עקבי ל־surface / border / muted / status / focus / overlay
- להגדיר סט בסיסי עבור drawer, modal, backdrop, interactive card, day cell, session card

תוצאה נדרשת:
- כל רכיב חדש נשען על tokens קיימים/מורחבים
- אין hard-coded styles מפוזרים ללא צורך

---

## Task 1.3 — ביטול תלות ב־API URL קשיח
הסר את התלות הישירה בכתובת API קשיחה בתוך הקוד.

מה לבצע:
- להשאיר `config.js` כמקור יחיד
- לא לפזר URLs בעוד מקומות
- אם צריך, לאפשר החלפה קלה בין dev / prod בלי לגעת בלוגיקה
- לא לשבור את השימוש הקיים ב־`config.apiUrl`

תוצאה נדרשת:
- כתובת ה־API מוגדרת במקום אחד בלבד
- קל להחליף endpoint בלי לגעת בשאר הפרויקט

---

# PHASE 2 — App shell and mobile navigation

## Task 2.1 — הפיכת הניווט במובייל ל־drawer אמיתי
החלף את התנהגות הניווט האופקי במובייל ב־off-canvas drawer.

מה לבצע:
- להוסיף כפתור hamburger קבוע ב־top bar
- להוסיף mobile drawer נפתח מהצד
- להוסיף backdrop כהה
- לאפשר close בלחיצה על backdrop
- לאפשר close לאחר מעבר route
- לשמור על desktop sidebar כמו שהוא, עם שיפורים קלים בלבד
- לשמור על RTL גם בפתיחת drawer

תוצאה נדרשת:
- desktop = sidebar קבוע
- mobile = drawer אמיתי
- אין horizontal nav strip כפתרון ראשי במובייל

---

## Task 2.2 — שיפור top bar
לחזק את ה־top bar כך שיהיה שימושי גם במובייל וגם בדסקטופ.

מה לבצע:
- להוסיף hamburger במובייל
- לשמור branding מינימלי
- לשמור logout ברור
- לא להעמיס controls
- לאפשר מקום עתידי ל־screen actions אם יהיה צורך

תוצאה נדרשת:
- top bar יציב, מינימלי וברור
- התנהגות עקבית בין מסכים

---

# PHASE 3 — Shared interaction layer

## Task 3.1 — יצירת drawer system משותף
הוסף שכבת drawer reusable לכל המערכת.

מה לבצע:
- ליצור רכיב/utility משותף ל־side panel
- לפתוח אותו מתוך cards / rows / day cells / session cards
- לכלול header, close action, content area
- לאפשר scroll פנימי
- להתאים ל־RTL
- להתאים למובייל ולדסקטופ

תוצאה נדרשת:
- יש drawer אחיד במערכת
- לא מממשים כל פתיחה מחדש בכל מסך

---

## Task 3.2 — יצירת modal system משותף
הוסף modal משותף, אבל רק לפעולות קצרות.

מה לבצע:
- ליצור modal reusable לאישור/טופס קצר
- במובייל modal יתנהג כ־bottom sheet או full-width
- לא להשתמש ב־modal לתצוגת מידע ארוכה
- לא להשתמש בו במקום drawer

תוצאה נדרשת:
- modal משותף ונקי
- שימוש בו רק כשזה באמת נכון

---

## Task 3.3 — interactive cards
להוסיף וריאציה ברורה של cards לחיצים.

מה לבצע:
- clickable KPI card
- clickable mini card
- clickable day cell
- clickable session card
- hover / active / focus states עקביים
- לא להפוך cards סטטיים ללחיצים בלי פעולה ברורה

תוצאה נדרשת:
- כל card לחיץ נראה לחיץ
- לכל לחיצה יש תוצאה צפויה

---

# PHASE 4 — Dashboard

## Task 4.1 — KPI cards לחיצים עם drill-down
הפוך את כרטיסי ה־KPI בדשבורד לאינטראקטיביים.

מה לבצע:
- להגדיר פעולה ברורה לכל KPI
- לחיצה תוביל למסך רלוונטי עם filter state מתאים
- לא לפתוח popup אקראי
- לשמר עיצוב קומפקטי

מיפוי מומלץ:
- קצרות -> activities filtered
- ארוכות -> activities filtered
- מדריכים -> instructors
- מסיימים החודש -> activities/finance filtered לפי מה שמתאים למבנה הנתונים

תוצאה נדרשת:
- כל KPI מוביל ל־drill-down ברור

---

## Task 4.2 — mini cards של אחראי פעילות
הפוך את כרטיסי אחראי הפעילות לאינטראקטיביים.

מה לבצע:
- לחיצה על mini-card תסנן פעילויות לפי אותו אחראי
- לשמור visual hierarchy עדינה
- לא להעמיס יותר מדי נתונים בתוך הכרטיס

תוצאה נדרשת:
- ה־dashboard לא רק מציג summary אלא גם משמש נקודת כניסה לעבודה

---

# PHASE 5 — Activities screen

## Task 5.1 — חיזוק אזור המסננים
שדרג את activities filters כך שירגישו כמו אזור מסננים אמיתי.

מה לבצע:
- לשמור tabs/chips הקיימים
- להוסיף clear filters ברור
- להפריד בין filter bar לבין view controls
- לדאוג שמצב מסנן פעיל יהיה ברור
- לא להעמיס מסננים לא קיימים

תוצאה נדרשת:
- מסך activities מרגיש כמסך עבודה ולא כרשימה בלבד

---

## Task 5.2 — פתיחת שורה/כרטיס לפירוט
הוסף detail flow לפעילות.

מה לבצע:
- table row או compact row יהיו לחיצים
- לחיצה תפתח drawer או inline expansion
- בפירוט להציג:
  - שם פעילות
  - RowID
  - סוג פעילות
  - תאריכים
  - מדריכים
  - סטטוס כספי
  - הערות אם מותר לפי הרשאה
- לא לעבור לעמוד חדש

תוצאה נדרשת:
- activities הופך למסך usable עם detail flow אמיתי

---

## Task 5.3 — תצוגת מובייל אוטומטית
אל תסתמך רק על toggle ידני עבור מובייל.

מה לבצע:
- לשמור אפשרות compact אם צריך
- אבל במובייל קטן הטבלה לא תהיה ברירת מחדל דחוסה
- ליצור auto-fallback נוח יותר למסכים צרים

תוצאה נדרשת:
- activities קריא במובייל גם בלי forcing table

---

# PHASE 6 — Week screen

## Task 6.1 — בנייה מחדש של מסך שבוע כלוח עבודה אמיתי
שדרג את week screen ממערך כרטיסים בסיסי ללוח שבוע אמיתי.

מה לבצע:
- desktop:
  - 7 עמודות
  - כותרת יום
  - תאריך
  - מונה/סיכום קטן
  - session cards בתוך כל יום
- mobile:
  - ימים זה מתחת לזה
  - כל יום כ־section card
- highlight עדין ליום הנוכחי
- session cards צריכים להיות לחיצים
- לחיצה תפתח detail drawer

תוצאה נדרשת:
- week screen מרגיש כמו לוח עבודה, לא כמו grid כללי

---

## Task 6.2 — session cards
להגדיר session card ברור למסך השבוע.

מה לבצע:
- לכל session card להציג:
  - שם
  - מזהה
  - אולי מדריך/סטטוס אם זמין
- לשמור על קומפקטיות
- למנוע עומס טקסט

תוצאה נדרשת:
- ניתן לסרוק יום במהירות וללחוץ לפירוט

---

# PHASE 7 — Month screen

## Task 7.1 — בנייה מחדש של month screen כלוח חודש אמיתי
שדרג את month screen כך שיהיה calendar אמיתי.

מה לבצע:
- להוסיף weekday header row
- לשמור על 7 עמודות אמיתיות
- כל day cell יציג:
  - מספר יום
  - count או dot indicator
  - חריגה אם קיימת
- day cell יהיה לחיץ
- לחיצה תפתח detail panel / side drawer

תוצאה נדרשת:
- month screen מרגיש כמו לוח שנה
- לא כמו grid פשוט של counters

---

## Task 7.2 — תיקון מבנה render במסך חודש
לבדוק ולתקן בעיית מבנה קיימת במסך חודש כדי למנוע nesting לא נכון של grid wrappers.

מה לבצע:
- לוודא שאין wrapper כפול של month grid
- לוודא empty state לא נשבר בתוך grid
- לשמור מבנה DOM נקי

תוצאה נדרשת:
- month DOM תקין
- layout יציב

---

# PHASE 8 — Other table screens

## Task 8.1 — my-data mobile usability
שדרג את my-data למסך usable יותר במובייל.

מה לבצע:
- להוסיף compact fallback
- לאפשר detail expansion
- לשמור על עמודות עיקריות בלבד בתצוגה הראשית
- פירוט מלא ב־drawer

תוצאה נדרשת:
- המסך לא נשאר רק טבלה רחבה

---

## Task 8.2 — permissions usability
לשפר את permissions screen בלי לשנות business logic.

מה לבצע:
- לשמור edit capability הקיימת
- לבדוק אם במובייל נכון יותר compact rows + action area
- אם צריך, לבצע עריכה ב־drawer או modal קצר במקום table-only interaction
- לא לשבור save flow

תוצאה נדרשת:
- הרשאות נשארות ניתנות לעריכה, אבל המסך יותר ברור ונוח

---

# PHASE 9 — Design system consistency

## Task 9.1 — status chips
ליצור family עקבית של status chips.

מה לבצע:
- success / warning / danger / neutral
- גודל אחיד
- צבעים עדינים
- שימוש עקבי בכל המסכים

תוצאה נדרשת:
- status appearance אחיד

---

## Task 9.2 — page hierarchy consistency
לאחד hierarchy בין המסכים.

מה לבצע:
- בכל מסך:
  - page header
  - subtitle
  - filters אם צריך
  - summary blocks אם צריך
  - main card/table/grid
  - detail area אם צריך
- להסיר layout drift בין מסכים

תוצאה נדרשת:
- כל מסך מרגיש חלק מאותה מערכת

---

## Task 9.3 — spacing / typography / radii / shadows polish
ללטש את שכבת הוויזואליה בלי לשנות שפה גרפית.

מה לבצע:
- לעבור על spacing
- לעבור על font hierarchy
- לעבור על radius consistency
- לעבור על shadow usage
- לא להוסיף אפקטים מיותרים

תוצאה נדרשת:
- UI מסודר, רגוע ועקבי

---

# PHASE 10 — Accessibility and states

## Task 10.1 — states מלאים לכל רכיב לחיץ
להשלים states לכל interactive element.

מה לבצע:
- hover
- active
- focus-visible
- disabled
- selected

תוצאה נדרשת:
- חוויית שימוש מקצועית וברורה

---

## Task 10.2 — touch targets
לוודא שכל רכיבי המובייל נוחים ללחיצה.

מה לבצע:
- minimum touch target
- buttons / chips / toggles / drawer actions
- spacing שלא גורם לטעויות לחיצה

תוצאה נדרשת:
- מובייל usable באמת

---

# PHASE 11 — PWA and deployment hygiene

## Task 11.1 — polish ל־PWA
לא לשכתב, רק לוודא שהבסיס תקין.

מה לבצע:
- לבדוק manifest paths
- לבדוק service worker asset coverage
- להוסיף assets חסרים אם צריך
- לוודא shell caching לא שובר updates

תוצאה נדרשת:
- PWA בסיסי תקין ויציב

---

## Task 11.2 — deploy sanity
לשפר את יכולת הפריסה והתחזוקה.

מה לבצע:
- לוודא שמי שפותח את הריפו מבין איך מריצים frontend
- איך מעדכנים API URL
- איך מעלים backend ל־Apps Script
- איך משחררים שינויים בלי ambiguity

תוצאה נדרשת:
- הפרויקט קריא ובר־תחזוקה גם אחרי handoff

---

## קריטריוני קבלה

העבודה תיחשב גמורה רק אם:

1. desktop sidebar נשאר קבוע וברור
2. mobile navigation הוא drawer אמיתי עם hamburger + backdrop
3. KPI cards לחיצים ומבצעים drill-down ברור
4. dashboard mini cards לחיצים
5. activities rows/cards פותחים detail drawer/inline details
6. week screen הוא לוח שבוע אמיתי
7. month screen הוא לוח חודש אמיתי
8. day cell ו־session card לחיצים
9. יש drawer משותף
10. יש modal משותף לפעולות קצרות בלבד
11. my-data ו־permissions usable במובייל
12. states ו־focus נראים תקינים
13. RTL מלא נשמר בכל המסכים
14. עברית מלאה נשמרת בכל טקסטי המשתמש
15. לא בוצע rewrite לסטאק
16. לא נשברו API contracts קיימים
17. ה־README תואם את מבנה הריפו בפועל

---

## Definition of Done

לפני סיום, לבצע בדיקות ידניות לפחות עבור:

- login
- session restore
- route switching
- mobile nav open/close
- activities filters
- KPI drill-down
- dashboard manager card click
- week day/session click
- month day click
- permissions save
- RTL בכל המסכים
- responsive behavior ב־mobile / tablet / desktop
- hover / focus / active / disabled
- logout
- service worker / manifest sanity

---

## אופן ביצוע נכון

לבצע לפי הסדר הבא:
1. foundation + setup cleanup
2. app shell + mobile nav
3. shared drawer/modal/interactions
4. dashboard
5. activities
6. week
7. month
8. remaining screens
9. polish + accessibility + PWA
10. final README/update notes

לא להתחיל מ־month/week לפני שיש drawer system.
לא להתחיל מ־visual polish לפני שהאינטראקציות קיימות.
לא לעשות rewrite.

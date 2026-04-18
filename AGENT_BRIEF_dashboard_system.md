# AGENT IMPLEMENTATION BRIEF
**Repository target:** `Taasiyeda2026/dashboard_system`  
**Reference repository for business logic only:** `Taasiyeda2026/dev`

קרא קודם את `AGENTS.md` שבשורש הריפו ופעל לפיו.

---

## מטרת המשימה
להשלים ב-`dashboard_system` את הלוגיקה העסקית וההתנהגות החסרה של המערכת, תוך שימוש ב-`dev` כרפרנס ללוגיקה עסקית בלבד.

### כללים עליונים
- אין לבצע rewrite.
- אין להחליף סטאק.
- יש לשמור על ה-UI shell, ה-design system, ה-drawer / modal / shared interaction layer.
- יש לשמור RTL מלא, עברית מלאה, ו-`dark shell + light panels`.
- יש להרחיב את המערכת הקיימת, לא לבנות מערכת חדשה.

---

## החלטות עסקיות מחייבות

### 1. חריגות
מסך **חריגות** במערכת החדשה תקין.

#### מותר:
- תיקוני באגים
- polish
- שיפורי usability
- התאמות למובייל
- שיפורי drawer / detail flow

#### אסור:
- להחליף את המסך בלוגיקה הישנה
- להחזיר את מנוע החריגות הישן במקום הקיים
- לשנות את ההיגיון העסקי של המסך בלי הוראה מפורשת נוספת

---

### 2. מדריכים מול אנשי קשר-מדריכים
מסך **מדריכים** ומסך **אנשי קשר-מדריכים** הם שני דברים שונים.

#### כללים:
- אין למזג ביניהם.
- `instructors` = מסך מדריכים תפעולי / מאסטר של מדריכים.
- `instructor-contacts` = מסך אנשי קשר של מדריכים.
- אין להשתמש במסך `contacts` הכללי כתחליף למסך `instructors`.
- אם כיום `contacts` כולל גם מדריכים וגם בתי ספר, יש לפצל נכון את המידע:
  - `instructors` נשאר מסך נפרד
  - `instructor-contacts` הופך למסך נפרד
  - `contacts` הכללי יכול להישאר עבור בתי ספר / רשויות / גורמים אחרים בלבד, אם זה תואם לנתונים

---

### 3. מודל העריכה
מודל העבודה החדש הוא **עריכה ישירה במסכים**, לא workflow ישן של בקשות ואישורים.

#### כללים:
- כל role שאמור לצפות במסך עבודה, אמור גם להיות מסוגל לערוך בו את הנתונים הרלוונטיים.
- **Instructor role הוא read-only בכל המערכת.**
- למדריכים מותרת צפייה בלבד, בלי עריכה בכלל.
- אין להחזיר את workflow הישן של `edit requests / approvals / eden / final approvals` כזרימת העבודה הראשית.
- אם קיימים endpointים ישנים כמו `submitEditRequest` / `reviewEditRequest`, לא למחוק אותם כרגע, אבל גם לא להפוך אותם לליבת המוצר.
- הזרימה הראשית היא **direct edit** במסכים עצמם, עבור כל מי שיש לו גישה למסך והוא **אינו instructor**.

---

### 4. קדימות בין המערכות
אם יש פער בין `dev` לבין הכללים במסמך זה:
- המסמך הזה גובר.
- `dev` הוא מקור השראה ללוגיקה עסקית, לא מקור סמכות סופי.

---

## עקרונות ביצוע
1. העדף הרחבה של המבנה הקיים, לא החלפה שלו.
2. העדף backend business logic במקום client hacks.
3. שמור API contracts קיימים ככל האפשר.
4. אם נדרש מסך חדש, חבר אותו דרך הארכיטקטורה הקיימת:
   - `router.gs`
   - `actions.gs`
   - `auth.gs`
   - `frontend/src/main.js`
   - screen registry / labels / routes
5. כל שינוי חדש חייב לעבוד גם בדסקטופ וגם במובייל.
6. כל edit flow חייב להיות ברור, מקומי, ועם invalidation תקין של cache.
7. אל תבנה ארכיטקטורת permissions חדשה. הרחב את הקיימת.

---

# SCOPE REQUIRED

## A. Dashboard
### מטרה
להחזיר למסך הדשבורד תפקיד של שער עבודה ניהולי, לא רק summary.

### מה לבצע
1. להרחיב KPI כך שישקפו תמונת מצב תפעולית משמעותית יותר.
2. לשמור על drill-down ברור מכל KPI.
3. להחזיר KPI חסרים רלוונטיים מתוך הלוגיקה העסקית של המערכת הישנה, כל עוד הם תואמים לכללים החדשים.
4. לחבר KPI למסכים או לפילטרים אמיתיים, לא לכרטיסים ללא פעולה.
5. לשמור על ה-UI החדש, אבל להשלים את הלוגיקה.

### מומלץ להחזיר / להשלים
- פעילויות קצרות
- פעילויות ארוכות
- מדריכים
- מסיימים החודש
- פעילויות פעילות החודש
- KPI תפעוליים נוספים שנמצאים ב-`dev` אם הם עדיין רלוונטיים עסקית

### מה לא לעשות
- לא להפוך את הדשבורד למסך כבד או עמוס מדי
- לא ליצור KPI ללא drill-down

---

## B. Activities screen
### מטרה
להפוך את `activities` למסך עבודה אמיתי.

### מה לבצע
1. להרחיב סינון:
   - `activity type`
   - `finance status`
   - משפחת פעילות
   - `activity manager`
   - `authority`
   - `school`
   - `instructor`
   - חודש / תקופה אם יש הצדקה עסקית
2. לשמור `clear filters` ברור.
3. להוסיף direct edit מתוך המסך למי שאינו `instructor` ויש לו גישה למסך.
4. להוסיף `add activity` אם זה חלק מהלוגיקה הקיימת והמסך / role אמור לתמוך בזה.
5. עבור פעילויות ארוכות:
   - לאפשר טיפול במפגשים אם זה חלק מה-data model.
6. לשמור על drawer לפירוט.
7. במובייל לשמור על `compact / list / card fallback` תקין.

### כלל הרשאות למסך זה
- מי שרואה את המסך ואינו `instructor`, צריך להיות מסוגל לערוך ממנו.
- `instructor` רואה רק את הנתונים שלו, בלי עריכה.

---

## C. Week screen
### מטרה
לתקן את הסמנטיקה של השבוע.

### שינוי חובה
מסך שבוע **לא יכול** להתבסס רק על:
- `start_date <= day <= end_date`

הוא צריך להתבסס על **מפגשים אמיתיים**.

### מה לבצע
1. לבסס week על `meeting dates` בפועל, לא רק על טווח תאריכים.
2. לשמור על לוח שבוע אמיתי ורספונסיבי.
3. `session cards` נשארים לחיצים ופותחים drawer.
4. להחזיר ניווט שבועי אמיתי אם הוא חסר:
   - שבוע קודם
   - שבוע הבא
   - חזרה לשבוע נוכחי אם צריך
5. להוסיף grouping / clarity לפי יום.
6. לשמור על `current day highlight` עדין.

---

## D. Month screen
### מטרה
לתקן את הסמנטיקה של החודש.

### שינוי חובה
מסך חודש גם הוא צריך להתבסס על **מפגשים אמיתיים**, לא על טווחי קורס.

### מה לבצע
1. `day cells` צריכים להציג פעילות לפי תאריכי מפגש בפועל.
2. לחיצה על יום פותחת drawer עם פירוט אמיתי לאותו יום.
3. להוסיף ניווט בין חודשים אם חסר.
4. לשמור על:
   - 7 עמודות
   - weekday headers
   - DOM נקי
   - calendar feeling אמיתי
5. לא להפוך את החודש לרשימה כללית.

---

## E. End dates screen
### מטרה
להחזיר מסך ייעודי של סיומי פעילויות / קורסים, במקום להסתמך רק על פילטר מקומי מתוך `activities`.

### מה לבצע
1. ליצור מסך ייעודי `end-dates`.
2. לחבר אותו לרשימת:
   - routes
   - labels
   - permissions
   - bootstrap
3. להציג בו פעילויות שמסיימות בחודש / טווח רלוונטי.
4. לאפשר drill-down ו-edit לפי כללי ההרשאות החדשים.
5. `instructor` לא עורך.

### הערה
אם כבר קיימת לוגיקת `ending current month` ב-dashboard או activities, אפשר למחזר אותה, אבל המסך צריך להיות עצמאי.

---

## F. Finance screen
### מטרה
להפוך את `finance` למסך כספים אמיתי, לא רשימה כללית של כל הפעילויות.

### שינוי חובה
לא להישאר עם `allActivities mapped into finance`.

### מה לבצע
1. להחזיר כלל עסקי ברור של מה בכלל נכנס למסך `finance`.
2. להחזיר מיון / פילוח נכון לכספים.
3. לשקול `active / archive separation` אם זה עדיין רלוונטי ל-data model.
4. להחזיר `status handling` ברור.
5. לאפשר direct edit במסך למי שרואה אותו ואינו `instructor`.
6. לשמור על mobile usability.
7. להציג רק שדות כספיים רלוונטיים למסך כספים.

### מה לא לעשות
- לא להשאיר `finance` כמסך תצוגה גנרי של כל המערכת.

---

## G. Instructors screen
### מטרה
לשמר מסך מדריכים נפרד, שאינו מסך אנשי קשר.

### מה לבצע
1. להגדיר את `instructors` כמסך master / operational של מדריכים.
2. להציג בו נתונים תפעוליים או נתוני ליבה של מדריך, לא רק contact directory.
3. לשמור drawer / detail flow.
4. אם role כלשהו רואה את המסך והוא אינו `instructor`, הוא יכול לערוך בו.
5. `instructor role` לא עורך.

### חשוב
אין למזג את המסך הזה למסך `instructor-contacts`.

---

## H. Instructor contacts screen
### מטרה
ליצור / להחזיר מסך נפרד לאנשי קשר-מדריכים.

### מה לבצע
1. ליצור מסך נפרד `instructor-contacts` אם אינו קיים.
2. להשתמש בו עבור פרטי קשר של מדריכים.
3. אם `contacts` הנוכחי כולל גם `instructors` וגם `school contacts`:
   - לפצל
   - לא להשאיר מסך מעורבב
4. לשמור על mobile fallback טוב.

---

## I. Contacts screen
### מטרה
להשאיר `contacts` כמסך נפרד עבור גורמי קשר שאינם `instructors`, אם זה תואם לנתונים.

### מה לבצע
1. להוציא ממנו את `instructor contact directory` אם היום הוא משולב.
2. להשאיר בו:
   - `school contacts`
   - `authorities`
   - `other contacts`
   אם זה נכון עסקית.
3. לאחד naming ברור בניווט.

---

## J. My Data
### מטרה
לשמור על מסך פשוט ויעיל.

### מה לבצע
1. `instructor` רואה רק את הנתונים שלו.
2. `instructor` לא עורך.
3. roles שאינם `instructor` וצופים במסך הזה יכולים לערוך רק אם זה נדרש עסקית למסך הזה, ובהתאם לכלל `view implies edit`.
4. לשמור drawer detail תקין.

---

## K. Permissions screen
### מטרה
להרחיב את מסך ההרשאות כך שינהל באמת את ה-permission model הקיים.

### מה לבצע
1. לא להסתפק רק ב-`display_role` ו-`active`.
2. לנהל גם:
   - `default_view`
   - `view_* flags`
   - `can_request_edit` אם עדיין נשאר בשימוש משני
   - `can_edit_direct` אם עדיין נשאר בשימוש משני
   - `can_add_activity`
   - `can_review_requests` אם עדיין נשאר בשימוש משני
3. לחבר את bootstrap והרשאות המסכים לשדות הללו.
4. לשמור edit usable גם במובייל.
5. לא לבנות permission editor חדש מאפס אם אפשר להרחיב את הקיים.

---

## L. Exceptions
מסך `exceptions` נשאר כפי שהוא מבחינת לוגיקה עסקית.

### מותר:
- תיקון באגים
- polish
- usability
- mobile
- drawer / detail improvements

### אסור:
- להחליף אותו בלוגיקה הישנה
- לשנות את ההיגיון העסקי שלו

---

# NON-GOALS
1. לא להחזיר את כל ה-workflow הישן של `requests / approvals / eden` כמרכז המערכת.
2. לא לבנות מחדש את כל `dev` בתוך `dashboard_system`.
3. לא להחליף UI layer.
4. לא להחליף auth model כולו.
5. לא לבצע refactor רחב שלא נדרש לתוצאה העסקית.

---

# TECHNICAL IMPLEMENTATION NOTES

## קבצים שסביר שיידרשו שינוי
- `frontend/src/main.js`
- `frontend/src/api.js`
- `frontend/src/screens/dashboard.js`
- `frontend/src/screens/activities.js`
- `frontend/src/screens/week.js`
- `frontend/src/screens/month.js`
- `frontend/src/screens/finance.js`
- `frontend/src/screens/instructors.js`
- `frontend/src/screens/contacts.js`
- `frontend/src/screens/my-data.js`
- `frontend/src/screens/permissions.js`

## מסכים חדשים אם צריך
- `frontend/src/screens/end-dates.js`
- `frontend/src/screens/instructor-contacts.js`

## Backend
- `backend/router.gs`
- `backend/actions.gs`
- `backend/auth.gs`
- `backend/sheets.gs`
- `backend/helpers.gs`
- `backend/config.gs`

## אם מוסיפים routes חדשים
יש לעדכן:
- bootstrap
- `buildRoutesFromPermission_`
- `screenLabels`
- `screens registry`
- `permission mapping`

---

# ACCEPTANCE CRITERIA

## 1. Dashboard
- KPI מורחבים
- drill-down עובד
- dashboard משמש נקודת כניסה לעבודה

## 2. Activities
- מסך עבודה אמיתי
- direct edit עבור מי שאינו `instructor` ורואה את המסך
- `instructor` ללא עריכה
- פילטרים שימושיים
- mobile fallback טוב

## 3. Week / Month
- מבוססי מפגשים אמיתיים
- לא מבוססי טווחי קורס בלבד
- drawer detail תקין
- RTL + mobile תקינים

## 4. End dates
- קיים מסך ייעודי
- מחובר להרשאות ולניווט
- drill-down ו-edit לפי הכללים

## 5. Finance
- מסך כספים אמיתי
- לא רשימה גנרית של כל הפעילויות
- direct edit עבור `non-instructor viewers`

## 6. Instructors / Instructor Contacts
- שני מסכים נפרדים
- אין מיזוג ביניהם
- `contacts` לא משמש תחליף ל-`instructors`

## 7. Permissions
- ניהול אמיתי של שדות ההרשאה
- לא רק `role + active`

## 8. Exceptions
- נשאר לוגית כפי שהוא
- לא הוחלף

## 9. Edit model
- `non-instructor viewer => edit where relevant`
- `instructor => read-only everywhere`

---

# REPORT FORMAT REQUIRED
בסיום דווח בדיוק:
1. מה בוצע
2. אילו מסכים הושלמו
3. אילו מסכים חדשים נוספו
4. אילו קבצים שונו
5. אילו שדות / לוגיקות הועברו מה-reference logic
6. מה במכוון לא הוחזר כי אינו תואם למסמך הזה
7. אילו חסימות נשארו, אם בכלל
8. האם המערכת עומדת עכשיו בהנחיות המסמך הזה

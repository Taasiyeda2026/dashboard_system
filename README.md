1. מה המערכת הזאת

זו מערכת פנימית קטנה לניהול, בקרה ותפעול של פעילויות הארגון.

המטרה שלה היא לא להיות מערכת BI כבדה ולא מערכת ERP, אלא מערכת עבודה יומיומית פשוטה, מהירה, קומפקטית, ברורה, ומדויקת.

המערכת מיועדת בעיקר ל:

סמנכ״ל כספים ותפעול
מבקרת תפעול
משתמשים מורשים שמנהלים פעילויות
מדריכים
2. עקרונות יסוד
זו מערכת חדשה לגמרי, מאפס.
אין תלות במערכת הישנה.
לא משמרים קוד ישן.
לא משמרים מבנה ישן.
כן שומרים רק את ההיגיון העסקי שצריך.
המערכת צריכה להיות פשוטה, לא כבדה.
כל מה שאפשר לעשות בכפתור קטן, inline action, drawer, modal או שדה קצר — לעשות כך.
התאמה מלאה למובייל.
PWA מלאה.
מסך אחד צריך לעשות דבר אחד ברור.
3. טכנולוגיה וארכיטקטורה
Frontend
Vanilla JS ES Modules
RTL מלא
mobile first
בלי React / Vue / frameworks כבדים
Backend
Google Apps Script
כל קריאה וכתיבה עוברת דרך Apps Script
Data Source
Google Sheets בלבד כמקור אמת
Repository
GitHub repo חדש בלבד
כלל טכני חשוב

ה־frontend לא ניגש ישירות ל־Sheets.
הוא ניגש רק ל־Apps Script API.

4. מבנה המערכת – מסכים סופיים

המערכת תכלול רק את המסכים הבאים:

Login
Dashboard
Activities
Week
Month
Exceptions
Finance
Instructors
Contacts
My Data
Permissions
לא לכלול
מסך הגדרות
מסך רשימות
מערכת אישורים גדולה
workflow מורכב
מסכי BI כבדים
מסכים מיותרים
5. מבנה הנתונים – גיליונות סופיים
data_short
data_long
activity_meetings
permissions
lists
contacts_instructors
contacts_schools
edit_requests
operations_private_notes
6. מקור האמת של כל דבר
data_short

מקור אמת לפעילויות קצרות, של יום אחד.

data_long

מקור אמת לפעילויות ארוכות, עם הרבה תאריכים.

activity_meetings

מקור אמת לתאריכי המפגשים של פעילויות ארוכות בלבד.

permissions

מקור אמת להרשאות.

lists

מקור אמת לרשימות סגורות.

contacts_instructors

מקור אמת לפרטי מדריכים.

contacts_schools

מקור אמת לפרטי בתי ספר ואנשי קשר.

edit_requests

בקשות שינוי בלבד. לא מקור אמת לדאטה.

operations_private_notes

הערות פרטיות של מבקרת התפעול בלבד.

7. חלוקת סוגי הפעילות
data_short

לפעילויות של יום אחד:

workshop
tour
escape_room
כל פעילות חד־יומית
data_long

לפעילויות של הרבה תאריכים:

course
after_school
כל פעילות רב־מפגשית
8. לוגיקת תאריכים
ב־data_short

יש רק תאריך אחד:

start_date

זה תאריך 1.

ב־data_long

לא שומרים את כל התאריכים בתוך השורה.

יש:

start_date
end_date

אבל הם מחושבים מתוך activity_meetings.

ב־activity_meetings

כל שורה היא מפגש אחד.

9. מדריכים
ב־data_short

יש:

מדריך 1
מדריך 2
ב־data_long

יש:

מדריך 1 בלבד
direct_manager

לא נשמר ב־data.
הוא נשמר ב־contacts_instructors.

10. הרשאות – מודל סופי

יש 4 סוגי משתמשים:

1. Admin
רואה הכל
עורך ישירות את הדאטה
מוסיף ישירות
לא צריך אישור
2. Operations Reviewer
רואה מסכים עסקיים
עורכת ישירות
מוסיפה ישירות
בודקת ומאשרת בקשות שינוי
רואה וכותבת הערות פרטיות
3. Authorized User
רואה מסכים לפי הרשאה
לא עורך ישירות את הדאטה
יכול להגיש בקשת שינוי
לא מוסיף ישירות
4. Instructor
רואה רק את המסך האישי שלו
לא עורך ישירות
לא מוסיף
11. לוגיקת עריכה
Admin

עורך ישירות את data_short / data_long

Operations Reviewer

עורכת ישירות את data_short / data_long

Authorized User

לא עורך ישירות.
כל שינוי נשמר ל־edit_requests.

Instructor

לא עורך מקור אמת.

12. לוגיקת הוספה
Admin

יכול להוסיף ישירות

Operations Reviewer

יכולה להוסיף ישירות

כל השאר

לא יכולים להוסיף ישירות

13. הערות פרטיות של מבקרת התפעול

יש מידע פנימי שמבקרת התפעול כותבת על רשומות.

המידע הזה:

לא יופיע ב־data
לא יופיע לאחרים
יופיע רק לה

לכן הוא נשמר ב:

operations_private_notes

והוא מוצג רק לה, בתוך הרשומה במסך Activities.

14. מסך Dashboard
מטרת המסך

לתת תמונת מצב יומית מהירה.

מה מוצג במרכז, בתיבות קטנות:
סה״כ פעילויות קצרות
סה״כ פעילויות ארוכות
סה״כ מדריכים
סה״כ סיומי קורסים בחודש הנוכחי
בנוסף:

אותם סיכומים גם לפי activity_manager

עיצוב
תיבות קטנות, קומפקטיות
לא גרפים מיותרים
לא עומס
ברור מיד מה קורה
15. מסך Activities

זה המסך המרכזי במערכת.

מה הוא עושה
מציג את כל הפעילויות
מאחד data_short + data_long
מאפשר פתיחה של רשומה
מאפשר עריכה / בקשת שינוי / הוספה לפי הרשאה
לשוניות לפי סוג פעילות בלבד
all
course
after_school
workshop
tour
escape_room
תצוגות
Table view
Compact view
מסננים

רק מסננים רלוונטיים:

סוג פעילות
רשות
בית ספר
מדריך
מנהל פעילות
סטטוס
סטטוס כספי
פעולות
פתיחת drawer / panel של הרשומה
inline actions קומפקטיים
הוספת רשומה
עריכה
בקשת שינוי
הערות פרטיות רק למבקרת התפעול
16. מסך Week
מטרה

תצוגת שבוע לכל הפעילויות.

כללים
כל ימי השבוע באותו עמוד
ללא גלילה אופקית
רוחב מתאים
ברור גם במובייל
מסננים
מדריך
מנהל פעילות
סוג פעילות
רשות
בית ספר
17. מסך Month
מטרה

תצוגת חודש כמו לוח שנה.

כללים
לא רשימה
כן calendar layout
ברור וקריא
גם במובייל
מסננים
מדריך
מנהל פעילות
סוג פעילות
רשות
בית ספר
18. מסך Exceptions
מטרה

להציג רק מה דורש טיפול.

הכללים

המסך עובד רק על data_long

רשומה תופיע אם:

אין מדריך
אין start_date
end_date > 2026-06-15
כלל ספירה

אם יש יותר מחריגה אחת באותה רשומה, הספירה הכמותית תהיה:

missing_instructor
missing_start_date
late_end_date

כלומר missing_instructor קודם לכולם.

מסננים
סוג חריגה
מנהל פעילות
מדריך
רשות
בית ספר
19. מסך Finance
מטרה

תצוגה כספית פשוטה וברורה.

מה מוצג
כל הרשומות עם finance_status
פתוח / סגור
פילטרים
חיפוש
אפשרות טיפול מהיר
מסננים
finance_status
activity_type
authority
school
activity_manager
סטטוסים
open
closed
20. מסך Instructors
מטרה

להציג את כל המדריכים.

מה מוצג
מספר עובד
שם מלא
נייד
מייל
סוג העסקה
מנהל ישיר
סטטוס פעיל
מסננים
מנהל ישיר
פעיל / לא פעיל
סוג העסקה
21. מסך Contacts
מטרה

להציג אנשי קשר.

מקורות
contacts_instructors
contacts_schools
תתי סוגים
מדריכים
בתי ספר
מסננים
סוג
רשות
בית ספר
22. מסך My Data
מטרה

מסך אישי למדריך.

מה מוצג
רק הרשומות שמשויכות אליו
short + long אם שייך
תצוגה פשוטה
ללא עריכת מקור
23. מסך Permissions
מטרה

ניהול משתמשים והרשאות

גישה
Admin
Operations Reviewer
מה אפשר לשנות
role
default_view
flags של צפייה
can_request_edit
can_edit_direct
can_add_activity
can_review_requests
active
לא לבנות מסך כבד
טבלה פשוטה
שמירה קומפקטית
בלי enterprise admin UI
24. PWA

חובה לתמוך ב:

installable
manifest
service worker
app shell
פתיחה כמו אפליקציה
mobile-first
חובה
manifest.json
sw.js
register ב־frontend
נתיבי קבצים תקינים
25. עיצוב ו־UX
סגנון
רציני
נקי
ניהולי
קומפקטי
צבעים
רקע חיצוני כהה
רקע פנימי בהיר
אדום = חריגה / סיכון
צהוב = תשומת לב
ירוק = תקין
אפור = משני
עקרונות
מעט טקסט
מעט עומס
היררכיה ברורה
כפתורים קטנים וברורים
drawer / modal / inline edit כשצריך
לא טפסים ארוכים
אנטי־פטרנים
עומס של גרפים
חלונות מיותרים
יותר מדי שדות פתוחים
מסכים עם יותר מדי תפקידים
צבעוניות מיותרת
26. כותרות הגיליונות
data_short
English
RowID	activity_manager	authority	school	activity_type	activity_no	activity_name	sessions	price	funding	start_time	end_time	emp_id	instructor_name	emp_id_2	instructor_name_2	start_date	status	notes	finance_status	finance_notes
עברית
מזהה שורה	מנהל פעילות	רשות	בית ספר	סוג פעילות	מספר תוכנית	שם פעילות	מספר מפגשים	מחיר	מימון	שעת התחלה	שעת סיום	מספר עובד	מדריך	מספר עובד 2	מדריך 2	תאריך 1	סטטוס	הערות	סטטוס כספי	הערות כספים
data_long
English
RowID	activity_manager	authority	school	activity_type	activity_no	activity_name	sessions	price	funding	start_time	end_time	emp_id	instructor_name	start_date	end_date	status	notes	finance_status	finance_notes
עברית
מזהה שורה	מנהל פעילות	רשות	בית ספר	סוג פעילות	מספר תוכנית	שם פעילות	מספר מפגשים	מחיר	מימון	שעת התחלה	שעת סיום	מספר עובד	מדריך	תאריך התחלה	תאריך סיום	סטטוס	הערות	סטטוס כספי	הערות כספים
activity_meetings
English
source_row_id	meeting_no	meeting_date	notes	active
עברית
מזהה שורת מקור	מספר מפגש	תאריך מפגש	הערות	פעיל
permissions
English
user_id	entry_code	full_name	display_role	default_view	view_admin	view_dashboard	view_activities	view_week	view_month	view_instructors	view_exceptions	view_my_data	view_contacts	view_finance	view_permissions	can_request_edit	can_edit_direct	can_add_activity	can_review_requests	active
עברית
מזהה משתמש	קוד כניסה	שם מלא	תפקיד תצוגה	מסך ברירת מחדל	ניהול מערכת	דשבורד	פעילויות	תצוגה שבועית	תצוגה חודשית	מדריכים	חריגות	המסך האישי שלי	אנשי קשר	כספים	הרשאות	יכול להגיש בקשת שינוי	יכול לערוך ישירות	יכול להוסיף פעילות	יכול לבדוק בקשות	פעיל
lists
English
list_name	value	label	parent_value	activity_type	activity_no	activity_name	active
עברית
שם רשימה	ערך	תווית	ערך אב	סוג פעילות	מספר תוכנית	שם פעילות	פעיל
contacts_instructors
English
emp_id	full_name	mobile	email	address	employment_type	direct_manager	active
עברית
מספר עובד	שם מלא	נייד	מייל	כתובת	סוג העסקה	מנהל ישיר	פעיל
contacts_schools
English
authority	school	contact_name	contact_role	phone	mobile	email	address	notes	active
עברית
רשות	בית ספר	שם איש קשר	תפקיד איש קשר	טלפון	נייד	מייל	כתובת	הערות	פעיל
edit_requests
English
request_id	source_sheet	source_row_id	field_name	old_value	new_value	requested_by_user_id	requested_by_name	requested_at	status	reviewed_at	reviewed_by	reviewer_notes	active
עברית
מזהה בקשה	גיליון מקור	מזהה שורת מקור	שם שדה	ערך קודם	ערך חדש	מזהה משתמש מבקש	נפתח על ידי	נפתח בתאריך	סטטוס	נבדק בתאריך	נבדק על ידי	הערות בודקת	פעיל
operations_private_notes
English
source_sheet	source_row_id	note_text	updated_at	updated_by	active
עברית
גיליון מקור	מזהה שורת מקור	הערה פנימית	עודכן בתאריך	עודכן על ידי	פעיל
27. סטטוסים סופיים
finance_status
open
closed
active
yes
no
edit_requests.status
pending
approved
rejected
28. מזהים
data_short
SHORT-001
SHORT-002
data_long
LONG-001
LONG-002
activity_meetings.source_row_id
רק LONG-*
edit_requests.source_row_id
SHORT-* או LONG-*
29. מה המפתח AI צריך לבנות עכשיו
מבנה פרויקט חדש
frontend חדש
backend חדש ב־Apps Script
חיבור ל־Google Sheets
login + session restore + logout
Dashboard
Activities
Week
Month
Exceptions
Finance
Instructors
Contacts
My Data
Permissions
PWA מלאה
הרשאות
edit request flow
operations private notes

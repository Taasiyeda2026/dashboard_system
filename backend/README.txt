קבצי Apps Script מוכנים להעלאה.

מה לעשות (סדר בסיסי):
1. פתחו פרויקט Apps Script.
2. העתיקו את כל קבצי backend/*.gs לפרויקט (שמות קבצים זהים):
   - Code.gs
   - actions.gs
   - auth.gs
   - config.gs
   - helpers.gs
   - router.gs
   - script-cache.gs
   - sheets.gs
3. ב-config.gs עדכנו CONFIG.SPREADSHEET_ID לגיליון היעד.
4. שמרו, פריסה > ניהול פריסות > פריסה מחדש של ה-Web App (אם משתמשים ב-web app).
5. בדקו את כתובת /exec (או ה-URL המלא של הפריסה).

תלות בין קבצים (Apps Script טוען הכול לגלובל):
- Code.gs -> router.gs -> שאר המודולים.
- auth.gs קורא ל-buildClientSettingsPayload_ (מוגדר ב-actions.gs) — וודאו ששני הקבצים קיימים באותו פרויקט.
- sheets.gs משתמש ב-yesNo_ מ-helpers.gs וב-CONFIG מ-config.gs.

================================================================================
א. גיליונות חובה (שמות בדיוק כמו ב-config.gs / CONFIG.SHEETS)
================================================================================
חייבים להיות קיימים בגיליון המקושר; doGet מחזיר missing_sheets אם חסר:

- data_short
- data_long
- activity_meetings
- permissions
- settings
- lists
- contacts_instructors
- contacts_schools
- edit_requests
- operations_private_notes

שורת כותרות: שורה 1. נתונים: תמיד משורה 3.

================================================================================
ב. עמודות מינימליות לפי שימוש בקוד (יישור למקור — הרחבה מותרת)
================================================================================

permissions (כותרות לדוגמה; חייבות להתאים לגיליון בפועל):
- user_id, entry_code, full_name, display_role, display_role2, default_view, active
- כל שדות view_* ו-can_* שהמערכת משתמשת בהם (כולל view_contacts_instructors ואם קיים בעמודה נפרדת: "view_contacts_instructors 2")

settings (שורה 1):
- setting_key, setting_value, value_type, notes, active
מפתחות שנקראים בקוד (חלקם אופציונליים — אם חסרים יש ברירות מחדל):
- finance_display_rule (למשל ended_until_today)
- show_only_nonzero_kpis
- use_status_with_dates
- hide_emp_id_on_screens, hide_activity_no_on_screens
- week_start_day (0–6, 0=ראשון)
- show_shabbat (yes/no — הצגת שבת בלוחות)
- late_end_date_cutoff (אופציונלי; אחרת LATE_END_DATE_CUTOFF ב-config.gs)

lists:
- list_name, value, label, parent_value, activity_type, activity_no, activity_name (כפי שבמקור)
- לפחות שורות list_name=activity_type ו-list_name=finance_status לפילטרים

activity_meetings:
- source_row_id, meeting_no, meeting_date, notes, active (כפי ש-buildMeetingsMap_ / setMeetings_ מצפים)

data_short / data_long:
- RowID חובה; שאר השדות לפי מיפוי mapShortRow_/mapLongRow_ והוספות (emp_id_2, instructor_name_2 בקצר וכו').

contacts_instructors:
- emp_id, full_name, mobile, email, address, employment_type, direct_manager, active

contacts_schools:
- לפי actionContacts_ (authority, school, contact_name, phone, mobile, email וכו' — כפי בגיליון)

operations_private_notes:
- source_sheet, source_row_id, note_text, updated_at, updated_by, active

edit_requests:
- request_id, source_sheet, source_row_id, field_name, old_value, new_value, requested_by_user_id,
  requested_by_name, requested_at, status, reviewed_at, reviewed_by, reviewer_notes, active

================================================================================
ג. login / bootstrap אחרי פריסה
================================================================================
- login: מחזיר token, user, routes, default_route, client_settings (מ-settings).
- bootstrap: דורש token; מחזיר routes, default_route, profile, client_settings.
- כל ה-handlers ב-router.gs חייבים להתאים ל-action ב-frontend (api.js).

פעולות backend (router): login, bootstrap, dashboard, activities, week, month, exceptions,
finance, instructors, instructorContacts, contacts, endDates, myData, permissions,
addActivity, saveActivity, submitEditRequest, reviewEditRequest, savePermission, savePrivateNote.

================================================================================
ד. פרונט / Web / SW
================================================================================
- לאחר שינוי קבצי JS/CSS: פריסה מחדש של האתר (Git Pages / סטטי) + עדכון config.apiUrl אם ה-URL של ה-Web App השתנה.
- Service Worker: CACHE_VERSION ב-sw.js — העלאה חדשה מומלצת עם העלאת גרסה כדי שדפדפנים ימשכו shell מעודכן.
- מומלץ אחרי deploy: ריענון קשיח (Ctrl+F5) או סגירת טאב — המערכת גם קוראת ל-reg.update() ב-visible.

================================================================================
ה. בדיקות עשן (smoke) אחרי deploy
================================================================================
1. login (קוד כניסה תקין).
2. bootstrap (טעינה עם token קיים).
3. ניווט: רק routes שהרשאה מאשרת.
4. permissions: שמירה וריענון — ערכים נשמרים בגיליון.
5. activities: פתיחת מגירה ושמירת שדה (לא מדריך).
6. week — עמודות ימים תואמות settings (week_start_day, show_shabbat).
7. month — יום שבת מוסתר כש-show_shabbat לא yes.
8. finance — רשומות לפי finance_display_rule.
9. end-dates, instructor-contacts — נטען ללא שגיאה כשיש הרשאה.
10. מדריך: אין טופס עריכה בפעילויות/כספים.
11. exceptions — התנהגות לוגית כמו לפני (ספירות/סינון).
12. מובייל: תפריט drawer נפתח/נסגר.
13. RTL: כיוון מסכים ומגירות.

================================================================================
ארכיב בלבד — Google Apps Script (מערכת ישנה)
================================================================================

קבצים אלו שייכים לגרסה הקודמת של המערכת, שהתבססה על Google Sheets +
Google Apps Script. המערכת עברה הגרה מלאה ל-Supabase.

קבצים אלו אינם בשימוש פעיל. הם נשמרים לצורכי עיון היסטורי בלבד.

המערכת הנוכחית:
- כל הנתונים: Supabase (PostgreSQL)
- כל הקריאות: frontend/src/api.js → Supabase ישירות
- אין תלות ב-GAS או ב-Google Sheets

================================================================================
תוכן התיקיה (ארכיב)
================================================================================

Code.gs               - entrypoint של Apps Script (doGet, doPost, keepWarm)
router.gs             - ניתוב פעולות API
actions.gs            - לוגיקת נתונים מרכזית
config.gs             - הגדרות (SPREADSHEET_ID, TTL caches)
helpers.gs            - פונקציות עזר
auth.gs               - אימות וטוקנים
settings.gs           - קריאת הגדרות מגיליון
sheets.gs             - גישה לגיליונות
script-cache.gs       - שכבת cache ב-Apps Script
read-models.gs        - בניית read models מגיליונות
dashboard-sheet.gs    - dashboard מגיליון
dashboard-snapshot.gs - snapshot של dashboard
activities-snapshot.gs - snapshot של פעילויות
views.gs              - data views מגיליונות
data-maintenance.gs   - תחזוקת נתונים
sync-end-dates.gs     - סנכרון תאריכי סיום
ops_health.gs         - בדיקות בריאות תפעולית
workbook-structure.gs - מבנה גיליון
sheet-schema.gs       - schema של גיליונות
api_read_write.gs     - קריאה/כתיבה ל-Supabase (מה-GAS — לא בשימוש)
production-smoke-test.gs - בדיקות עשן

# Dashboard-Taasiyeda

## סקירה כללית
מערכת דשבורד פנימית לניהול נתוני תעשיידע.

## ארכיטקטורה
- **Frontend**: Vanilla JS + CSS סטטי (ללא build system)
- **Backend**: Google Apps Script (קבצי `.gs` בתיקיית `backend/`)
- **מסד נתונים**: Google Sheets
- **PWA**: כולל `sw.js` ו-`manifest.json`

## מבנה תיקיות
```
/
├── index.html              # נקודת כניסה לאפליקציה
├── sw.js                   # Service Worker לתמיכת PWA
├── frontend/
│   ├── src/
│   │   ├── main.js         # נקודת כניסה ל-JS
│   │   ├── api.js          # קריאות API ל-Google Apps Script
│   │   ├── state.js        # ניהול state גלובלי
│   │   ├── screens/        # מסכי האפליקציה
│   │   └── styles/         # קבצי CSS
│   ├── assets/             # תמונות ואייקונים
│   └── public/             # manifest.json
└── backend/
    ├── Code.gs             # נקודת כניסה ל-Google Apps Script
    ├── router.gs           # ניתוב בקשות API
    ├── actions.gs          # לוגיקת עסקים
    ├── sheets.gs           # קריאה/כתיבה ל-Google Sheets
    ├── auth.gs             # אימות משתמשים
    ├── config.gs           # הגדרות (Spreadsheet ID)
    └── helpers.gs          # פונקציות עזר

## הרצה מקומית
השרת מוגדר עם `npx serve . -l 5000` על פורט 5000.

## חוקי עבודה
- **עברית בלבד** בכל הממשק, הסברים ותוכן
- **לא להשתמש בפיצ'רים ייחודיים של Replit** (DB, Secrets, Deployments וכו')
- **הקוד חייב לעבוד מחוץ ל-Replit**: GitHub, שרת רגיל, מחשב מקומי
- **לא לשנות מבנה** ללא אישור מפורש

## הערות חשובות ל-Google Sheets
- שורה 1 = כותרות פנימיות
- שורה 2 = תצוגה/תרגום (לא דאטה!)
- **הנתונים מתחילים רק משורה 3**

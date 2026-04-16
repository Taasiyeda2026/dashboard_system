# תעשיידע — מערכת ניהול פעילויות חינוכיות

## מבנה הפרויקט

```
taasiyeda/
├── index.html                    ← נקודת כניסה + login screen
├── manifest.json                 ← PWA manifest
├── sw.js                         ← Service Worker (PWA caching)
├── frontend/
│   ├── app.js                    ← Router + shell + auth guard
│   ├── api/
│   │   └── api.js                ← כל הקריאות ל-Apps Script
│   ├── config/
│   │   └── config.js             ← קונפיגורציה מרכזית
│   ├── shared/
│   │   ├── utils.js              ← פונקציות עזר
│   │   ├── filters.js            ← filter bar גנרי
│   │   └── toast.js              ← הודעות toast
│   ├── components/
│   │   └── activity-drawer.js    ← Drawer פעילות + עריכה inline
│   ├── screens/
│   │   ├── dashboard.js
│   │   ├── activities.js
│   │   ├── week.js
│   │   ├── month.js
│   │   ├── instructors.js
│   │   ├── exceptions.js
│   │   ├── my-data.js
│   │   ├── contacts.js
│   │   ├── finance.js
│   │   └── permissions.js
│   └── styles/
│       └── main.css
└── backend/
    └── Code.gs                   ← Google Apps Script (backend)
```

---

## הגדרה ראשונית

### שלב 1 — Google Sheets

צור Spreadsheet חדש עם הגיליונות הבאים (בדיוק בשמות האלה):

- `data_short`
- `data_long`
- `activity_meetings`
- `permissions`
- `lists`
- `contacts_instructors`
- `contacts_schools`
- `edit_requests`
- `operations_private_notes`

העתק לכל גיליון את שורת הכותרות לפי האפיון.

### שלב 2 — Google Apps Script

1. פתח את הגיליון → Extensions → Apps Script
2. מחק את הקוד הקיים
3. הדבק את כל תוכן `backend/Code.gs`
4. בשורה הראשונה החלף: `YOUR_SPREADSHEET_ID` במזהה ה-Spreadsheet שלך
   (מוצא אותו ב-URL: `docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`)
5. פרוס כ-Web App:
   - **Deploy → New deployment**
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - לחץ Deploy → העתק את ה-URL

### שלב 3 — Frontend

1. פתח `frontend/config/config.js`
2. החלף `YOUR_DEPLOYMENT_ID` ב-URL שקיבלת מהפרסום

### שלב 4 — GitHub Pages

1. Push את כל הקבצים לריפו
2. Settings → Pages → Source: main branch / root
3. המערכת תהיה זמינה בכתובת `https://taasiyeda2026.github.io/dashboard_system`

### שלב 5 — PWA Icons

צור תיקייה `icons/` עם:
- `icon-192.png` (192×192px)
- `icon-512.png` (512×512px)

---

## הוספת משתמש ראשון (Admin)

הוסף שורה ידנית בגיליון `permissions`:

| user_id | entry_code | full_name | display_role | default_view | view_admin | ... כל השאר TRUE | active |
|---------|------------|-----------|--------------|--------------|------------|-----------------|--------|
| admin_1 | 1234       | מנהל מערכת | Admin        | dashboard    | TRUE       | TRUE            | TRUE   |

---

## הרשאות

| תפקיד               | יכולות                                      |
|---------------------|---------------------------------------------|
| Admin               | הכל — עריכה ישירה, הוספה, ניהול הרשאות    |
| מבקרת תפעול         | עריכה ישירה, אישור בקשות, הערות פנימיות   |
| מנהל פעילות         | צפייה + הגשת בקשות שינוי                  |
| מדריך               | מסך אישי בלבד                              |

---

## טכנולוגיות

- **Frontend:** Vanilla JS ES Modules — ללא build tools
- **Backend:** Google Apps Script
- **Data:** Google Sheets
- **Hosting:** GitHub Pages
- **PWA:** Service Worker + Web App Manifest

# פרומפט לאופטימיזציית ביצועים — Dashboard Taasiyeda

## הקשר
המערכת בנויה על GitHub Pages (HTML/JS ES modules) + Google Apps Script backend + Google Sheets.
הבעיה: טעינה ראשונית 10-20 שניות, מעבר בין עמודים איטי, פתיחת פרטי פעילות איטית.
כל המשתמשים מרגישים את זה בכל יום.

---

## חלק א׳ — Backend (Apps Script)

### 1. Warmup Trigger — מניעת Cold Start

**הבעיה**: Apps Script "נרדם" אחרי ~30 דקות ללא שימוש. הקריאה הראשונה מעירה אותו ולוקחת 5-8 שניות.

**הפתרון**: הוסף פונקציה ב-`backend/Code.gs` והגדר trigger ידני ב-Apps Script:

```js
// backend/Code.gs — הוסף בסוף הקובץ
/**
 * Warmup function — run via time-driven trigger every 10 minutes.
 * Prevents cold start by keeping the Apps Script instance warm.
 * To activate: Apps Script → Triggers → Add Trigger → keepWarm → Time-driven → Every 10 minutes
 */
function keepWarm() {
  try {
    getSpreadsheet_();
  } catch (e) {
    // silence — warmup only
  }
}
```

**הוראות הגדרה ל-README**: הוסף לקובץ `backend/README.txt`:
```
הגדרת Warmup Trigger:
1. פתח את פרויקט Apps Script
2. עבור ל-Triggers (שעון בצד שמאל)
3. הוסף Trigger: keepWarm → Time-driven → Minutes timer → Every 10 minutes
```

---

### 2. הגדלת TTL של Script Cache

**הבעיה**: `SCRIPT_CACHE_SECONDS: 300` (5 דקות) — הנתונים משתנים לאט, אין סיבה לרענן כל כך מהר.

**שינוי ב-`backend/config.gs`**:
```js
// לפני:
SCRIPT_CACHE_SECONDS: 300,

// אחרי:
SCRIPT_CACHE_SECONDS: 1800, // 30 דקות
```

---

### 3. Cache נפרד ל-Meetings Map

**הבעיה**: `buildMeetingsMap_()` קורא את כל 1200+ שורות של `activity_meetings` בכל request. ה-map נבנה מחדש כשה-Script Cache פג.

**שינוי ב-`backend/actions.gs`** — הגדל TTL של meetings map בנפרד:

```js
// בתוך buildMeetingsMap_():
// לפני:
scriptCachePutJson_(cacheKey, map, CONFIG.SCRIPT_CACHE_SECONDS || 120);

// אחרי:
scriptCachePutJson_(cacheKey, map, 3600); // שעה שלמה — meetings משתנים לאט
```

---

### 4. הפסקת קריאת Date1-Date35 מהגיליון הראשי

**הבעיה**: כל שורת פעילות נטענת עם 35 עמודות תאריכים ריקות ברובן. עם 100+ קורסים — זה כבד.

**הפתרון**: ב-`projectedActivityColumnsForSummary_()` ב-`backend/actions.gs` — הסר Date2-Date35 מה-projection של Summary (לא Detail). הנתונים קיימים ב-`activity_meetings`.

```js
function projectedActivityColumnsForSummary_() {
  return [
    'RowID', 'activity_manager', 'authority', 'school',
    'activity_type', 'activity_no', 'activity_name',
    'sessions', 'price', 'funding', 'start_time', 'end_time',
    'emp_id', 'instructor_name', 'emp_id_2', 'instructor_name_2',
    'start_date', 'end_date', 'status', 'notes',
    'finance_status', 'finance_notes',
    'is_archived', 'archive', 'Payer', 'Payment',
    'Date1'
    // Date2-Date35 הוסרו — נלקחים מ-activity_meetings
  ];
}
```

---

## חלק ב׳ — Frontend Cache

### 5. הגדלת TTL של localStorage Cache

**הבעיה**: `SCREEN_CACHE_TTL_MS` קצר מדי — משתמש שחוזר אחרי 6 דקות טוען הכל מחדש.

**שינוי ב-`frontend/src/main.js`**:
```js
// לפני:
const SCREEN_CACHE_TTL_MS = {
  dashboard: 5 * 60 * 1000,
  activities: 5 * 60 * 1000,
  week: 8 * 60 * 1000,
  month: 8 * 60 * 1000,
  exceptions: 8 * 60 * 1000,
};
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;

// אחרי:
const SCREEN_CACHE_TTL_MS = {
  dashboard:   30 * 60 * 1000,
  activities:  30 * 60 * 1000,
  week:        20 * 60 * 1000,
  month:       20 * 60 * 1000,
  exceptions:  20 * 60 * 1000,
  finance:     20 * 60 * 1000,
  instructors: 30 * 60 * 1000,
};
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
```

---

### 6. activityDetail מה-Cache — ביטול Request מיותר

**הבעיה**: כל פתיחת פרטי פעילות שולחת request חדש לשרת שקורא שוב את כל ה-sheet כדי למצוא שורה אחת.

**הפתרון ב-`frontend/src/screens/activities.js`**:

בפונקציה `loadDetailRow` — לפני שליחת request לשרת, בדוק אם הנתונים שכבר קיימים ב-summary מספיקים:

```js
async function loadDetailRow(summaryRow) {
  const cacheKey = `${summaryRow.source_sheet || ''}|${summaryRow.RowID || ''}`;
  if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);

  // בדוק אם יש נתוני summary מלאים מספיק (כולל meeting_schedule)
  // אם יש meeting_schedule — אין צורך בקריאה לשרת
  if (summaryRow.meeting_schedule && summaryRow.meeting_schedule.length >= 0) {
    detailCache.set(cacheKey, summaryRow);
    return summaryRow;
  }

  const rsp = await api.activityDetail(summaryRow.RowID, summaryRow.source_sheet);
  const row = rsp?.row || summaryRow;
  detailCache.set(cacheKey, row);
  return row;
}
```

**חשוב**: וודא שה-backend מחזיר `meeting_schedule` גם ב-`activities` (לא רק ב-`activityDetail`). בדוק ב-`mapActivitySummaryRowForList_` ב-`backend/actions.gs` — הוסף `meeting_schedule` לתוצאה:

```js
// ב-mapActivitySummaryRowForList_ — הוסף:
meeting_schedule: meetingDates.map(function(dateKey) {
  return { date: dateKey, performed: dateKey <= today ? 'yes' : 'no' };
}),
```

---

### 7. Prefetch חכם — טעינה ברקע

**הבעיה**: המשתמש נמצא בלוח הבקרה — ואז לוחץ על "פעילויות" וממתין מחדש.

**הפתרון ב-`frontend/src/screens/dashboard.js`**, בסוף `bind()`:

```js
// Prefetch activities ו-week ברקע לאחר רינדור dashboard
function prefetchCommonScreens() {
  const screensToPrefetch = ['activities', 'week'];
  screensToPrefetch.forEach((route) => {
    const cacheKey = route;
    const hit = state.screenDataCache[cacheKey];
    if (hit && Date.now() - hit.t < SCREEN_CACHE_TTL_MS[route]) return;

    // טעינה שקטה ברקע — לא מציגים loading
    import('../screens/' + route + '.js')
      .then(mod => mod[route + 'Screen']?.load?.({ api, state }))
      .then(data => {
        if (data) {
          state.screenDataCache[cacheKey] = { data, t: Date.now() };
        }
      })
      .catch(() => {}); // silence — prefetch בלבד
  });
}

// קרא אחרי 2 שניות מרינדור dashboard
setTimeout(prefetchCommonScreens, 2000);
```

---

### 8. ביטול Request כפול בניווט מהיר

**הבעיה**: לחיצה מהירה על "שבוע הבא" פעמיים שולחת שני requests.

**הפתרון ב-`frontend/src/main.js`** — ה-`inflightRequests` map כבר קיים. וודא שמשמש גם בניווט:

```js
// בתוך loadScreenDataWithCache — כבר קיים, וודא שלא נמחק בעת ניווט
// וודא שבתוך bindScreen — כשיוצאים מעמוד, לא מבטלים inflight requests של עמוד חדש
```

הוסף debounce על כפתורי ניווט שבוע/חודש:

```js
// ב-week.js bind():
let navDebounce = null;
root.querySelector('[data-week-prev]')?.addEventListener('click', () => {
  clearTimeout(navDebounce);
  navDebounce = setTimeout(() => {
    state.weekOffset = (state.weekOffset || 0) - 1;
    rerender?.();
  }, 150);
});
// אותו דבר ל-data-week-next
```

---

## חלק ג׳ — שיפורי Render

### 9. Pagination לרשימת הפעילויות

**הבעיה**: עם 300+ פעילויות — render כל הכרטיסיות/שורות בבת אחת כבד.

**שינוי ב-`frontend/src/screens/activities.js`**:

```js
// הוסף state
const PAGE_SIZE = 60;
// state.activityPage = 0 (ברירת מחדל)

// ב-render():
const pagedRows = safeRows.slice(0, (state.activityPage + 1) * PAGE_SIZE);
const hasMore = safeRows.length > pagedRows.length;

// בסוף הרשימה:
const loadMoreBtn = hasMore
  ? `<button type="button" class="ds-btn ds-btn--ghost" data-load-more>
       טען עוד (${safeRows.length - pagedRows.length} נוספים)
     </button>`
  : '';

// ב-bind():
root.querySelector('[data-load-more]')?.addEventListener('click', () => {
  state.activityPage = (state.activityPage || 0) + 1;
  rerender();
});
```

**איפוס pagination**: כשמשתנה פילטר/חיפוש — `state.activityPage = 0`.

---

### 10. Skeleton Loading במקום ספינר

**הבעיה**: ספינר ריק גורם לתחושה של "המערכת לא עושה כלום".

**שינוי ב-`frontend/src/main.js`** — `screenLoadingMarkup()`:

```js
function screenLoadingMarkup(route) {
  // skeleton מותאם לפי עמוד
  if (route === 'activities') {
    const skeletonCards = Array.from({ length: 10 }, () =>
      `<div class="ds-skeleton-card"></div>`
    ).join('');
    return `<div class="ds-skeleton-grid">${skeletonCards}</div>`;
  }
  if (route === 'week') {
    const skeletonCols = Array.from({ length: 6 }, () =>
      `<div class="ds-skeleton-col"></div>`
    ).join('');
    return `<div class="ds-skeleton-week">${skeletonCols}</div>`;
  }
  // ברירת מחדל
  return `<div class="ds-loading-card" dir="rtl" role="status" aria-live="polite">
    <div class="ds-spinner" aria-hidden="true"></div>
    <p>טוען נתונים...</p>
  </div>`;
}
```

הוסף CSS:
```css
.ds-skeleton-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  padding: 12px;
}
.ds-skeleton-card {
  height: 80px;
  border-radius: 12px;
  background: linear-gradient(90deg, #e8eef6 0%, #f4f7fb 50%, #e8eef6 100%);
  background-size: 200% 100%;
  animation: ds-shimmer 1.2s ease-in-out infinite;
}
.ds-skeleton-week {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
  padding: 12px;
}
.ds-skeleton-col {
  height: 300px;
  border-radius: 12px;
  background: linear-gradient(90deg, #e8eef6 0%, #f4f7fb 50%, #e8eef6 100%);
  background-size: 200% 100%;
  animation: ds-shimmer 1.2s ease-in-out infinite;
}
```

---

### 11. רינדור מהיר בפתיחת Drawer

**הבעיה**: פתיחת פרטי פעילות — Drawer נפתח ריק עם "טוען..." ורק אז מתמלא.

**שינוי**: הצג מיד את הנתונים הבסיסיים (שם, בית ספר, מדריך) מה-summary row **לפני** שהdetail חוזר מהשרת. אחרי שהdetail מגיע — עדכן את שאר השדות.

```js
async function openActivityDetail(summaryRow) {
  // רינדור מיידי מה-summary
  ui.openDrawer({
    title: summaryRow.activity_name || 'פירוט פעילות',
    content: activityDrawerContent(
      summaryRow, // נתונים חלקיים — מספיק להציג מיד
      canSeePrivateNotes, canEditActivity,
      hideEmpIds, hideRowId, hideActivityNo,
      state?.clientSettings || {}
    )
  });

  // אם חסרים נתוני detail (תאריכים, meeting_schedule) — טען ברקע ועדכן
  if (!summaryRow.meeting_schedule) {
    const row = await loadDetailRow(summaryRow);
    // עדכן את תוכן ה-drawer בלי לסגור אותו
    const drawerContent = document.querySelector('.ds-drawer__content');
    if (drawerContent) {
      drawerContent.innerHTML = activityDrawerContent(
        row, canSeePrivateNotes, canEditActivity,
        hideEmpIds, hideRowId, hideActivityNo,
        state?.clientSettings || {}
      );
      bindActivityEditForm(drawerContent);
    }
  }
}
```

---

## חלק ד׳ — שיפורים כלליים

### 12. Service Worker — וידוא שעובד נכון

**בדוק ב-`sw.js`** שה-`APP_SHELL` כולל את כל קבצי ה-JS הרלוונטיים. כרגע הרשימה חסרה את רוב קבצי `screens/`.

הוסף:
```js
const APP_SHELL = [
  './index.html',
  './frontend/src/main.js',
  './frontend/src/api.js',
  './frontend/src/state.js',
  './frontend/src/config.js',
  './frontend/src/cache-persist.js',
  './frontend/src/screens/dashboard.js',
  './frontend/src/screens/activities.js',
  './frontend/src/screens/week.js',
  './frontend/src/screens/month.js',
  './frontend/src/screens/shared/interactions.js',
  './frontend/src/screens/shared/activity-detail-html.js',
  './frontend/src/screens/shared/bind-activity-edit-form.js',
  './frontend/src/screens/shared/layout.js',
  './frontend/src/screens/shared/html.js',
  './frontend/src/screens/shared/ui-hebrew.js',
  './frontend/src/styles/main.css',
  './frontend/public/manifest.json',
  './frontend/assets/logo1.png',
  './frontend/assets/logo_system.png',
];
```

---

### 13. Bootstrap ברקע — לא לחסום את הUI

**שינוי ב-`frontend/src/main.js`** — `backgroundSyncBootstrap()` כבר קיים וטוב. וודא שנקרא **תמיד** אחרי instant-restore, לא רק כש-routes קיימים:

```js
// בתוך mountScreen() — אחרי tryRestoreRoutesInstant():
if (tryRestoreRoutesInstant()) {
  backgroundSyncBootstrap(); // תמיד — גם אם routes קיימים
} else {
  await restoreSession();
}
```

---

### 14. אל תנקה cache בכל mutation

**הבעיה הנוכחית**: `clearScreenDataCache()` ב-`api.js` מנקה **הכל** כשיש שמירה. כולל dashboard, week, month — שלא קשורים לשמירה.

**שינוי ב-`frontend/src/api.js`** — ניקוי ממוקד לפי סוג הפעולה:

```js
if (MUTATING_ACTIONS[action]) {
  // נקה רק את הcache הרלוונטי — לא הכל
  const keysToInvalidate = ['activities:', 'exceptions:', 'instructors:'];
  // dashboard ו-week ו-month — נקה רק אחרי saveActivity,
  // לא אחרי savePermission / savePrivateNote
  const heavyMutations = ['saveActivity', 'addActivity', 'submitEditRequest', 'reviewEditRequest'];
  if (heavyMutations.includes(action)) {
    keysToInvalidate.push('dashboard:', 'week:', 'month:');
  }
  Object.keys(state.screenDataCache).forEach((key) => {
    if (keysToInvalidate.some(prefix => key.startsWith(prefix))) {
      delete state.screenDataCache[key];
    }
  });
}
```

---

## סדר ביצוע מומלץ

| עדיפות | משימה | זמן משוער | השפעה |
|--------|--------|-----------|-------|
| 🔴 1 | Warmup Trigger (סעיף 1) | 30 דקות | מבטל cold start |
| 🔴 2 | הגדלת TTL Script Cache (סעיף 2) | 5 דקות | פחות קריאות לגיליון |
| 🔴 3 | הגדלת TTL localStorage (סעיף 5) | 10 דקות | מעבר בין עמודים מיידי |
| 🟠 4 | TTL נפרד ל-meetings map (סעיף 3) | 15 דקות | קריאות meetings מהירות |
| 🟠 5 | activityDetail מה-cache (סעיף 6+11) | 2-3 שעות | פתיחת פרטים מיידית |
| 🟠 6 | ניקוי cache ממוקד (סעיף 14) | 1 שעה | פחות reloads מיותרים |
| 🟡 7 | Prefetch ברקע (סעיף 7) | 2 שעות | מעבר מיידי לפעילויות |
| 🟡 8 | Skeleton loading (סעיף 10) | 2 שעות | תחושת מהירות |
| 🟡 9 | Debounce ניווט (סעיף 8) | 30 דקות | ביטול requests כפולים |
| 🟡 10 | Service Worker מלא (סעיף 12) | 1 שעה | shell מהיר בטעינה |
| 🟢 11 | Pagination (סעיף 9) | 3 שעות | render קל יותר |
| 🟢 12 | הסרת Date1-35 מsummary (סעיף 4) | 4 שעות | קריאת גיליון קצרה |
| 🟢 13 | Bootstrap תמיד ברקע (סעיף 13) | 30 דקות | login מהיר יותר |

---

## תוצאה צפויה לאחר כל השינויים

| פעולה | לפני | אחרי |
|-------|------|-------|
| טעינה ראשונית (cold) | 10-20 שניות | 2-3 שניות |
| טעינה ראשונית (warm) | 5-10 שניות | 1-2 שניות |
| מעבר בין עמודים (cache) | 3-8 שניות | מיידי |
| מעבר בין עמודים (ללא cache) | 3-8 שניות | 1-2 שניות |
| מעבר בין חודשים | 5-10 שניות | מיידי (אחרי ביקור ראשון) |
| פתיחת פרטי פעילות | 3-6 שניות | מיידי |
| שמירת פעילות | 3-5 שניות | 1-2 שניות |

---

## הערות חשובות לAgent

1. **אל תשנה** את מבנה ה-API (action names, response shape) — רק cache ו-TTL.
2. **אל תשנה** את מנגנון `clearScreenDataCache` ב-`state.js` — רק את הקריאות אליו ב-`api.js`.
3. לאחר שינוי `SCRIPT_CACHE_SECONDS` ב-`config.gs` — בצע **invalidate ידני** בעת deploy (הפעל `scriptCacheInvalidateDataViews_()` פעם אחת).
4. הגדלת TTL של localStorage אפשרית רק אחרי שה-Script Cache גדל — אחרת משתמשים יקבלו נתונים ישנים.
5. **בדוק** שה-warmup trigger לא מפעיל `doPost` אלא רק `getSpreadsheet_()`.
6. Pagination — `state.activityPage` צריך **איפוס** בכל שינוי פילטר, חיפוש, או טאב.

# פרומפט להטמעת עיצוב מחדש של חלון הצד (Drawer) — Dashboard Taasiyeda

## הקשר
המערכת בנויה על GitHub Pages (HTML/JS ES modules), Google Sheets כמקור נתונים, Google Apps Script כ-backend.
הקובץ הרלוונטי הראשי: `frontend/src/screens/shared/activity-detail-html.js`
קבצים נוספים שיש לעדכן: `frontend/src/screens/shared/bind-activity-edit-form.js`, `frontend/src/styles/main.css`

---

## מטרה
לשנות את חלון הצד (Drawer) של פירוט פעילות מרשימה שטוחה של `<p>` לפאנל מובנה עם בלוקים, היררכיה ויזואלית, ומצב עריכה inline.

---

## עקרונות עיצוב

### מבנה הפאנל — 4 בלוקים
כל בלוק עטוף ב-`<div class="ds-drawer-block">`:

**1. 👤 אנשים**
- מנהל פעילות (dropdown מרשימה)
- **תוכנית** (`source_sheet: data_long`): שדה אחד — "מדריך/ה" (dropdown מרשימת מדריכים)
- **חד-יומי** (`source_sheet: data_short`): שני שדות שווים — "מדריך/ה 1" + "מדריך/ה 2"

**2. 📚 פעילות**
- **תוכנית בלבד**: שם קורס (dropdown) → בחירה ממלאת `activity_no` אוטומטית ברקע
- **חד-יומי**: שם פעילות (dropdown לפי `activity_type`)
- מימון (dropdown — ראה רשימה למטה)
- בית ספר (טקסט חופשי)
- רשות (dropdown)
- שכבה / `grade` (dropdown: א׳–י״ב)
- קבוצה / כיתה / `class_group` (טקסט חופשי)

**3. 📅 תאריכים ומפגשים**
- כפתור "✏️ עריכה" נמצא בכותרת הבלוק הזה בלבד (לא בכותרת הפאנל)
- פס התקדמות: X מתוך Y מפגשים בוצעו
- תאריך סיום: מחושב אוטומטית (תאריך אחרון ב-`meeting_schedule`) — ניתן לדריסה ידנית
  - כשנדרס ידנית מציגים תווית "ידני" בכתום
  - כפתור "↺ אוטומטי" מנקה את הדריסה
- תצוגת תאריכים: chips עם נקודה ירוקה (בוצע) / אפורה (טרם)
- "X עוד ▾" להצגת תאריכים נוספים מעבר ל-6 הראשונים

**4. 📝 הערות**
- "הערות" — `notes` — גלוי ועריך לכולם
- "הערה תפעולית" — `private_note` / `note_text` — גלוי רק ל-`operations_reviewer`
  - מופיע תחת קו מקווקו עם תווית 🔒 "תפעול בלבד"

---

## כותרת הפאנל (Header)

```html
<div class="ds-drawer__header ds-drawer__header--activity">
  <span class="ds-activity-type-badge">{ACTIVITY_LABELS[activity_type]}</span>
  <button class="ds-icon-btn" data-ui-close-drawer>✕</button>
  <h2 class="ds-drawer__title">{activity_name}</h2>
  <div class="ds-drawer__header-meta">
    <span class="ds-status-pill ds-status-pill--subtle">{status}</span>
    <span class="ds-drawer__school">{school} · {authority}</span>
  </div>
</div>
```

**סטטוס פתוח/סגור**: מוצג כ-pill קטן ושקט בכותרת (לא בולט — כי סגור לא מוצג במערכת בכלל).
- במצב עריכה הופך ל-`<select>` עם אפשרויות: פתוח / הסתיים
- **אין** להציג סטטוס כספים בפאנל זה

---

## מצב עריכה (Inline Edit)

### כניסה לעריכה
- כפתור "✏️ עריכה" בכותרת בלוק התאריכים
- לחיצה עליו הופכת **את כל השדות בכל הבלוקים** ל-inputs/selects

### יציאה מעריכה
- כפתור "💾 שמור" — שולח `saveActivity`, אחרי הצלחה:
  - חוזר למצב צפייה
  - מציג toast "✅ נשמר בהצלחה" (2.5 שניות)
  - הפאנל **נשאר פתוח**
- כפתור "ביטול" — חוזר למצב צפייה בלי שמירה

### שדות עריכה לפי סוג
- **dropdown** (מרשימה): `<select class="ds-input">`
- **טקסט חופשי**: `<input type="text" class="ds-input">`
- **textarea**: `<textarea class="ds-input" rows="2">`
- **תאריך**: `<input type="date" class="ds-input">`
- **קריאה בלבד** (לדוגמה: `activity_no` שמתמלא אוטומטי): `<span class="ds-field-readonly">`

---

## רשימות (Dropdowns)

### מימון
```
רמי שני, גפן, אדמה, היי-דרוז, מתנ"ס, ויצו, מ.ר.ק, רשות, מארוול, תעשיינים צפון, בנק הפועלים, אסם, על-בד
```

### שכבה (grade)
```
א׳, ב׳, ג׳, ד׳, ה׳, ו׳, ז׳, ח׳, ט׳, י׳, י״א, י״ב
```

### קורסים (activity) — לפי סוג פעילות
מקור: גיליון `lists`, `list_name = activity`. הנתונים:
| value | label | parent_value (activity_type) | activity_no |
|-------|-------|------------------------------|-------------|
| activity_6089 | ביומימיקרי | course | 6089 |
| activity_53828 | ביומימיקרי לחטיבה | course | 53828 |
| activity_9545 | בינה מלאכותית | course | 9545 |
| activity_57646 | השמיים אינם הגבול | course | 57646 |
| activity_57651 | טכנולוגיות החלל | course | 57651 |
| activity_53819 | יישומי AI | course | 53819 |
| activity_90001 | מנהיגות ירוקה | course | 90001 |
| activity_3604 | פורצות דרך | course | 3604 |
| activity_90004 | פרימיום | course | 90004 |
| activity_46091 | רוקחים עולם | course | 46091 |
| activity_90002 | תלמידים להייטק | after_school | 90002 |
| activity_90003 | מייקרים | after_school | 90003 |
| activity_60025 | תמיר - המחזור מתחיל בבית | workshop | 60025 |
| activity_60026 | תמיר - חדר בריחה קווסט | workshop | 60026 |
| activity_60027 | תמיר - איפה דדי | workshop | 60027 |
| activity_13990 | התנסות בתעשייה | tour | 13990 |
| activity_1001 | חדר בריחה ביומימיקרי | escape_room | 1001 |

**לוגיקה**: בחירת שם קורס → `activity_no` מתמלא אוטומטית ברקע ונשלח בשמירה, אך **לא מוצג** למשתמש (hide_activity_no_on_screens = yes).

### מדריכים
מקור: `dropdown_options` שמגיע ב-`client_settings` מה-backend, או מגיליון `contacts_instructors`.
מציגים **שם בלבד** (`full_name`). `emp_id` נשמר ברקע ונשלח בשמירה (hide_emp_id_on_screens = yes).

---

## שדות חדשים לגיליונות

יש להוסיף לגיליונות `data_long` ו-`data_short` שתי עמודות חדשות:
- `grade` — שכבה (dropdown: א׳–י״ב)
- `class_group` — קבוצה / כיתה (טקסט חופשי)

יש לוודא שהפונקציות `mapShortRow_` ו-`mapLongRow_` ב-`backend/actions.gs` כוללות את השדות האלה במיפוי, ושהפונקציה `mapActivityDetailRowForDrawer_` מחזירה אותם.

---

## CSS — כיתות חדשות להוסיף ל-main.css

```css
/* Drawer blocks */
.ds-drawer-block {
  background: #f8fafc;
  border: 1px solid #e8eef6;
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 14px;
}

.ds-drawer-block__title {
  font-size: 0.72rem;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  margin: 0 0 10px;
}

/* Status pill — subtle */
.ds-status-pill--subtle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255,255,255,0.07);
  color: #94a3b8;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 0.65rem;
  font-weight: 500;
}

/* End date row */
.ds-end-date-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 10px;
  margin-bottom: 12px;
}

.ds-end-date-row--override {
  background: #fff7ed;
  border-color: #fed7aa;
}

.ds-end-date-row__label {
  font-size: 0.72rem;
  font-weight: 700;
  color: #64748b;
  white-space: nowrap;
}

.ds-end-date-row__badge--manual {
  font-size: 0.65rem;
  color: #c2410c;
  font-weight: 600;
}

/* Private note section */
.ds-private-note-section {
  border-top: 1px dashed #e2e8f0;
  padding-top: 10px;
  margin-top: 4px;
}

.ds-private-note-badge {
  font-size: 0.65rem;
  font-weight: 700;
  color: #7c3aed;
  background: #f5f3ff;
  border: 1px solid #ddd6fe;
  border-radius: 999px;
  padding: 1px 7px;
  display: inline-block;
  margin-bottom: 6px;
}

/* Field readonly (e.g. auto-filled activity_no) */
.ds-field-readonly {
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 0.75rem;
  color: #64748b;
  font-weight: 600;
}
```

---

## תצוגת ריכוז — כמה פעילויות לאותו מדריך באותו יום

### מתי מופעלת
כשפותחים פאנל מהתצוגה השבועית (`week.js`) על שורת מדריך שיש לו **יותר מפעילות אחת** באותו יום.
עד 4 פעילויות (תוכניות) או עד 6 פעילויות (חד-יומיות) ביום אחד.

### כותרת הפאנל בתצוגת ריכוז
הכותרת מציגה רק את הנתונים **המשותפים** לכל הפעילויות של המדריך באותו יום:
- שם המדריך
- תאריך היום

```html
<h2 class="ds-drawer__title">{instructor_name}</h2>
<span class="ds-drawer__header-meta">{date_label} · {count} פעילויות</span>
```

**אין** לכתוב שם פעילות בכותרת — כי יש כמה פעילויות.

### מבנה הגוף — Accordion
כל פעילות מוצגת כ-`<details>` מקופל:

```html
<details class="ds-activity-accordion">
  <summary class="ds-activity-accordion__summary">
    <span class="ds-activity-accordion__name">{activity_name}</span>
    <span class="ds-activity-accordion__meta">{activity_type_label} · {school}</span>
    <span class="ds-activity-accordion__chevron">›</span>
  </summary>
  <div class="ds-activity-accordion__body">
    <!-- 4 הבלוקים הרגילים: אנשים, פעילות, תאריכים, הערות -->
    <!-- כפתור עריכה בתוך בלוק התאריכים של כל פעילות בנפרד -->
  </div>
</details>
```

**פעילות ראשונה**: `open` — פתוחה כברירת מחדל.
**שאר הפעילויות**: מקופלות.

### עריכה בתצוגת ריכוז
- כפתור "✏️ עריכה" קיים **בתוך כל פעילות בנפרד** (בבלוק התאריכים שלה)
- עריכה של פעילות אחת לא משפיעה על האחרות
- שמירה שולחת `saveActivity` עם ה-`RowID` של אותה פעילות בלבד
- לאחר שמירה: הפעילות חוזרת למצב צפייה, הפאנל נשאר פתוח

### CSS נוסף לתצוגת ריכוז

```css
/* Accordion container */
.ds-activity-accordion {
  border: 1px solid #e8eef6;
  border-radius: 12px;
  background: #f8fafc;
  margin-bottom: 10px;
  overflow: hidden;
}

.ds-activity-accordion[open] {
  border-color: #c7d7f0;
  box-shadow: 0 2px 8px rgba(26,51,88,0.07);
}

.ds-activity-accordion__summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  cursor: pointer;
  list-style: none;
  user-select: none;
  background: #fff;
}

.ds-activity-accordion__summary::-webkit-details-marker { display: none; }

.ds-activity-accordion[open] .ds-activity-accordion__summary {
  border-bottom: 1px solid #e8eef6;
  background: linear-gradient(135deg, #f0f6ff 0%, #f8f5ff 100%);
}

.ds-activity-accordion__name {
  font-size: 0.88rem;
  font-weight: 700;
  color: #1e293b;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-activity-accordion__meta {
  font-size: 0.72rem;
  color: #64748b;
  white-space: nowrap;
  flex-shrink: 0;
}

.ds-activity-accordion__chevron {
  color: #94a3b8;
  font-size: 1.1rem;
  transition: transform 0.18s ease;
  flex-shrink: 0;
}

.ds-activity-accordion[open] .ds-activity-accordion__chevron {
  transform: rotate(90deg);
}

.ds-activity-accordion__body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
```

---

## הערות חשובות לAgent

1. **אין** להציג `finance_status` או `finance_notes` בפאנל זה — אלה שייכים למסך כספים בלבד.
2. **אין** להציג `emp_id` / `emp_id_2` — מוסתרים (`hide_emp_id_on_screens = yes`).
3. **אין** להציג `activity_no` — מוסתר (`hide_activity_no_on_screens = yes`), אבל **כן** לשלוח בשמירה.
4. **אין** להציג `RowID` — מוסתר (`hide_row_id_in_ui = yes`).
5. שדות ריקים מציגים "—" בלי שגיאה.
6. הפאנל נפתח משלושה מקורות:
   - **תצוגת גריד** (`activities.js`) → תמיד פעילות אחת → מצב רגיל
   - **תצוגה שבועית** (`week.js`) → פעילות אחת → מצב רגיל
   - **תצוגה שבועית** (`week.js`) → כמה פעילויות לאותו מדריך → מצב ריכוז (Accordion)
   הפונקציה `activityWorkDrawerHtml` מקבלת פרמטר חדש `mode: 'single' | 'summary'` שקובע איזה תצוגה לרנדר.
7. לאחר שמירה מוצלחת: הפאנל **נשאר פתוח** במצב צפייה (לא נסגר).
8. בתצוגת ריכוז — שמירה של פעילות אחת לא סוגרת את ה-accordion של האחרות.

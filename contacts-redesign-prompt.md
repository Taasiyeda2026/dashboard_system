# הוראות עיצוב מחדש — מסך אנשי קשר (contacts.js)

## הקשר
קובץ: `frontend/src/screens/contacts.js`
CSS: `frontend/src/styles/main.css`

---

## מבנה המסך — שני טאבים (כמו היום)

```
[ אנשי קשר מדריכים (18) ]  [ אנשי קשר בתי ספר (262) ]
```

---

## טאב 1 — אנשי קשר מדריכים

### עיצוב: כרטיסיות אנשים
החלף את ה-`<details>` accordion הנוכחי בגריד של כרטיסיות.

### מבנה כרטיסייה

```html
<button type="button" class="ci-person-card" data-card-action="icontact:{emp_id}">
  <span class="ci-person-card__avatar" style="background:{color}" aria-hidden="true">
    {initials}
  </span>
  <span class="ci-person-card__info">
    <span class="ci-person-card__name">{full_name}</span>
    <span class="ci-person-card__phone">{mobile}</span>
  </span>
</button>
```

### לוגיקת Avatar
- רקע: צבע אקראי עקבי לפי `emp_id` (hash) — פלטה של 10 צבעים חיים
- ראשי תיבות: שתי אותיות ראשונות של השם (אות ראשונה של כל חלק)
- גודל: 40×40px, border-radius: 10px (לא עיגול מלא — יותר מודרני)

### גריד
```css
.ci-person-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  padding: 12px;
}
```

### כרטיסייה לא פעילה
אם `active === 'no'` — opacity: 0.45, ללא שינוי בגודל

### לחיצה על כרטיסייה
פותחת Drawer (חלון צד) עם כל פרטי המדריך:
- שם מלא
- טלפון (עם כפתור העתקה)
- מייל (עם כפתור העתקה)
- כתובת
- סוג העסקה
- מנהל ישיר
- סטטוס (פעיל / לא פעיל)

### CSS לכרטיסיות מדריכים

```css
.ci-person-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  padding: 12px;
}

.ci-person-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--ds-surface);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  box-shadow: var(--ds-shadow-xs);
  cursor: pointer;
  text-align: right;
  transition: border-color 0.14s ease, box-shadow 0.14s ease, transform 0.1s ease;
  font-family: inherit;
  width: 100%;
}

.ci-person-card:hover {
  border-color: color-mix(in srgb, var(--ds-accent) 30%, var(--ds-border));
  box-shadow: var(--ds-shadow-md);
  transform: translateY(-2px);
}

.ci-person-card--inactive {
  opacity: 0.45;
}

.ci-person-card__avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.78rem;
  font-weight: 800;
  color: #fff;
  flex-shrink: 0;
  letter-spacing: 0.02em;
}

.ci-person-card__info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}

.ci-person-card__name {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--ds-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ci-person-card__phone {
  font-size: 0.72rem;
  color: var(--ds-text-muted);
  direction: ltr;
  text-align: right;
}
```

### פלטת צבעים ל-Avatar (10 צבעים)
```js
const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
  '#f43f5e', '#a855f7'
];
function avatarColor(empId) {
  let hash = 0;
  const s = String(empId || '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
function avatarInitials(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[0][0] + parts[1][0];
  if (parts.length === 1) return parts[0].slice(0, 2);
  return '??';
}
```

---

## טאב 2 — אנשי קשר בתי ספר

### עיצוב: Accordion לפי בית ספר (כמו היום, אבל משופר)

**מה לשמר**: המבנה הכללי של accordion לפי בית ספר.

**מה לשפר**:

#### כותרת ה-accordion (summary)
```html
<summary class="sc-card__head">
  <span class="sc-card__chevron">›</span>
  <span class="sc-card__school-icon">🏫</span>
  <span class="sc-card__name">{school_name}</span>
  <span class="sc-card__auth">{authority}</span>
  <span class="sc-card__count">{N} אנשי קשר</span>
</summary>
```

**שינויים מהגרסה הנוכחית**:
- הוסף `{authority}` ליד שם בית הספר — עוזר לסרוק
- הספירה (`2 אנשי קשר`) תישאר — אך בצבע עמום יותר
- החץ (`›`) מסתובב 90° כשפתוח (כבר קיים — לוודא שעובד)

#### גוף ה-accordion
כל איש קשר — שורה עם:
- שם + תפקיד
- טלפון + נייד (אם שונים)
- מייל עם כפתור העתקה

```css
.sc-person {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 0;
  border-bottom: 1px dashed var(--ds-border);
}
.sc-person:last-child {
  border-bottom: none;
  padding-bottom: 0;
}
```

---

## חיפוש

### מדריכים
חיפוש לפי: שם, טלפון, מייל — client-side בלבד

### בתי ספר  
חיפוש לפי: שם בית ספר, רשות, שם איש קשר — client-side בלבד

**כשיש תוצאות חיפוש בטאב בתי ספר**: accordion נשאר מקופל — המשתמש בוחר לפתוח. לא לפתוח הכל אוטומטית.

---

## הערות לAgent

1. שמור על מבנה הטאבים הקיים ועל לוגיקת החיפוש הקיימת — רק מחליפים את ה-render.
2. כרטיסיות המדריכים מחליפות את ה-`<details>` הנוכחי לחלוטין.
3. Drawer (חלון צד) של מדריך — להשתמש ב-`ui.openDrawer` הקיים עם תוכן `drawerHtml()` המעודכן.
4. `emp_id` לא מוצג בכרטיסייה — רק בתוך ה-Drawer אם `hide_emp_id_on_screens = false`.
5. מובייל: גריד כרטיסיות המדריכים → `grid-template-columns: repeat(2, 1fr)` מתחת ל-560px.

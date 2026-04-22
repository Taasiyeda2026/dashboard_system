# פרומפט להוספת כפתור "סיכום" AI בלוח הבקרה — Dashboard Taasiyeda

## הקשר
קובץ ראשי: `frontend/src/screens/dashboard.js`
API: Anthropic Claude (כבר מוגדר בסביבה)
תאריך נוכחי: זמין דרך `new Date()` בצד הלקוח

---

## מה לבנות

כפתור קומפקטי **"✨ סיכום"** שמופיע:
1. בכרטיס הארצי (מעל כרטיסי ה-KPI)
2. בכל כרטיס מחוז בנפרד (פינה עליונה של הכרטיס)

לחיצה → קורא ל-Claude API → מציג טקסט inline מתחת לכרטיס.
הסיכום **נשמר בזיכרון** (לא נקרא שוב עד רענון עמוד).

---

## מבנה ה-UI

### כפתור
```html
<button
  type="button"
  class="ds-summary-btn"
  data-summary-target="{national|manager-name}"
  aria-label="סיכום AI"
>
  ✨ סיכום
</button>
```

### אזור הטקסט (inline, מתחת לכרטיס)
```html
<div class="ds-summary-panel" data-summary-panel="{national|manager-name}" hidden>
  <div class="ds-summary-panel__content">
    <!-- טקסט מגיע כאן -->
  </div>
</div>
```

**מצבים**:
- `hidden` — לפני לחיצה ראשונה
- טוען: מציג `<span class="ds-summary-loading">מנתח נתונים…</span>`
- לאחר קריאה: מציג את הטקסט, מסתיר את הכפתור ומציג "↺ רענן"

---

## הנתונים שנשלחים ל-API

### ארצי
```js
const nationalPayload = {
  type: 'national',
  currentMonth: ym,           // e.g. "2026-04"
  nextMonth: nextYm,          // e.g. "2026-05"
  today: todayIso,            // e.g. "2026-04-22"
  totals: data.totals,        // { total_long, total_short, total_instructors, total_course_endings_current_month }
  kpiCards: data.kpi_cards,   // מערך KPI
  managers: data.by_activity_manager, // פירוט מחוזות
  holidays: HOLIDAYS_IN_RANGE, // ראה למטה
};
```

### מחוזי
```js
const managerPayload = {
  type: 'manager',
  managerName: row.activity_manager,
  currentMonth: ym,
  nextMonth: nextYm,
  today: todayIso,
  stats: {
    total_long: row.total_long,
    num_instructors: row.num_instructors,
    exceptions: row.exceptions,
    course_endings: row.course_endings,
  },
  holidays: HOLIDAYS_IN_RANGE,
};
```

---

## חגים ואירועים — HOLIDAYS_IN_RANGE

בנה פונקציה שמחזירה את החגים הרלוונטיים לחודש הנוכחי + הבא.
השתמש בנתונים מ-`frontend/src/screens/shared/holidays.js` שכבר קיים במערכת.

```js
function getHolidaysInRange(fromYm, toYm) {
  // מסנן את HOLIDAYS לפי תאריכים בטווח fromYm עד toYm
  // מחזיר מערך: [{ date: '2026-05-08', label: 'ל"ג בעומר' }, ...]
}
```

דוגמאות לחגים הקיימים בקובץ:
- פורים, פסח, יום הזיכרון, יום העצמאות, ל"ג בעומר, שבועות
- סיום תיכונים (19/06), סיום יסודי (30/06)

---

## System Prompt ל-Claude

```
אתה עוזר ניהולי של מערכת ניהול פעילויות חינוכיות ארצית בישראל.
תפקידך: לנתח נתונים ולהפיק סיכום תמציתי למנהל.

חוקים:
- כתוב עברית בלבד
- 3–5 משפטים קצרים בלבד. אין כותרות, אין bullets, אין bold
- ניסוח ישיר, עובדתי, ממוקד — לא שיווקי ולא מחמיא
- הדגש: מה בולט החודש הנוכחי, מה צפוי החודש הבא, אירועים שדורשים תשומת לב
- אם יש חגים בטווח — ציין אותם רק אם רלוונטיים לפעילות (סיומים, הפסקות)
- אם יש חריגות גבוהות — ציין בפשטות את המספר
- אל תמציא נתונים שלא נמסרו לך
```

---

## User Prompt — ארצי

```js
`סיכום מצב ארצי לחודש ${hebrewMonthTitle(currentMonth)}.
היום: ${formatDateHe(today)}.

נתונים:
- תוכניות פעילות: ${totals.total_long}
- מדריכים פעילים: ${totals.total_instructors}
- חריגות: ${kpiCards.find(k => k.id === 'exceptions')?.value ?? 0}
- סיומי קורסים החודש: ${totals.total_course_endings_current_month}

פירוט מחוזות:
${managers.map(m => `${m.activity_manager}: ${m.total_long} תוכניות, ${m.num_instructors} מדריכים, ${m.exceptions} חריגות`).join('\n')}

${holidays.length ? `אירועים בטווח החודשיים הקרובים:\n${holidays.map(h => `${formatDateHe(h.date)}: ${h.label}`).join('\n')}` : ''}

כתוב סיכום קצר ומדויק למנהל הארצי.`
```

---

## User Prompt — מחוזי

```js
`סיכום מצב ${managerName} לחודש ${hebrewMonthTitle(currentMonth)}.
היום: ${formatDateHe(today)}.

נתונים:
- תוכניות פעילות: ${stats.total_long}
- מדריכים פעילים: ${stats.num_instructors}
- חריגות: ${stats.exceptions}
- סיומי קורסים החודש: ${stats.course_endings}

${holidays.length ? `אירועים בטווח החודשיים הקרובים:\n${holidays.map(h => `${formatDateHe(h.date)}: ${h.label}`).join('\n')}` : ''}

כתוב סיכום קצר ומדויק למנהל.`
```

---

## קריאת API

```js
async function fetchSummary(payload) {
  const systemPrompt = `...`; // כמו למעלה

  const userPrompt = payload.type === 'national'
    ? buildNationalPrompt(payload)
    : buildManagerPrompt(payload);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  const data = await response.json();
  return data.content?.[0]?.text || 'לא ניתן לייצר סיכום כרגע.';
}
```

---

## Cache בזיכרון

```js
// בתוך bind() של dashboardScreen
const summaryCache = new Map(); // key: 'national' | manager_name

async function handleSummaryClick(target, payload) {
  if (summaryCache.has(target)) {
    showSummary(target, summaryCache.get(target));
    return;
  }
  showLoading(target);
  const text = await fetchSummary(payload);
  summaryCache.set(target, text);
  showSummary(target, text);
}
```

---

## CSS

```css
/* כפתור סיכום */
.ds-summary-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: var(--ds-radius-full);
  border: 1px solid rgba(99, 102, 241, 0.3);
  background: rgba(99, 102, 241, 0.07);
  color: #6366f1;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.15s ease, border-color 0.15s ease;
  white-space: nowrap;
}

.ds-summary-btn:hover {
  background: rgba(99, 102, 241, 0.14);
  border-color: rgba(99, 102, 241, 0.5);
}

.ds-summary-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

/* אזור הסיכום */
.ds-summary-panel {
  margin-top: 10px;
  padding: 12px 14px;
  background: linear-gradient(135deg, rgba(237,233,254,0.6) 0%, rgba(224,231,255,0.5) 100%);
  border: 1px solid rgba(99,102,241,0.2);
  border-radius: var(--ds-radius-md);
  animation: ds-summary-fadein 0.25s ease;
}

.ds-summary-panel__content {
  font-size: 0.84rem;
  line-height: 1.65;
  color: var(--ds-text-secondary);
  direction: rtl;
}

.ds-summary-panel__footer {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
}

.ds-summary-refresh {
  font-size: 0.68rem;
  color: #94a3b8;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.ds-summary-refresh:hover {
  color: #6366f1;
}

.ds-summary-loading {
  font-size: 0.8rem;
  color: #6366f1;
  font-style: italic;
}

@keyframes ds-summary-fadein {
  from { opacity: 0; transform: translateY(-4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

---

## הערות חשובות לAgent

1. **מיקום הכפתור הארצי**: ליד כותרת "לוח בקרה" או מעל גריד ה-KPI — לא בתוך כרטיס KPI.
2. **מיקום הכפתור המחוזי**: פינה שמאלית עליונה של כל `ds-manager-card` (לצד שם המחוז).
3. **Cache לפי session בלבד** — `summaryCache` הוא `Map` מקומי בתוך `bind()`, נמחק ברענון עמוד.
4. **כפתור "↺ רענן"** מחק מה-cache ומריץ שוב — מופיע בפינה התחתונה של ה-panel.
5. אם ה-API מחזיר שגיאה — הצג `"לא ניתן לייצר סיכום כרגע."` בלי crash.
6. `max_tokens: 300` — מספיק ל-4-5 משפטים בעברית.
7. אל תשנה שום דבר אחר ב-`dashboard.js` מלבד הוספת הפיצ'ר הזה.

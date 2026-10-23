# הוראות מימוש לקודקס — מנגנון ביטול זמן אחיד

> **סטטוס:** מפרט מאושר למימוש (2026-10-12). ההחלטות בסעיף 1 מחייבות.
> **עקרון מנחה:** המדריך מדווח את זמן הנסיעה בפועל; המערכת מחשבת את הזמן הצפוי באופן עצמאי (לבקרה בלבד); המנהל בודק ומאשר את ביטול הזמן לתשלום.
> **גישה:** מנגנון אחיד אחד — לא תיקונים נקודתיים למסכים.
> **פריסה:** אין לפרוס לייצור / למזג ל־`main` / להריץ backfill על נתוני ייצור בלי אישור מפורש אחרי דוח בדיקות.

קרא קודם את `AGENTS.md` ואת `docs/PROJECT_MAP.md`. אם מסמך זה והקוד חולקים — **הקוד מנצח**; עדכן את המסמך באותו שינוי.

---

## 1. כללים עסקיים מחייבים (מאושרים)

עדכון מדיניות תצוגה ודיווח מדריך (24.10.2026): כל משך ביטול זמן מעוגל כלפי מעלה לכפולה של 5 דקות. לדוגמה 1:27 מוצג ונקלט כ־1:30 ו־1:42 כ־1:45. העיגול חל על כל מקטע לפני/אחרי ועל רשומות ביטול זמן עצמאיות ומופיע גם בסיכומי המדריך וב־Excel. בקשות היסטוריות שכבר נבדקו וסכומי שכר מאושרים אינם נכתבים מחדש כתוצאה מהתצוגה.

| # | כלל | פירוט מימושי |
|---|-----|---------------|
| 1 | דיווח בכל נסיעה פיזית | המדריך מדווח **הלוך וחזור בנפרד** (`reported_outbound_minutes`, `reported_return_minutes`), ללא תלות במרחק. ביטול הזמן המבוקש = `max(0, out−45)+max(0, ret−45)`. |
| 2 | חישוב מערכת מוסתר מהמדריך ברמת נתונים | לא רק UI: RLS / עמודות / RPC / `select` מחזירים למדריך רק שדות מותרים. אין חשיפת `system_*` / `calculated_*` / מרחק מערכת למדריך. |
| 3 | תזכורת מעל 40 ק״מ **בכיוון אחד** | אם `system_one_way_distance_km > 40` (max של הלוך/חזור) — תזכורת לדיווח. השדה תמיד פתוח. המרחק **אינו** תנאי זכאות. |
| 4 | נוסחת 45 דק׳ | ללא שינוי: `max(0, outbound−45)+max(0, return−45)`. |
| 5 | כל פער → בקרת מנהל | גם פער של דקה אחת בין ביטול־זמן מבוקש לחישוב מערכת → `pending_review`. |
| 6 | רק מאושר נכנס לשכר | רק `approved_cancellation_minutes` אחרי החלטת מנהל (`approved` / `corrected`). אין יצירת שעות מתשלום מחישוב מערכת בלבד. |
| 7 | שליחת חודש ≠ אישור לשכר | מדריך יכול לשלוח חודש בלי זמני נסיעה. `manager_finalize_attendance_month_review` **נחסם** אם יש נסיעות שממתינות לדיווח/ביקורת/בלי אישור נדרש. חודשי payroll שאושרו — freeze. |

### החלטות מוצר מאושרות

1. **דיווח מדריך:** outbound + return בדקות שלמות.
2. **אין אישור אוטומטי לתשלום:** `auto_matched` = התאמה בלבד. עדיין נדרש אישור מנהל לפני `approved_cancellation_minutes` ולפני שורת generated לתשלום.
3. **שליחת חודש לא נחסמת** על חוסר דיווח נסיעה; חוסר רלוונטי מופיע בבקרת מנהל.
4. **חישוב אוטומטי = בקרה בלבד** — לא יוצר שעות לתשלום בעצמו.
5. **אין כפל שעות** בין דיווח מדריך לרשומה אוטומטית; שורת תשלום יחידה per source דרך `travel_time_cancellation`.
6. **שינוי מסלול / חישוב חוזר לא דורס** דיווח מדריך ולא החלטת מנהל קיימת; כן מעדכן `system_*` ועלול להחזיר ל־`pending_review` / `auto_matched` אם ההחלטה עדיין לא ננעלה לשכר.
7. **היסטוריית אירועים מלאה** ב־`attendance_travel_compensation_events`.
8. **לא משנים** נוסחת 45, מנגנון ק״מ, או החזרי תחבורה ציבורית.

### מצבי `review_status`

| סטטוס | משמעות | לתשלום? |
|--------|---------|----------|
| `none` | לא רלוונטי / אין זכאות מערכת ואין דיווח | לא |
| `awaiting_report` | יש צורך בבקרה (מערכת>0 או מרחק חד־כיווני>40) ואין דיווח מדריך | לא |
| `auto_matched` | דיווח תואם למערכת — ממתין לאישור מנהל | לא |
| `pending_review` | יש פער — ממתין להחלטת מנהל | לא |
| `approved` | מנהל אישר את הדיווח/ההתאמה | כן (`approved_cancellation_minutes`) |
| `corrected` | מנהל תיקן ערך מאושר | כן |
| `rejected` | מנהל דחה | לא (0) |

---

## 2. מיפוי מצב קיים (קוד)

| שכבה | נתיב | תפקיד היום |
|------|------|------------|
| טבלה | `attendance_travel_compensations` | calculated/final + override מדריך |
| שורת תשלום | `generation_kind='travel_time_cancellation'` | נוצרת אוטומטית מ־reconcile |
| Edge | `attendance-travel-compensation` | Google Routes → reconcile |
| Override | `av2_override_attendance_time_cancellation` | מדריך משנה final ורואה אוטומטי |
| מנהל | `attendance-control.js` + `manager_finalize_attendance_month_review` | אין שער travel-review |
| שליחה | `av2_submit_attendance_month` | non-blocking על travel |

---

## 3. ארכיטקטורת יעד

```text
Source attendance (physical)
  ├─ guide reports outbound/return (optional; remind if one-way km > 40)
  ├─ system route calc (edge) → system_* only; NEVER creates payable hours
  └─ review engine
        ├─ no report + (system_cancel=0 and one_way_km≤40) → none
        ├─ no report + needs attention → awaiting_report
        ├─ report == system cancel → auto_matched (await manager approve)
        ├─ report ≠ system cancel → pending_review
        └─ manager approve/correct/reject → approved_* + sync generated row
              │
              ▼
        manager_finalize blocked while awaiting_report|auto_matched|pending_review
              │
              ▼
        admin payroll / excel read approved_* / generated child only
```

### 3.1 עמודות / טבלאות

על `attendance_travel_compensations`:

- `reported_outbound_minutes`, `reported_return_minutes`, `reported_at`, `reported_by`
- `system_distance_km` (חד־כיווני מקסימלי הלוך/חזור לשימוש בתזכורת)
- `review_status` (כמפורט למעלה)
- `approved_cancellation_minutes` (nullable עד אישור)
- `review_by`, `review_at`, `review_note`
- `calculated_cancellation_minutes` / `outbound_travel_minutes` / `return_travel_minutes` נשארים כ־system fields (שמות קיימים = system)
- `final_cancellation_minutes` = תואם ל־`coalesce(approved_cancellation_minutes, 0)` אחרי sync (compat)

טבלה: `attendance_travel_compensation_events`.

### 3.2 RPCs

- `av2_report_attendance_travel_time` — דיווח מדריך; מחזיר רק שדות מותרים למדריך
- `av2_instructor_travel_compensation_safe` / קריאת safe — ללא system_*
- `av2_reconcile_attendance_travel` — מעדכן system_* + review_status; **לא** יוצר/מעדכן generated מ־system; לא דורס report/review decision
- `av2_review_attendance_travel_compensation` — approve/correct/reject
- `av2_override_attendance_time_cancellation` — מושבת למדריך / מופנה ל־report או נמחק מ־grant
- `manager_finalize_attendance_month_review` — שער: אין `awaiting_report|auto_matched|pending_review` לחודש

### 3.3 הרשאות מדריך

- מדיניות SELECT על הטבלה: מדריך **לא** קורא ישירות עמודות מערכת, או קורא רק דרך פונקציה/VIEW שמחזירה subset.
- `attendance.service.js` — בלי `select('*')` על compensations; שימוש ב־safe RPC/עמודות מותרות.
- Edge preview להכשרת בסיס — בלי cancellation minutes למדריך.

---

## 4. היסטוריה / Backfill (רק אחרי אישור פריסה)

- חודשים עם אישור מנהל/שכר קיים: `approved_cancellation_minutes = final`, `review_status` בהתאם, **ללא שינוי סכומים**, event `migrated_legacy_payroll_freeze`.
- חודשים פתוחים: לא להעניק approved אוטומטית; system-only generated rows מנותקים עד אישור מנהל במודל החדש.
- **אין להריץ על ייצור בלי אישור מפורש.**

---

## 5. שלבי מימוש A–E

A Schema + review engine · B Edge/helpers/permissions · C Instructor UI · D Manager/admin/payroll gates · E Focused tests + report.

---

## 6. בדיקות חובה לפני בקשת פריסה

נוסחה · דיווח הלוך/חזור · הסתרת system ברמת נתונים · תזכורת 40 חד־כיווני · כל פער ל־pending_review · auto_matched בלי תשלום · approve/correct/reject · כפילויות · submit לא נחסם · finalize נחסם · route change לא דורס report/decision · freeze היסטורי · Zoom/online לא eligible.

---

## 7. מחוץ לתחום

שינוי נוסחת 45 · שינוי ק״מ/תחב״צ · rewrite מסך בקרה · blocking submit למדריך · פריסה לייצור בלי אישור.

---

## 8. קריטריוני קבלה

1. מדריך מדווח הלוך/חזור בלי לראות חישוב מערכת (UI + API).
2. תזכורת מעל 40 ק״מ בכיוון אחד; דיווח תמיד אפשרי.
3. אין שעות תשלום מחישוב מערכת בלבד; רק אחרי אישור מנהל.
4. `auto_matched` ≠ מאושר לשכר.
5. Finalize מנהל נחסם על תורים פתוחים; submit מדריך לא נחסם.
6. חודשי payroll קפואים ללא שינוי סכומים.
7. היסטוריית אירועים מלאה; אין כפל שורות generated.

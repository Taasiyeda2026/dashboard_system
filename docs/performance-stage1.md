# Stage 1 Performance Diagnostics (Measurement Only)

מסמך זה מתאר איך להפעיל ולקרוא את המדידה שנוספה בשלב 1, ללא rewrite וללא שינוי UX.

## 1) איך מפעילים מדידה

ב־DevTools Console:

```js
localStorage.setItem('debug_perf', '1');
// או:
window.__DEBUG_PERF__ = true;
```

לאחר מכן לבצע רענון דף.

> כדי לכבות:
```js
localStorage.removeItem('debug_perf');
window.__DEBUG_PERF__ = false;
```

## 2) איפה רואים נתונים

### Backend / Sheets / Payload

בכל response של API (כאשר debug פעיל) יתווסף:

```js
data.debug_perf
```

שדות מרכזיים:
- `total_ms` — זמן פעולה בשרת
- `sheets_total_ms` — סך זמן קריאות שיטס
- `sheet_reads[]` — פירוט לפי sheet
- `response_size_bytes` — גודל התשובה בבייטים

### Frontend

ב־Console:

```js
window.__dsPerf.requests   // היסטוריית קריאות API
window.__dsPerf.renders    // היסטוריית זמני render
window.__dsPerf.screens    // אגרגציה לפי action
```

## 3) איך מאפסים

```js
window.__resetDsPerf();
```

או ידנית:

```js
window.__dsPerf = { requests: [], renders: [], screens: {} };
```

## 4) איך לזהות מסכים כבדים

1. נקה מדידה (`window.__resetDsPerf()`), פתח מסך יחיד, בצע 3–5 ניווטים.
2. מיין קריאות backend:

```js
[...window.__dsPerf.requests]
  .sort((a, b) => b.duration_ms - a.duration_ms)
  .slice(0, 10);
```

3. מיין render:

```js
[...window.__dsPerf.renders]
  .sort((a, b) => b.duration_ms - a.duration_ms)
  .slice(0, 10);
```

4. חפש התאמה בין:
   - `duration_ms` גבוה
   - `backend_debug.sheets_total_ms` גבוה
   - `payload_bytes` גבוה
   - `render duration_ms` גבוה

כך אפשר לדעת אם הבעיה היא בעיקר backend, שיטס, payload או render.

## 5) דגימת הרצה מקומית מהירה

לצורך בדיקת end-to-end מקומית (mock data) אפשר להריץ:

```bash
node scripts/perf_sample.mjs
```

הסקריפט מחזיר JSON עם:
- `backend_ms`
- `sheets_read_ms`
- `payload_bytes`
- `render_ms`

למסכים:
- dashboard
- activities
- finance

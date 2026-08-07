// Print template for the school_2027 work schedule ("סידור עבודה"), rendered
// per instructor from the exact same ready-course rows the on-screen table
// uses (see instructor-course-schedule-2027.js) — one card per course, one
// card row layout, nothing summer_2026-specific lives in this file.
import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';

const FILE_NAME_FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

export function sanitizePrintFileName(value) {
  return String(value || '').replace(FILE_NAME_FORBIDDEN_CHARS, '').trim();
}

export function buildCourseSchedulePrintDocumentTitle(instructorName) {
  const safeInstructorName = sanitizePrintFileName(instructorName) || 'ללא שם';
  return `סידור עבודה - ${safeInstructorName} - תשפ״ז`;
}

function fieldRowHtml(label, value) {
  const text = String(value ?? '').trim();
  return `<div class="cs-field"><span class="cs-field__label">${escapeHtml(label)}</span><span class="cs-field__value">${escapeHtml(text || '—')}</span></div>`;
}

function courseCardHtml(row) {
  const dates = Array.isArray(row?.dates) ? row.dates : [];
  const datesHtml = dates.map((date) => `<li>${escapeHtml(formatDateHe(date))}</li>`).join('');
  return `<article class="cs-card">
    <div class="cs-card__col">
      <h2 class="cs-card__col-title">פרטי הקורס</h2>
      ${fieldRowHtml('שם הקורס', row.name)}
      ${fieldRowHtml('רשות', row.authority)}
      ${fieldRowHtml('בית ספר', row.school)}
      ${fieldRowHtml('כיתה', row.grade)}
    </div>
    <div class="cs-card__col">
      <h2 class="cs-card__col-title">מועדי הפעילות</h2>
      ${fieldRowHtml('יום קבוע', row.weekday)}
      ${fieldRowHtml('שעות', row.timeRange)}
      ${fieldRowHtml('תאריך התחלה', formatDateHe(row.startDate))}
      ${fieldRowHtml('תאריך סיום', formatDateHe(row.endDate))}
      ${fieldRowHtml('מספר מפגשים', String(row.sessionsCount ?? dates.length))}
    </div>
    <div class="cs-card__col cs-card__col--dates">
      <h2 class="cs-card__col-title">תאריכי כל המפגשים</h2>
      <ol class="cs-dates-list">${datesHtml}</ol>
    </div>
  </article>`;
}

export function buildCourseSchedulePrintHtml({ instructorName = '', rows = [] } = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const allDates = safeRows.flatMap((row) => (Array.isArray(row.dates) ? row.dates : [])).slice().sort();
  const periodFrom = allDates.length ? formatDateHe(allDates[0]) : '—';
  const periodTo = allDates.length ? formatDateHe(allDates[allDates.length - 1]) : '—';
  const totalMeetings = safeRows.reduce((sum, row) => sum + (Array.isArray(row.dates) ? row.dates.length : 0), 0);
  const cardsHtml = safeRows.map(courseCardHtml).join('');
  return `<div class="cs-print-page">
    <h1 class="cs-print-title">סידור עבודה למדריך - תשפ״ז</h1>
    <p class="cs-print-instructor"><strong>שם המדריך:</strong> ${escapeHtml(instructorName || '—')}</p>
    <p class="cs-print-period"><strong>תקופת הפעילות:</strong> ${escapeHtml(periodFrom)}-${escapeHtml(periodTo)}</p>
    <p class="cs-print-summary">מספר קורסים: ${safeRows.length} | מספר מפגשים כולל: ${totalMeetings}</p>
    <div class="cs-print-cards">${cardsHtml}</div>
  </div>`;
}

export function courseSchedulePrintCss() {
  return `
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:0;color:#0f172a;background:#fff;font-size:11px;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cs-print-page{width:100%;box-sizing:border-box}
    .cs-print-title{margin:0 0 6px;font-size:16px;font-weight:800;color:#0f172a;text-align:center}
    .cs-print-instructor,.cs-print-period{margin:0 0 3px;font-size:12px;text-align:center;color:#1e293b}
    .cs-print-instructor strong,.cs-print-period strong{color:#1e3a8a}
    .cs-print-summary{margin:0 0 12px;font-size:10px;text-align:center;color:#475569}
    .cs-print-cards{display:flex;flex-direction:column;gap:8px}
    .cs-card{display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));border:1px solid #94a3b8;border-radius:6px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;background:#fff}
    .cs-card__col{padding:8px 10px;box-sizing:border-box;border-inline-start:1px solid #cbd5e1;min-width:0}
    .cs-card__col:first-child{border-inline-start:none}
    .cs-card__col-title{height:14px;line-height:14px;margin:0 0 6px;padding:3px 0;font-size:11px;font-weight:800;color:#0c4a6e;background:#e0f2fe;border-bottom:1px solid #7dd3fc;text-align:center}
    .cs-field{display:flex;justify-content:space-between;align-items:baseline;gap:6px;margin:0 0 4px;font-size:10px}
    .cs-field__label{color:#334155;font-weight:700;white-space:nowrap}
    .cs-field__value{color:#1e3a8a;font-weight:700;text-align:right;overflow-wrap:anywhere}
    .cs-dates-list{margin:0;padding-inline-start:14px;column-count:2;column-gap:10px;font-size:10px;color:#1e3a8a;font-weight:600;list-style-position:outside}
    .cs-dates-list li{break-inside:avoid;margin-bottom:2px}
    @page{size:A4 portrait;margin:10mm}
    @media print{body{margin:0}.cs-card{break-inside:avoid;page-break-inside:avoid}}
  `;
}

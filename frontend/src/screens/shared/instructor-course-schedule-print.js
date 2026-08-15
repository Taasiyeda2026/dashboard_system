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
  const datesHtml = dates.map((date) => `<span class="cs-date">${escapeHtml(formatDateHe(date))}</span>`).join('');
  return `<article class="cs-card">
    <div class="cs-card__details">
      <section class="cs-card__section">
        <h2 class="cs-card__section-title">פרטי הקורס</h2>
        ${fieldRowHtml('שם הקורס', row.name)}
        ${fieldRowHtml('רשות', row.authority)}
        ${fieldRowHtml('בית ספר', row.school)}
        ${fieldRowHtml('כיתה', row.grade)}
      </section>
      <section class="cs-card__section">
        <h2 class="cs-card__section-title">מועדי הפעילות</h2>
        ${fieldRowHtml('יום קבוע', row.weekday)}
        ${fieldRowHtml('שעות', row.timeRange)}
        ${fieldRowHtml('תאריך התחלה', formatDateHe(row.startDate))}
        ${fieldRowHtml('תאריך סיום', formatDateHe(row.endDate))}
        ${fieldRowHtml('מספר מפגשים', String(row.sessionsCount ?? dates.length))}
      </section>
    </div>
    <section class="cs-card__dates">
      <h2 class="cs-card__dates-title">תאריכי המפגשים</h2>
      <div class="cs-dates-grid">${datesHtml}</div>
    </section>
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
    <header class="cs-print-header">
      <h1 class="cs-print-title">סידור עבודה למדריך – תשפ״ז</h1>
      <div class="cs-print-meta">
        <p><strong>שם המדריך:</strong> ${escapeHtml(instructorName || '—')}</p>
        <p><strong>תקופת הפעילות:</strong> ${escapeHtml(periodFrom)}–${escapeHtml(periodTo)}</p>
        <p><strong>סיכום:</strong> מספר קורסים: ${safeRows.length} · מספר מפגשים כולל: ${totalMeetings}</p>
      </div>
    </header>
    <div class="cs-print-cards">${cardsHtml}</div>
  </div>`;
}

export function courseSchedulePrintCss() {
  return `
    *{box-sizing:border-box}
    body{direction:rtl;font-family:Assistant,Arial,sans-serif;margin:0;color:#172033;background:#fff;font-size:10.5px;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .cs-print-page{width:100%;box-sizing:border-box}
    .cs-print-header{margin:0 0 8px;padding:0 0 7px;border-bottom:2px solid #1e3a5f}
    .cs-print-title{margin:0 0 5px;font-size:17px;line-height:1.2;font-weight:800;color:#102a43;text-align:center}
    .cs-print-meta{display:flex;justify-content:center;flex-wrap:wrap;gap:3px 18px;color:#334155}
    .cs-print-meta p{margin:0;white-space:nowrap}
    .cs-print-meta strong{color:#163d68}
    .cs-print-cards{display:flex;flex-direction:column;gap:7px}
    .cs-card{border:1px solid #9aa9ba;border-radius:5px;overflow:hidden;break-inside:avoid;page-break-inside:avoid;background:#fff}
    .cs-card__details{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .cs-card__section{padding:6px 9px 5px;min-width:0}
    .cs-card__section+ .cs-card__section{border-inline-start:1px solid #d5dce5}
    .cs-card__section-title,.cs-card__dates-title{margin:0 0 5px;font-size:11px;line-height:1.25;font-weight:800;color:#174a73}
    .cs-card__section-title{padding-bottom:3px;border-bottom:1px solid #b9c9d8}
    .cs-field{display:grid;grid-template-columns:max-content minmax(0,1fr);align-items:baseline;gap:3px 8px;margin:0 0 2px}
    .cs-field__label{color:#475569;font-weight:700;white-space:nowrap}
    .cs-field__value{color:#132f52;font-weight:600;overflow-wrap:anywhere}
    .cs-card__dates{padding:5px 9px 7px;border-top:1px solid #cbd5e1;background:#f8fafc}
    .cs-card__dates-title{margin-bottom:4px}
    .cs-dates-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px 6px}
    .cs-date{padding:2px 4px;border:1px solid #d4dde7;border-radius:3px;background:#fff;color:#163d68;font-size:9.5px;font-weight:600;text-align:center;white-space:nowrap}
    @page{size:A4 portrait;margin:10mm}
    @media print{body{margin:0}.cs-card{break-inside:avoid;page-break-inside:avoid}.cs-print-header{break-after:avoid;page-break-after:avoid}}
  `;
}

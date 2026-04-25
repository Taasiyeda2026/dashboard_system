import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { formatDateHe } from './shared/format-date.js';

const DATE_COLS = Array.from({ length: 35 }, (_, idx) => `Date${idx + 1}`);

function asIso(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function extractValidDates(row) {
  return DATE_COLS
    .map((col) => asIso(row?.[col]))
    .filter(Boolean);
}

function monthLabelFromIso(iso) {
  const [year, month] = iso.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(year, month - 1, 1));
  return dt.toLocaleDateString('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function normalizeRows(rows) {
  return rows
    .filter((row) => String(row?.source_sheet || '').trim() === 'data_long')
    .map((row) => {
      const fallbackEndDate = extractValidDates(row).slice(-1)[0] || '';
      const endDate = asIso(row?.end_date) || fallbackEndDate;
      return {
        ...row,
        end_date: endDate,
        validDates: extractValidDates(row)
      };
    })
    .filter((row) => !!row.end_date)
    .sort((a, b) => {
      if (a.end_date !== b.end_date) return a.end_date.localeCompare(b.end_date);
      const schoolCmp = String(a.school || '').localeCompare(String(b.school || ''), 'he');
      if (schoolCmp !== 0) return schoolCmp;
      return String(a.activity_name || '').localeCompare(String(b.activity_name || ''), 'he');
    });
}

function groupByMonth(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.end_date.slice(0, 7);
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: monthLabelFromIso(`${key}-01`),
        rows: []
      });
    }
    map.get(key).rows.push(row);
  });
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function renderActivityCard(row) {
  const validDates = row.validDates || [];
  const datesHtml = validDates.length
    ? `<div class="ds-end-dates__dates-list">${validDates
        .map((iso) => `<span class="ds-end-dates__date-pill">${escapeHtml(formatDateHe(iso))}</span>`)
        .join('')}</div>`
    : '<p class="ds-end-dates__muted">לא נמצאו תאריכים תקינים.</p>';

  return `<details class="ds-activity-accordion ds-end-dates__activity" data-end-dates-accordion>
    <summary class="ds-activity-accordion__summary ds-end-dates__summary" role="button" aria-label="פתיחת פירוט תאריכים">
      <span class="ds-activity-accordion__name ds-end-dates__summary-grid">
        <span>${escapeHtml(String(row.activity_name || '—'))}</span>
        <span>${escapeHtml(String(row.school || '—'))}</span>
        <span>${escapeHtml(String(row.authority || '—'))}</span>
        <span>${escapeHtml(formatDateHe(row.end_date))}</span>
      </span>
      <span class="ds-activity-accordion__chevron" aria-hidden="true">›</span>
    </summary>
    <div class="ds-activity-accordion__body">
      <p class="ds-end-dates__dates-title">פירוט תאריכים (${escapeHtml(String(validDates.length))})</p>
      ${datesHtml}
    </div>
  </details>`;
}

function exportRowsToExcel(rows) {
  const headers = ['חודש', 'שם פעילות', 'בית ספר', 'רשות', 'תאריך סיום', 'פירוט תאריכים'];
  const tableRows = rows
    .map((row) => {
      const month = monthLabelFromIso(`${row.end_date.slice(0, 7)}-01`);
      const datesText = (row.validDates || []).map((iso) => formatDateHe(iso)).join(', ');
      return `<tr>
        <td>${escapeHtml(month)}</td>
        <td>${escapeHtml(String(row.activity_name || ''))}</td>
        <td>${escapeHtml(String(row.school || ''))}</td>
        <td>${escapeHtml(String(row.authority || ''))}</td>
        <td>${escapeHtml(formatDateHe(row.end_date))}</td>
        <td>${escapeHtml(datesText)}</td>
      </tr>`;
    })
    .join('');

  const html = `<!doctype html><html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8"></head><body>
    <table border="1"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${tableRows}</tbody></table>
  </body></html>`;

  const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `תאריכי_סיום_${stamp}.xls`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const endDatesScreen = {
  load: ({ api }) => api.endDates(),
  render(data) {
    const rawRows = Array.isArray(data?.rows) ? data.rows : [];
    const rows = normalizeRows(rawRows);
    const months = groupByMonth(rows);

    const headerTools = `<div class="ds-end-dates__head-tools">
      <button type="button" class="ds-icon-btn" data-end-dates-export title="ייצוא לאקסל" aria-label="ייצוא לאקסל">⬇️</button>
    </div>`;

    const body = months.length
      ? `<div class="ds-end-dates__months">${months
          .map((month) => `<section class="ds-end-dates__month-group" data-end-dates-month="${escapeHtml(month.key)}">
            <h3 class="ds-end-dates__month-title">${escapeHtml(month.label)}</h3>
            <div class="ds-end-dates__month-list">${month.rows.map(renderActivityCard).join('')}</div>
          </section>`)
          .join('')}</div>`
      : dsEmptyState('לא נמצאו פעילויות מתמשכות עם תאריך סיום');

    return dsScreenStack(
      dsCard({
        title: 'תאריכי סיום פעילויות',
        badge: `${rows.length} פעילויות`,
        body: `${headerTools}${body}`,
        padded: true
      })
    );
  },
  bind({ root, data }) {
    const rows = normalizeRows(Array.isArray(data?.rows) ? data.rows : []);
    root.querySelector('[data-end-dates-export]')?.addEventListener('click', () => {
      exportRowsToExcel(rows);
    });
  }
};

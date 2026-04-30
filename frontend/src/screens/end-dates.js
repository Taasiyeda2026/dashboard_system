import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { formatDateHe } from './shared/format-date.js';

function asIso(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function monthLabelFromIso(iso) {
  const [year, month] = iso.split('-').map((v) => Number(v));
  const dt = new Date(Date.UTC(year, month - 1, 1));
  return dt.toLocaleDateString('he-IL', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function resolveDates(row) {
  const fromMeetings = Array.isArray(row?.meeting_dates)
    ? row.meeting_dates.map((d) => asIso(d)).filter(Boolean)
    : [];
  if (fromMeetings.length) return { dates: fromMeetings, source: 'meetings' };
  const fromCols = Array.isArray(row?.date_cols)
    ? row.date_cols.map((d) => asIso(d)).filter(Boolean)
    : [];
  if (fromCols.length) return { dates: fromCols, source: 'cols' };
  return { dates: [], source: 'none' };
}

function normalizeRows(rows) {
  return rows
    .filter((row) => String(row?.source_sheet || '').trim() === 'data_long')
    .map((row) => {
      const endDate = asIso(row?.end_date);
      if (!endDate) return null;
      const { dates, source } = resolveDates(row);
      return { ...row, end_date: endDate, _dates: dates, _dateSource: source };
    })
    .filter(Boolean)
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
    if (!map.has(key)) map.set(key, { key, label: monthLabelFromIso(`${key}-01`), rows: [] });
    map.get(key).rows.push(row);
  });
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function renderMonthTable(month, monthIdx) {
  const tableRows = month.rows.map((row, rowIdx) => {
    const rowId   = `ed-${monthIdx}-${rowIdx}`;
    const dates   = row._dates || [];
    const pillsHtml = dates.length
      ? dates.map((iso) => `<span class="ds-end-dates__date-pill">${escapeHtml(formatDateHe(iso))}</span>`).join('')
      : '<span class="ds-end-dates__muted">לא נמצאו תאריכי מפגש.</span>';

    return `<tr class="ds-end-row" data-end-row="${escapeHtml(rowId)}">
        <td class="ds-end-td ds-end-td--name">${escapeHtml(String(row.activity_name || '—'))}</td>
        <td class="ds-end-td">${escapeHtml(String(row.school || '—'))}</td>
        <td class="ds-end-td">${escapeHtml(String(row.authority || '—'))}</td>
        <td class="ds-end-td ds-end-td--date"><time>${escapeHtml(formatDateHe(row.end_date))}</time></td>
        <td class="ds-end-td ds-end-td--actions">
          <button type="button" class="ds-end-export-btn" data-end-export="${escapeHtml(rowId)}" title="ייצוא שורה זו לאקסל" aria-label="ייצוא לאקסל">⬇</button>
        </td>
      </tr>
      <tr class="ds-end-expand-row" id="ds-end-expand-${escapeHtml(rowId)}" hidden>
        <td colspan="5" class="ds-end-expand-td">
          <div class="ds-end-dates__dates-list">${pillsHtml}</div>
          <p class="ds-end-dates__meta"><strong>מנהל פעילויות:</strong> ${escapeHtml(String(row.activity_manager || '—'))}</p>
        </td>
      </tr>`;
  }).join('');

  return `<section class="ds-end-dates__month-group" dir="rtl">
    <h3 class="ds-end-dates__month-title">
      ${escapeHtml(month.label)}
      <span class="ds-end-dates__month-count">${month.rows.length}</span>
    </h3>
    <table class="ds-end-table" dir="rtl">
      <thead><tr>
        <th class="ds-end-th ds-end-th--name">שם פעילות</th>
        <th class="ds-end-th">בית ספר</th>
        <th class="ds-end-th">רשות</th>
        <th class="ds-end-th ds-end-th--date">תאריך סיום</th>
        <th class="ds-end-th ds-end-th--actions"></th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </section>`;
}

function buildExcelBlob(rows) {
  const maxMeetingDates = rows.reduce((max, row) => Math.max(max, Array.isArray(row?._dates) ? row._dates.length : 0), 0);
  const dateHeaders = Array.from({ length: maxMeetingDates }, (_, idx) => `תאריך סיום ${idx + 1}`);
  const headers = ['שם פעילות', 'בית ספר', 'רשות', 'תאריך סיום', ...dateHeaders];
  const tableRows = rows.map((row) => {
    const dateCells = Array.from({ length: maxMeetingDates }, (_, idx) => {
      const iso = row?._dates?.[idx];
      return `<td>${escapeHtml(iso ? formatDateHe(iso) : '')}</td>`;
    }).join('');
    return `<tr>
      <td>${escapeHtml(String(row.activity_name || ''))}</td>
      <td>${escapeHtml(String(row.school || ''))}</td>
      <td>${escapeHtml(String(row.authority || ''))}</td>
      <td>${escapeHtml(formatDateHe(row.end_date))}</td>
      ${dateCells}
    </tr>`;
  }).join('');

  const html = `<!doctype html><html dir="rtl" xmlns:x="urn:schemas-microsoft-com:office:excel">
    <head><meta charset="UTF-8"></head><body>
    <table border="1"><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody></table></body></html>`;

  return new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const endDatesScreen = {
  load: ({ api }) => api.endDates(),

  render(data) {
    const rawRows = Array.isArray(data?.rows) ? data.rows : [];
    const rows    = normalizeRows(rawRows);
    const months  = groupByMonth(rows);

    const headerTools = `<div class="ds-end-dates__head-tools">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-end-dates-export title="ייצוא כל הפעילויות לאקסל" aria-label="ייצוא הכל לאקסל">⬇ ייצוא הכל</button>
    </div>`;

    const body = months.length
      ? `<div class="ds-end-dates__months">${months.map((m, i) => renderMonthTable(m, i)).join('')}</div>`
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
    const allRows = normalizeRows(Array.isArray(data?.rows) ? data.rows : []);
    const months  = groupByMonth(allRows);

    const rowMap = new Map();
    months.forEach((month, monthIdx) => {
      month.rows.forEach((row, rowIdx) => rowMap.set(`ed-${monthIdx}-${rowIdx}`, row));
    });

    root.querySelector('[data-end-dates-export]')?.addEventListener('click', () => {
      const stamp = new Date().toISOString().slice(0, 10);
      triggerDownload(buildExcelBlob(allRows), `תאריכי_סיום_${stamp}.xls`);
    });

    root.querySelectorAll('[data-end-row]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        if (e.target.closest('[data-end-export]')) return;
        const rowId    = tr.dataset.endRow;
        const expandTr = document.getElementById(`ds-end-expand-${rowId}`);
        if (!expandTr) return;
        const isOpen   = !expandTr.hidden;
        expandTr.hidden = isOpen;
        tr.classList.toggle('is-expanded', !isOpen);
      });
    });

    root.querySelectorAll('[data-end-export]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rowId = btn.dataset.endExport;
        const row   = rowMap.get(rowId);
        if (!row) return;
        const name  = String(row.activity_name || 'פעילות')
          .replace(/[/\\?%*:|"<>]/g, '_').slice(0, 40);
        const stamp = new Date().toISOString().slice(0, 10);
        triggerDownload(buildExcelBlob([row]), `${name}_${stamp}.xls`);
      });
    });
  }
};

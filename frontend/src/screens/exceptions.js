import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { hebrewExceptionType, hebrewColumn, exceptionTypeVariant } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsFilterBar,
  dsInteractiveCard,
  dsStatusChip
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';

const MISSING_BADGE = `<span class="ds-exc-badge ds-exc-badge--missing">⚠️ חסר</span>`;
const LATE_BADGE    = `<span class="ds-exc-badge ds-exc-badge--late">⏱️ מאוחר</span>`;

function fieldRow(label, value, cls, badge) {
  const display = value ? escapeHtml(String(value)) : '<em style="color:var(--ds-text-muted)">—</em>';
  const clsAttr = cls ? ` class="${cls}"` : '';
  return `<p${clsAttr}><strong>${escapeHtml(label)}:</strong> ${display}${badge || ''}</p>`;
}

function exceptionDrawerHtml(row, hideRowId) {
  const et = String(row.exception_type || '').trim();
  const typeChip = dsStatusChip(hebrewExceptionType(et), exceptionTypeVariant(et));

  const isMissingInstructor = et === 'missing_instructor';
  const isMissingStartDate  = et === 'missing_start_date';
  const isLateEndDate       = et === 'late_end_date';

  const instructor = row.instructor_name || row.instructor || '';
  const startDate  = formatDateHe(row.start_date) || row.start_date || '';
  const endDate    = formatDateHe(row.end_date)   || row.end_date   || '';

  return `<div class="ds-details-grid" dir="rtl">
    ${hideRowId ? '' : `<p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>`}
    <p><strong>סוג חריגה:</strong> ${typeChip}</p>
    ${fieldRow(hebrewColumn('activity_name'), row.activity_name || '', '', '')}
    ${fieldRow('מדריך',                       instructor, isMissingInstructor ? 'ds-exc-field--missing' : '', isMissingInstructor ? MISSING_BADGE : '')}
    ${fieldRow(hebrewColumn('start_date'),    startDate,  isMissingStartDate  ? 'ds-exc-field--missing' : '', isMissingStartDate  ? MISSING_BADGE : '')}
    ${fieldRow(hebrewColumn('end_date'),      endDate,    isLateEndDate       ? 'ds-exc-field--late'    : '', isLateEndDate       ? LATE_BADGE    : '')}
  </div>`;
}

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name || '').toLowerCase().includes(lq) ||
      String(r.RowID || '').toLowerCase().includes(lq) ||
      hebrewExceptionType(r.exception_type).includes(lq)
  );
}

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const narrow = isNarrowViewport();
    const searchQ = state?.exceptionsSearch || '';
    const typeFilter = state?.exceptionsTypeFilter || '';
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;

    let safeRows = applySearch(allRows, searchQ);
    if (typeFilter) {
      safeRows = safeRows.filter((r) => String(r.exception_type || '') === typeFilter);
    }

    const exTypes = [...new Set(allRows.map((r) => String(r.exception_type || '')).filter(Boolean))];
    const typeChips = [{ val: '', label: 'הכל' }, ...exTypes.map((t) => ({ val: t, label: hebrewExceptionType(t) }))]
      .map(
        (c) =>
          `<button type="button" class="ds-chip ${c.val === typeFilter ? 'is-active' : ''}" data-type-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      )
      .join('');

    const rows = safeRows.map((row, idx) => {
      const et = String(row.exception_type || '').trim();
      const searchHay = [hideRowId ? '' : row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.end_date].join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}" data-exc-idx="${idx}" role="button" tabindex="0">${hideRowId ? '' : `<td>${escapeHtml(row.RowID)}</td>`}<td>${dsStatusChip(hebrewExceptionType(row.exception_type), exceptionTypeVariant(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(formatDateHe(row.end_date) || '—')}</td></tr>`;
    });

    const summaryChips = `
      <span class="ds-chip ds-chip--status ds-chip--status-warning"><span aria-hidden="true">⚠️</span> חסר מדריך: ${counts.missing_instructor}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-warning"><span aria-hidden="true">📅</span> חסר תאריך התחלה: ${counts.missing_start_date}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-danger"><span aria-hidden="true">⏱️</span> תאריך סיום מאוחר: ${counts.late_end_date}</span>
    `;

    const tableBlock =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${hideRowId ? '' : `<th>${escapeHtml(hebrewColumn('RowID'))}</th>`}<th>${escapeHtml(hebrewColumn('exception_type'))}</th><th>${escapeHtml(hebrewColumn('activity_name'))}</th><th>${escapeHtml(hebrewColumn('end_date'))}</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>`);

    const compact =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${safeRows
            .map((row, idx) => {
              const et = String(row.exception_type || '').trim();
              const searchHay = [hideRowId ? '' : row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.end_date].join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `exception:${idx}`,
                title: row.activity_name || '—',
                subtitle: hebrewExceptionType(row.exception_type),
                meta: hideRowId ? (formatDateHe(row.end_date) || '—') : `מזהה ${row.RowID} · ${formatDateHe(row.end_date) || '—'}`
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('חריגות', 'נתונים הדורשים טיפול')}
      <div class="ds-screen-shortcuts" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-back-activities>חזור</button>
      </div>
      <div class="ds-screen-top-row">
        <input
          id="exceptions-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש חריגה..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      ${dsFilterBar(summaryChips)}
      <div class="ds-filter-bar" role="toolbar">${typeChips}</div>
      ${dsCard({
        title: 'רשימת חריגות',
        body: narrow ? compact : tableBlock,
        padded: safeRows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, state, rerender }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    root.querySelector('[data-back-activities]')?.addEventListener('click', () => {
      state.route = 'activities';
      rerender?.();
    });

    root.querySelector('#exceptions-search')?.addEventListener('input', (ev) => {
      state.exceptionsSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('[data-type-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.exceptionsTypeFilter = btn.dataset.typeFilter || '';
        rerender();
      });
    });

    const openAt = (idx) => {
      const hit = allRows[idx];
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.activity_name || (hideRowId ? 'חריגה' : `חריגה · ${hit.RowID}`),
        content: exceptionDrawerHtml(hit, hideRowId)
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => openAt(Number(rowNode.dataset.excIdx)));
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('exception:')) return;
      const idx = Number(action.slice('exception:'.length));
      openAt(idx);
    });
  }
};

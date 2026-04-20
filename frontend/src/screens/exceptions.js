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
  const manager    = row.activity_manager || '';

  return `<div class="ds-details-grid" dir="rtl">
    ${hideRowId ? '' : `<p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>`}
    <p><strong>סוג חריגה:</strong> ${typeChip}</p>
    ${fieldRow(hebrewColumn('activity_name'),    row.activity_name || '', '', '')}
    ${fieldRow(hebrewColumn('activity_manager'), manager,    '', '')}
    ${fieldRow('מדריך',                          instructor, isMissingInstructor ? 'ds-exc-field--missing' : '', isMissingInstructor ? MISSING_BADGE : '')}
    ${fieldRow(hebrewColumn('start_date'),        startDate,  isMissingStartDate  ? 'ds-exc-field--missing' : '', isMissingStartDate  ? MISSING_BADGE : '')}
    ${fieldRow(hebrewColumn('end_date'),          endDate,    isLateEndDate       ? 'ds-exc-field--late'    : '', isLateEndDate       ? LATE_BADGE    : '')}
  </div>`;
}

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name    || '').toLowerCase().includes(lq) ||
      String(r.RowID            || '').toLowerCase().includes(lq) ||
      String(r.activity_manager || '').toLowerCase().includes(lq) ||
      hebrewExceptionType(r.exception_type).includes(lq)
  );
}

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const narrow = isNarrowViewport();
    const searchQ          = state?.exceptionsSearch          || '';
    const typeFilter       = state?.exceptionsTypeFilter       || '';
    const managerFilter    = state?.exceptionsManagerFilter    || '';
    const hideRowId        = !!state?.clientSettings?.hide_row_id_in_ui;

    let safeRows = applySearch(allRows, searchQ);
    if (typeFilter)    safeRows = safeRows.filter((r) => String(r.exception_type    || '') === typeFilter);
    if (managerFilter) safeRows = safeRows.filter((r) => String(r.activity_manager  || '') === managerFilter);

    /* ── type filter chips ── */
    const exTypes = [...new Set(allRows.map((r) => String(r.exception_type || '')).filter(Boolean))];
    const typeChips = [{ val: '', label: 'הכל' }, ...exTypes.map((t) => ({ val: t, label: hebrewExceptionType(t) }))]
      .map((c) =>
        `<button type="button" class="ds-chip ${c.val === typeFilter ? 'is-active' : ''}" data-type-filter="${escapeHtml(c.val)}">${escapeHtml(c.label)}</button>`
      ).join('');

    /* ── manager filter chips — only when there are ≥2 distinct managers ── */
    const managerCounts = {};
    allRows.forEach((r) => {
      const m = String(r.activity_manager || '').trim();
      if (m) managerCounts[m] = (managerCounts[m] || 0) + 1;
    });
    const managers = Object.keys(managerCounts).sort();
    const managerChipsHtml = managers.length >= 2
      ? `<div class="ds-filter-bar ds-filter-bar--managers" role="toolbar" dir="rtl">
          <span class="ds-filter-bar__label">מנהל:</span>
          <button type="button" class="ds-chip ${!managerFilter ? 'is-active' : ''}" data-manager-filter="">${escapeHtml('הכל')}</button>
          ${managers.map((m) =>
            `<button type="button" class="ds-chip ${m === managerFilter ? 'is-active' : ''}" data-manager-filter="${escapeHtml(m)}">${escapeHtml(m)} <span class="ds-chip__count">(${managerCounts[m]})</span></button>`
          ).join('')}
        </div>`
      : '';

    /* ── summary chips ── */
    const summaryChips = `
      <span class="ds-chip ds-chip--status ds-chip--status-warning"><span aria-hidden="true">⚠️</span> חסר מדריך: ${counts.missing_instructor}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-warning"><span aria-hidden="true">📅</span> חסר תאריך התחלה: ${counts.missing_start_date}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-danger"><span aria-hidden="true">⏱️</span> תאריך סיום מאוחר: ${counts.late_end_date}</span>
    `;

    /* ── table rows ── */
    const tableRows = safeRows.map((row, idx) => {
      const et = String(row.exception_type || '').trim();
      const mgr = escapeHtml(row.activity_manager || '—');
      const searchHay = [hideRowId ? '' : row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.activity_manager, row.end_date].join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}" data-exc-idx="${idx}" role="button" tabindex="0">
        ${hideRowId ? '' : `<td>${escapeHtml(row.RowID)}</td>`}
        <td>${dsStatusChip(hebrewExceptionType(row.exception_type), exceptionTypeVariant(row.exception_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td class="ds-muted">${mgr}</td>
        <td>${escapeHtml(formatDateHe(row.end_date) || '—')}</td>
      </tr>`;
    });

    const tableBlock =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>
              ${hideRowId ? '' : `<th>${escapeHtml(hebrewColumn('RowID'))}</th>`}
              <th>${escapeHtml(hebrewColumn('exception_type'))}</th>
              <th>${escapeHtml(hebrewColumn('activity_name'))}</th>
              <th>${escapeHtml(hebrewColumn('activity_manager'))}</th>
              <th>${escapeHtml(hebrewColumn('end_date'))}</th>
            </tr></thead>
            <tbody>${tableRows.join('')}</tbody>
          </table>`);

    const compact =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${safeRows
            .map((row, idx) => {
              const et = String(row.exception_type || '').trim();
              const mgr = row.activity_manager ? ` · ${row.activity_manager}` : '';
              const searchHay = [hideRowId ? '' : row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.activity_manager, row.end_date].join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `exception:${idx}`,
                title: row.activity_name || '—',
                subtitle: hebrewExceptionType(row.exception_type),
                meta: (hideRowId ? '' : `מזהה ${row.RowID} · `) + (formatDateHe(row.end_date) || '—') + mgr
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
      ${managerChipsHtml}
      ${dsCard({
        title: `חריגות · ${safeRows.length}`,
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

    root.querySelectorAll('[data-manager-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.exceptionsManagerFilter = btn.dataset.managerFilter || '';
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

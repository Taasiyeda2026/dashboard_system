import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { formatDateHe } from './shared/format-date.js';
import { hebrewExceptionType, hebrewColumn, exceptionTypeVariant } from './shared/ui-hebrew.js';
import {
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsFilterBar,
  dsStatusChip
} from './shared/layout.js';

const MISSING_BADGE = `<span class="ds-exc-badge ds-exc-badge--missing">⚠️ חסר</span>`;
const LATE_BADGE    = `<span class="ds-exc-badge ds-exc-badge--late">⏱️ מאוחר</span>`;

function fieldRow(label, value, badge) {
  const display = (value !== undefined && value !== null && value !== '')
    ? escapeHtml(String(value))
    : '<em style="color:var(--ds-text-muted)">—</em>';
  return `<p><strong>${escapeHtml(label)}:</strong> ${display}${badge || ''}</p>`;
}

function exceptionDrawerHtml(row, hideRowId) {
  const et = String(row.exception_type || '').trim();
  const typeChip = dsStatusChip(hebrewExceptionType(et), exceptionTypeVariant(et));

  const isMissingInstructor = et === 'missing_instructor';
  const isMissingStartDate  = et === 'missing_start_date';
  const isLateEndDate       = et === 'late_end_date';

  const instructor  = row.instructor_name  || '';
  const instructor2 = row.instructor_name_2 || '';
  const startDate   = formatDateHe(row.start_date) || row.start_date || '';
  const endDate     = formatDateHe(row.end_date)   || row.end_date   || '';

  return `<div class="ds-details-grid" dir="rtl">
    ${hideRowId ? '' : `<p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>`}
    <p><strong>סוג חריגה:</strong> ${typeChip}</p>
    ${fieldRow(hebrewColumn('activity_name'),    row.activity_name)}
    ${fieldRow(hebrewColumn('activity_type'),    row.activity_type)}
    ${fieldRow(hebrewColumn('authority'),        row.authority)}
    ${fieldRow(hebrewColumn('school'),           row.school)}
    ${fieldRow(hebrewColumn('activity_manager'), row.activity_manager)}
    ${fieldRow('מדריך',
        instructor  ? (row.emp_id  ? `${instructor} (${row.emp_id})`  : instructor)  : '',
        isMissingInstructor ? MISSING_BADGE : '')}
    ${instructor2 ? fieldRow('מדריך 2',
        row.emp_id_2 ? `${instructor2} (${row.emp_id_2})` : instructor2) : ''}
    ${fieldRow(hebrewColumn('start_date'),  startDate, isMissingStartDate ? MISSING_BADGE : '')}
    ${fieldRow(hebrewColumn('end_date'),    endDate,   isLateEndDate      ? LATE_BADGE    : '')}
    ${fieldRow(hebrewColumn('sessions'),    row.sessions)}
    ${fieldRow(hebrewColumn('status'),      row.status)}
    ${row.notes ? fieldRow('הערות', row.notes) : ''}
  </div>`;
}

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter(
    (r) =>
      String(r.activity_name    || '').toLowerCase().includes(lq) ||
      String(r.RowID            || '').toLowerCase().includes(lq) ||
      String(r.authority        || '').toLowerCase().includes(lq) ||
      String(r.school           || '').toLowerCase().includes(lq) ||
      String(r.activity_manager || '').toLowerCase().includes(lq) ||
      hebrewExceptionType(r.exception_type).includes(lq)
  );
}

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const searchQ       = state?.exceptionsSearch       || '';
    const typeFilter    = state?.exceptionsTypeFilter    || '';
    const managerFilter = state?.exceptionsManagerFilter || '';
    const hideRowId     = !!state?.clientSettings?.hide_row_id_in_ui;

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

    /* ── compact cards (always) ── */
    const compact =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${safeRows
            .map((row, idx) => {
              const et = String(row.exception_type || '').trim();
              const searchHay = [
                hideRowId ? '' : row.RowID,
                hebrewExceptionType(row.exception_type),
                row.activity_name,
                row.authority,
                row.school,
                row.activity_manager
              ].join(' ');

              const subtitleParts = [row.authority, row.school].filter(Boolean);
              const subtitleHtml  = subtitleParts.length
                ? `<p class="ds-interactive-card__subtitle">${escapeHtml(subtitleParts.join(' · '))}</p>`
                : '';
              const chipHtml = `<p class="ds-interactive-card__meta">${dsStatusChip(hebrewExceptionType(et), exceptionTypeVariant(et))}</p>`;

              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}">
                <button type="button"
                  class="ds-interactive-card ds-interactive-card--session"
                  data-card-action="${escapeHtml(`exception:${idx}`)}">
                  <p class="ds-interactive-card__title">${escapeHtml(row.activity_name || '—')}</p>
                  ${subtitleHtml}
                  ${chipHtml}
                </button>
              </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${actNavGridHtml(state)}
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
        body: compact,
        padded: safeRows.length === 0
      })}
    `);
  },
  bind({ root, data, ui, state, rerender }) {
    bindActNavGrid(root, { state, rerender });
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;

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

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('exception:')) return;
      const idx = Number(action.slice('exception:'.length));
      openAt(idx);
    });
  }
};

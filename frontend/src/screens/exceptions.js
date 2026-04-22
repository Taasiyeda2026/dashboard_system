import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { formatDateHe } from './shared/format-date.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';
import {
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';

function fieldRow(label, value) {
  const display = (value !== undefined && value !== null && value !== '')
    ? escapeHtml(String(value))
    : '<em style="color:var(--ds-text-muted)">—</em>';
  return `<p><strong>${escapeHtml(label)}:</strong> ${display}</p>`;
}

function exceptionDrawerHtml(row, hideRowId) {
  const et = String(row.exception_type || '').trim();
  const typeChip = dsStatusChip(hebrewExceptionType(et), 'neutral');

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
        instructor  ? (row.emp_id  ? `${instructor} (${row.emp_id})`  : instructor)  : '')}
    ${instructor2 ? fieldRow('מדריך 2',
        row.emp_id_2 ? `${instructor2} (${row.emp_id_2})` : instructor2) : ''}
    ${fieldRow(hebrewColumn('start_date'),  startDate)}
    ${fieldRow(hebrewColumn('end_date'),    endDate)}
    ${fieldRow(hebrewColumn('sessions'),    row.sessions)}
    ${fieldRow(hebrewColumn('status'),      row.status)}
    ${row.notes ? fieldRow('הערות', row.notes) : ''}
  </div>`;
}

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data, { state } = {}) {
    const allRows   = Array.isArray(data?.rows) ? data.rows : [];
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;

    const compact =
      allRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${allRows
            .map((row, idx) => {
              const et = String(row.exception_type || '').trim();
              const subtitleParts = [row.authority, row.school].filter(Boolean);
              const subtitleHtml  = subtitleParts.length
                ? `<p class="ds-interactive-card__subtitle">${escapeHtml(subtitleParts.join(' · '))}</p>`
                : '';
              const chipHtml = `<p class="ds-interactive-card__meta">${dsStatusChip(hebrewExceptionType(et), 'neutral')}</p>`;

              return `<div data-list-item>
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
      ${dsCard({
        title: `חריגות · ${allRows.length}`,
        body: compact,
        padded: allRows.length === 0
      })}
    `);
  },
  bind({ root, data, ui, state, rerender }) {
    bindActNavGrid(root, { state, rerender });
    const allRows   = Array.isArray(data?.rows) ? data.rows : [];
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;

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

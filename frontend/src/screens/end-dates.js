import { escapeHtml } from './shared/html.js';
import { hebrewColumn, visibleActivityCategoryLabel } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

const COLS = ['RowID', 'activity_name', 'activity_type', 'activity_manager', 'authority', 'school', 'start_date', 'end_date', 'status'];

export const endDatesScreen = {
  load: ({ api }) => api.endDates(),
  render(data, { state } = {}) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const cols = hideRowId
      ? ['activity_name', 'activity_type', 'activity_manager', 'authority', 'school', 'start_date', 'end_date', 'status']
      : COLS;

    const typeFilters = [...new Set(rows.map((r) => String(r.activity_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: visibleActivityCategoryLabel(t)
    }));

    const body = rows.map((row) => {
      const rawType = String(row.activity_type || '').trim();
      const searchHay = cols.map((c) => {
        let v = row?.[c] ?? '';
        if (c === 'activity_type') v = visibleActivityCategoryLabel(v);
        return String(v || '');
      }).join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}">${cols.map((c) => {
        let v = row?.[c] ?? '';
        if (c === 'activity_type') v = visibleActivityCategoryLabel(v);
        return `<td>${escapeHtml(String(v || '—'))}</td>`;
      }).join('')}</tr>
    `;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות עם תאריך סיום')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr>${cols.map((c) => `<th>${escapeHtml(hebrewColumn(c))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות עם תאריך סיום')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const rawType = String(row.activity_type || '').trim();
              const searchHay = [row.RowID, row.activity_name, row.end_date, visibleActivityCategoryLabel(row.activity_type)]
                .filter(Boolean)
                .join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(rawType)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `noop:${row.RowID}`,
                title: hideRowId ? `${row.activity_name || '—'}` : `${row.RowID} · ${row.activity_name || '—'}`,
                subtitle: `סיום: ${row.end_date || '—'}`,
                meta: visibleActivityCategoryLabel(row.activity_type)
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('תאריכי סיום', 'תוכניות לפי תאריך סיום')}
      <div class="ds-screen-shortcuts" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-back-activities>חזור</button>
      </div>
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש ברשימה…', filterLabel: 'סוג פעילות', filters: typeFilters }) : ''}
      ${dsCard({
        title: 'רשימת סיומים',
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, state, rerender }) {
    bindPageListTools(root);
    root.querySelector('[data-back-activities]')?.addEventListener('click', () => {
      state.route = 'activities';
      rerender?.();
    });
  }
};

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

const COLS = ['RowID', 'activity_name', 'activity_type', 'activity_manager', 'authority', 'school', 'start_date', 'end_date', 'status'];

export const endDatesScreen = {
  load: ({ api }) => api.endDates(),
  render(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const body = rows.map(
      (row) => `
      <tr class="ds-data-row">${COLS.map((c) => {
        let v = row?.[c] ?? '';
        if (c === 'activity_type') v = visibleActivityCategoryLabel(v);
        return `<td>${escapeHtml(String(v || '—'))}</td>`;
      }).join('')}</tr>
    `
    );

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות עם תאריך סיום')
        : dsTableWrap(`<table class="ds-table">
            <thead><tr>${COLS.map((c) => `<th>${escapeHtml(hebrewColumn(c))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות עם תאריך סיום')
        : `<div class="ds-compact-list">${rows
            .map((row) =>
              dsInteractiveCard({
                variant: 'session',
                action: `noop:${row.RowID}`,
                title: `${row.RowID} · ${row.activity_name || '—'}`,
                subtitle: `סיום: ${row.end_date || '—'}`,
                meta: visibleActivityCategoryLabel(row.activity_type)
              })
            )
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('תאריכי סיום', 'פעילויות ארוכות לפי תאריך סיום')}
      ${dsCard({
        title: 'רשימת סיומים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind() {}
};

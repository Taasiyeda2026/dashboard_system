import { escapeHtml } from './shared/html.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsFilterBar,
  dsInteractiveCard
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';

function exceptionDrawerHtml(row) {
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>
      <p><strong>${escapeHtml(hebrewColumn('exception_type'))}:</strong> ${escapeHtml(hebrewExceptionType(row.exception_type))}</p>
      <p><strong>${escapeHtml(hebrewColumn('activity_name'))}:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>${escapeHtml(hebrewColumn('end_date'))}:</strong> ${escapeHtml(row.end_date || '—')}</p>
    </div>`;
}

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const narrow = isNarrowViewport();

    const rows = safeRows.map(
      (row, idx) => `
      <tr class="ds-data-row" data-exc-idx="${idx}" role="button" tabindex="0"><td>${escapeHtml(row.RowID)}</td><td>${escapeHtml(hebrewExceptionType(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>`
    );

    const summaryChips = `
      <span class="ds-chip ds-chip--warn">חסר מדריך: ${counts.missing_instructor}</span>
      <span class="ds-chip ds-chip--warn">חסר תאריך התחלה: ${counts.missing_start_date}</span>
      <span class="ds-chip ds-chip--danger">תאריך סיום מאוחר: ${counts.late_end_date}</span>
    `;

    const tableBlock =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr><th>${escapeHtml(hebrewColumn('RowID'))}</th><th>${escapeHtml(hebrewColumn('exception_type'))}</th><th>${escapeHtml(hebrewColumn('activity_name'))}</th><th>${escapeHtml(hebrewColumn('end_date'))}</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>`);

    const compact =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${safeRows
            .map((row, idx) =>
              dsInteractiveCard({
                variant: 'session',
                action: `exception:${idx}`,
                title: `${hebrewExceptionType(row.exception_type)}`,
                subtitle: row.activity_name || '—',
                meta: `RowID ${row.RowID} · סיום ${row.end_date || '—'}`
              })
            )
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('חריגות', 'נתונים הדורשים טיפול')}
      ${dsFilterBar(summaryChips)}
      ${dsCard({
        title: 'רשימת חריגות',
        badge: `${safeRows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: safeRows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui }) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];

    const openAt = (idx) => {
      const hit = safeRows[idx];
      if (!hit || !ui) return;
      ui.openDrawer({
        title: `חריגה · ${hit.RowID}`,
        content: exceptionDrawerHtml(hit)
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

import { escapeHtml } from './shared/html.js';
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
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

function exceptionDrawerHtml(row) {
  const typeLabel = hebrewExceptionType(row.exception_type);
  const typeChip = dsStatusChip(typeLabel, exceptionTypeVariant(row.exception_type));
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>
      <p><strong>${escapeHtml(hebrewColumn('exception_type'))}:</strong> ${typeChip}</p>
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

    const excFilters = [...new Set(safeRows.map((r) => String(r.exception_type || '').trim()).filter(Boolean))].map((t) => ({
      value: t,
      label: hebrewExceptionType(t)
    }));

    const rows = safeRows.map((row, idx) => {
      const et = String(row.exception_type || '').trim();
      const searchHay = [row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.end_date].join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}" data-exc-idx="${idx}" role="button" tabindex="0"><td>${escapeHtml(row.RowID)}</td><td>${dsStatusChip(hebrewExceptionType(row.exception_type), exceptionTypeVariant(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>`;
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
            <thead><tr><th>${escapeHtml(hebrewColumn('RowID'))}</th><th>${escapeHtml(hebrewColumn('exception_type'))}</th><th>${escapeHtml(hebrewColumn('activity_name'))}</th><th>${escapeHtml(hebrewColumn('end_date'))}</th></tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>`);

    const compact =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${safeRows
            .map((row, idx) => {
              const et = String(row.exception_type || '').trim();
              const searchHay = [row.RowID, hebrewExceptionType(row.exception_type), row.activity_name, row.end_date].join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(et)}">
              ${dsInteractiveCard({
                variant: 'session',
                action: `exception:${idx}`,
                title: `${hebrewExceptionType(row.exception_type)}`,
                subtitle: row.activity_name || '—',
                meta: `RowID ${row.RowID} · סיום ${row.end_date || '—'}`
              })}
            </div>`;
            })
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('חריגות', 'נתונים הדורשים טיפול')}
      ${dsFilterBar(summaryChips)}
      ${safeRows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש בחריגות…', filterLabel: 'סוג חריגה', filters: excFilters }) : ''}
      ${dsCard({
        title: 'רשימת חריגות',
        badge: `${safeRows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: safeRows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui }) {
    bindPageListTools(root);
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

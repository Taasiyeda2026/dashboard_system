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

    const rows = safeRows.map(
      (row, idx) => `
      <tr class="ds-data-row" data-exc-idx="${idx}" role="button" tabindex="0"><td>${escapeHtml(row.RowID)}</td><td>${dsStatusChip(hebrewExceptionType(row.exception_type), exceptionTypeVariant(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>`
    );

    const summaryChips = `
      <span class="ds-chip ds-chip--status ds-chip--status-warning">חסר מדריך: ${counts.missing_instructor}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-warning">חסר תאריך התחלה: ${counts.missing_start_date}</span>
      <span class="ds-chip ds-chip--status ds-chip--status-danger">תאריך סיום מאוחר: ${counts.late_end_date}</span>
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
        badge: `${safeRows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: safeRows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, state, rerender }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];

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

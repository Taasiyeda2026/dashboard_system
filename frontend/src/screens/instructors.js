import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard,
  dsStatusChip
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { isNarrowViewport } from './shared/responsive.js';

function cellDisplay(column, value) {
  if (column === 'active') {
    const v = String(value || '').toLowerCase();
    if (v === 'yes') return 'כן';
    if (v === 'no') return 'לא';
  }
  if (column === 'employment_type') return hebrewEmploymentType(value);
  return value ?? '';
}

function instructorDrawerHtml(row, columns) {
  const lines = columns
    .map((col) => {
      const raw = row?.[col] ?? '';
      if (col === 'active') {
        const label = cellDisplay(col, raw);
        const kind = String(raw || '').toLowerCase() === 'yes' ? 'success' : 'neutral';
        return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
      }
      const val = cellDisplay(col, raw);
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val || '—'))}</p>`;
    })
    .join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data, { state } = {}) {
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'employment_type', 'direct_manager', 'active'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const body = rows.map((row) => {
      const searchHay = columns.map((column) => String(cellDisplay(column, row?.[column]) ?? '')).join(' ');
      return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="" data-row-id="${escapeHtml(
        row.emp_id
      )}" role="button" tabindex="0">${columns
        .map((column) => {
          const raw = row?.[column];
          if (column === 'active') {
            const label = cellDisplay(column, raw);
            const kind = String(raw || '').toLowerCase() === 'yes' ? 'success' : 'neutral';
            return `<td>${dsStatusChip(label, kind)}</td>`;
          }
          return `<td>${escapeHtml(cellDisplay(column, raw))}</td>`;
        })
        .join('')}</tr>`;
    });

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row) => {
              const searchHay = [row.emp_id, row.full_name, row.mobile, row.email, row.employment_type]
                .filter(Boolean)
                .join(' ');
              return `<div data-list-item data-search="${escapeHtml(searchHay)}" data-filter="">
              ${dsInteractiveCard({
                variant: 'session',
                action: `instructor:${encodeURIComponent(row.emp_id)}`,
                title: `${row.emp_id} · ${row.full_name || '—'}`,
                subtitle: cellDisplay('employment_type', row.employment_type),
                meta: row.mobile || row.email || ''
              })}
            </div>`;
            })
            .join('')}</div>`;

    const instructorContactsShortcut =
      Array.isArray(state?.routes) && state.routes.includes('instructor-contacts')
        ? `<p class="ds-page-shortcuts"><button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-goto-route="instructor-contacts"><span aria-hidden="true">📇</span> אנשי קשר מדריכים</button></p>`
        : '';

    return dsScreenStack(`
      ${dsPageHeader('מדריכים', 'פרטי העסקה וקשר')}
      ${instructorContactsShortcut}
      ${rows.length ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש במדריכים…', filters: [] }) : ''}
      ${dsCard({
        title: 'רשימת מדריכים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui, state, rerender }) {
    bindPageListTools(root);
    root.querySelector('[data-goto-route="instructor-contacts"]')?.addEventListener('click', () => {
      state.route = 'instructor-contacts';
      rerender?.();
    });
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'employment_type', 'direct_manager', 'active'];

    const openInstructor = (empId) => {
      const hit = rows.find((r) => String(r.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: `${hit.full_name || hit.emp_id}`,
        content: instructorDrawerHtml(hit, columns)
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => openInstructor(rowNode.dataset.rowId));
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('instructor:')) return;
      const empId = decodeURIComponent(action.slice('instructor:'.length));
      openInstructor(empId);
    });
  }
};

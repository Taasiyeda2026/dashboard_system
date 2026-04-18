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

function instructorContactDrawerHtml(row, columns) {
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

/** אנשי קשר של מדריכים — לפי גיליון contacts_instructors במקור הנתונים (צפייה בלבד). */
export const instructorContactsScreen = {
  load: ({ api }) => api.instructorContacts(),
  render(data) {
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const body = rows.map(
      (row) => `
      <tr class="ds-data-row" data-row-id="${escapeHtml(row.emp_id)}" role="button" tabindex="0">${columns
        .map((column) => {
          const raw = row?.[column];
          if (column === 'active') {
            const label = cellDisplay(column, raw);
            const kind = String(raw || '').toLowerCase() === 'yes' ? 'success' : 'neutral';
            return `<td>${dsStatusChip(label, kind)}</td>`;
          }
          return `<td>${escapeHtml(cellDisplay(column, raw))}</td>`;
        })
        .join('')}</tr>`
    );

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
            .map((row) =>
              dsInteractiveCard({
                variant: 'session',
                action: `icontact:${encodeURIComponent(row.emp_id)}`,
                title: `${row.emp_id} · ${row.full_name || '—'}`,
                subtitle: cellDisplay('employment_type', row.employment_type),
                meta: row.mobile || row.email || ''
              })
            )
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר מדריכים', 'נתונים מגיליון contacts_instructors')}
      ${dsCard({
        title: 'מדריכים',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui }) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];

    const openRow = (empId) => {
      const hit = rows.find((r) => String(r.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: `מדריך/ה · ${hit.full_name || hit.emp_id}`,
        content: instructorContactDrawerHtml(hit, columns)
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => openRow(rowNode.dataset.rowId));
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openRow(rowNode.dataset.rowId);
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('icontact:')) return;
      const id = decodeURIComponent(action.slice('icontact:'.length));
      openRow(id);
    });
  }
};

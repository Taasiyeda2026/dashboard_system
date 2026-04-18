import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewContactKind } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { isNarrowViewport } from './shared/responsive.js';

const CONTACT_COLUMNS = ['kind', 'emp_id', 'full_name', 'authority', 'school', 'contact_name', 'phone', 'mobile', 'email'];

function cellVal(row, column) {
  let val = row?.[column] ?? '';
  if (column === 'kind') val = hebrewContactKind(val);
  return val;
}

function contactDrawerHtml(row) {
  const lines = CONTACT_COLUMNS.map((col) => {
    const val = cellVal(row, col);
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val || '—'))}</p>`;
  }).join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const narrow = isNarrowViewport();

    const body = rows.map(
      (row, idx) => `
      <tr class="ds-data-row" data-contact-idx="${idx}" role="button" tabindex="0">${CONTACT_COLUMNS.map((column) => {
        const val = cellVal(row, column);
        return `<td>${escapeHtml(val)}</td>`;
      }).join('')}</tr>`
    );

    const tableBlock =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
            <thead><tr>${CONTACT_COLUMNS.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
            <tbody>${body.join('')}</tbody>
          </table>`);

    const compact =
      rows.length === 0
        ? dsEmptyState('לא נמצאו רשומות')
        : `<div class="ds-compact-list">${rows
            .map((row, idx) =>
              dsInteractiveCard({
                variant: 'session',
                action: `contact:${idx}`,
                title: `${cellVal(row, 'kind')} · ${row.full_name || '—'}`,
                subtitle: row.school || row.authority || '',
                meta: row.phone || row.mobile || row.email || ''
              })
            )
            .join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר', 'גורמים ורשתות')}
      ${dsCard({
        title: 'רשימת אנשי קשר',
        badge: `${rows.length} שורות`,
        body: narrow ? compact : tableBlock,
        padded: rows.length === 0 || narrow
      })}
    `);
  },
  bind({ root, data, ui }) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const openAt = (idx) => {
      const hit = rows[idx];
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.full_name || hebrewContactKind(hit.kind) || 'איש קשר',
        content: contactDrawerHtml(hit)
      });
    };

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.addEventListener('click', () => openAt(Number(rowNode.dataset.contactIdx)));
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('contact:')) return;
      const idx = Number(action.slice('contact:'.length));
      openAt(idx);
    });
  }
};

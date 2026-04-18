import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsCard, dsInteractiveCard } from './shared/layout.js';

export const monthScreen = {
  load: ({ api }) => api.month(),
  render(data) {
    const safeCells = Array.isArray(data?.cells) ? data.cells : [];
    const cards = safeCells
      .map((cell) => {
        const n = Array.isArray(cell.items) ? cell.items.length : 0;
        return dsInteractiveCard({
          variant: 'day-cell',
          action: `monthcell|${cell.day}`,
          title: String(cell.day),
          subtitle: `${n} פריטים`
        });
      })
      .join('');

    const monthLabel = data?.month ? `חודש ${escapeHtml(data.month)}` : 'חודש';
    const gridBody =
      safeCells.length === 0
        ? '<div class="ds-empty"><p class="ds-empty__msg">אין נתוני חודש זמינים</p></div>'
        : `<div class="ds-table-wrap"><div class="ds-month-grid">${cards}</div></div>`;

    return dsScreenStack(`
      ${dsPageHeader('חודש', 'מספר פריטים לפי יום')}
      ${dsCard({
        title: monthLabel,
        badge: `${safeCells.length} ימים`,
        body: gridBody,
        padded: true
      })}
    `);
  },
  bind({ root, ui, data }) {
    ui.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('monthcell|')) return;
      const parts = action.split('|');
      const dayNum = parts[1];
      const cells = Array.isArray(data?.cells) ? data.cells : [];
      const cell = cells.find((c) => String(c.day) === String(dayNum));
      const n = cell && Array.isArray(cell.items) ? cell.items.length : 0;
      const lines =
        cell && Array.isArray(cell.items) && cell.items.length
          ? cell.items
              .map(
                (it) =>
                  `<li>${escapeHtml(it.RowID || '')} — ${escapeHtml(it.activity_name || 'ללא שם')}</li>`
              )
              .join('')
          : '<li>אין פריטים ביום זה</li>';
      ui.openDrawer({
        title: `יום ${dayNum}`,
        content: `<p class="ds-muted">סה״כ ${n} פריטים</p><ul class="ds-drawer-list">${lines}</ul>`
      });
    });
  }
};

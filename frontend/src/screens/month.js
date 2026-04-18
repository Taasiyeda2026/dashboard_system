import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsScreenStack, dsCard } from './shared/layout.js';

export const monthScreen = {
  load: ({ api }) => api.month(),
  render(data) {
    const safeCells = Array.isArray(data?.cells) ? data.cells : [];
    const cards = safeCells
      .map(
        (cell) => `
      <article class="ds-month-cell">
        <h4>${escapeHtml(cell.day)}</h4>
        <p>${Array.isArray(cell.items) ? cell.items.length : 0}</p>
      </article>`
      )
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
        body: `<div class="ds-month-grid">${gridBody}</div>`,
        padded: true
      })}
    `);
  }
};

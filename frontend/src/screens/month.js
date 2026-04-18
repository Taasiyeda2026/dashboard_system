import { escapeHtml } from './shared/html.js';

export const monthScreen = {
  load: ({ api }) => api.month(),
  render(data) {
    const safeCells = Array.isArray(data?.cells) ? data.cells : [];
    const cards = safeCells.map((cell) => `
      <article class="mini-card">
        <h4>${escapeHtml(cell.day)}</h4>
        <p>${Array.isArray(cell.items) ? cell.items.length : 0}</p>
      </article>
    `).join('');

    const monthLabel = data?.month ? `חודש ${escapeHtml(data.month)}` : 'חודש';

    return `
      <section class="panel">
        <h2>${monthLabel}</h2>
        <div class="month-grid">${cards || '<article class="mini-card"><p>אין נתוני חודש זמינים</p></article>'}</div>
      </section>
    `;
  }
};

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

    return `
      <section class="panel">
        <h2>Month ${escapeHtml(data?.month || '')}</h2>
        <div class="month-grid">${cards || '<article class="mini-card"><p>No month data available.</p></article>'}</div>
      </section>
    `;
  }
};

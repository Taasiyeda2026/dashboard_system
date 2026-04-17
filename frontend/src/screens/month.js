export function monthScreen(data) {
  const safeCells = Array.isArray(data?.cells) ? data.cells : [];
  const cells = safeCells.map((cell) => `
    <article class="card month-cell">
      <header>${cell.day}</header>
      <ul>${(Array.isArray(cell.items) ? cell.items : []).slice(0, 3).map((i) => `<li>${i.RowID}</li>`).join('')}${(Array.isArray(cell.items) ? cell.items : []).length > 3 ? `<li>+${cell.items.length - 3} more</li>` : ''}</ul>
    </article>
  `).join('');

export const monthScreen = {
  load: ({ api }) => api.month(),
  render(data) {
    return `<section class="panel"><h2>Month ${escapeHtml(data.month || '')}</h2><div class="month-grid">${(data.cells || []).map((cell) => `<article class="mini-card"><h4>${cell.day}</h4><p>${cell.items.length}</p></article>`).join('')}</div></section>`;
  }
};

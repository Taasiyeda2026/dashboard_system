export function monthScreen(data) {
  const safeCells = Array.isArray(data?.cells) ? data.cells : [];
  const cells = safeCells.map((cell) => `
    <article class="card month-cell">
      <header>${cell.day}</header>
      <ul>${(Array.isArray(cell.items) ? cell.items : []).slice(0, 3).map((i) => `<li>${i.row_id}</li>`).join('')}${(Array.isArray(cell.items) ? cell.items : []).length > 3 ? `<li>+${cell.items.length - 3} more</li>` : ''}</ul>
    </article>
  `).join('');

  return `<section class="stack"><h2>Month</h2><div class="month-grid">${cells || '<article class="card">No month data available.</article>'}</div></section>`;
}

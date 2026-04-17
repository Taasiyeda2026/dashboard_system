export function weekScreen(data) {
  const days = data.days.map((d) => `
    <article class="card day-col">
      <h3>${d.date}</h3>
      <ul>${d.items.map((item) => `<li>${item.row_id} • ${item.title || 'Untitled'}</li>`).join('') || '<li>None</li>'}</ul>
    </article>
  `).join('');

  return `<section class="stack"><h2>Week</h2><div class="week-grid">${days}</div></section>`;
}

export function monthScreen(data) {
  const cells = data.cells.map((cell) => `
    <article class="card month-cell">
      <header>${cell.day}</header>
      <ul>${cell.items.slice(0, 3).map((i) => `<li>${i.row_id}</li>`).join('')}${cell.items.length > 3 ? `<li>+${cell.items.length - 3} more</li>` : ''}</ul>
    </article>
  `).join('');

  return `<section class="stack"><h2>Month</h2><div class="month-grid">${cells}</div></section>`;
}

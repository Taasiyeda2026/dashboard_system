export function weekScreen(data) {
  const days = data.days.map((d) => `
    <article class="card day-col">
      <h3>${d.date}</h3>
      <ul>${d.items.map((item) => `<li>${item.row_id} • ${item.title || 'Untitled'}</li>`).join('') || '<li>None</li>'}</ul>
    </article>
  `).join('');

  return `<section class="stack"><h2>Week</h2><div class="week-grid">${days}</div></section>`;
}

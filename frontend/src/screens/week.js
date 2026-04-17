export function weekScreen(data) {
  const safeDays = Array.isArray(data?.days) ? data.days : [];
  const days = safeDays.map((d) => `
    <article class="card day-col">
      <h3>${d.date}</h3>
      <ul>${(Array.isArray(d.items) ? d.items : []).map((item) => `<li>${item.RowID} • ${item.activity_name || 'Untitled'}</li>`).join('') || '<li>None</li>'}</ul>
    </article>
  `).join('');

  return `<section class="stack"><h2>Week</h2><div class="week-grid">${days || '<article class="card">No week data available.</article>'}</div></section>`;
}

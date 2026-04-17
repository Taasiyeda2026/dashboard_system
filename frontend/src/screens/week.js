import { escapeHtml } from './shared/html.js';

export const weekScreen = {
  load: ({ api }) => api.week(),
  render(data) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const days = safeDays.map((d) => `
      <article class="card day-col">
        <h3>${escapeHtml(d.date)}</h3>
        <ul>${(Array.isArray(d.items) ? d.items : []).map((item) => `<li>${escapeHtml(item.RowID)} • ${escapeHtml(item.activity_name || 'Untitled')}</li>`).join('') || '<li>None</li>'}</ul>
      </article>
    `).join('');

    return `<section class="stack"><h2>Week</h2><div class="week-grid">${days || '<article class="card">No week data available.</article>'}</div></section>`;
  }
};

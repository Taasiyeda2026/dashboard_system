import { escapeHtml } from './shared/html.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managerCards = (data.by_activity_manager || []).map((row) => `
      <article class="mini-card">
        <h4>👤 ${escapeHtml(row.activity_manager)}</h4>
        <div class="count-chips">
          <span class="chip-mini">S: ${row.total_short}</span>
          <span class="chip-mini">L: ${row.total_long}</span>
          <span class="chip-mini">Σ: ${row.total}</span>
        </div>
      </article>
    `).join('');
    return `
      <section class="grid cards">
        <article class="panel card"><h3>📘 Short</h3><p>${totals.total_short_activities || 0}</p></article>
        <article class="panel card"><h3>📗 Long</h3><p>${totals.total_long_activities || 0}</p></article>
        <article class="panel card"><h3>🧑‍🏫 Inst.</h3><p>${totals.total_instructors || 0}</p></article>
        <article class="panel card"><h3>⏳ Endings</h3><p>${totals.total_course_endings_current_month || 0}</p></article>
      </section>
      <details class="compact-block" open>
        <summary>📊 Totals by Activity Manager</summary>
        <div class="compact-body mini-grid">${managerCards || '<p>No data</p>'}</div>
      </details>
    `;
  }
};

import { escapeHtml } from './shared/html.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managerCards = (data.by_activity_manager || []).map((row) => `<article class="mini-card"><h4>${escapeHtml(row.activity_manager)}</h4><p>Short: ${row.total_short}</p><p>Long: ${row.total_long}</p><p>Total: ${row.total}</p></article>`).join('');
    return `
      <section class="grid cards">
        <article class="panel card"><h3>Total Short Activities</h3><p>${totals.total_short_activities || 0}</p></article>
        <article class="panel card"><h3>Total Long Activities</h3><p>${totals.total_long_activities || 0}</p></article>
        <article class="panel card"><h3>Total Instructors</h3><p>${totals.total_instructors || 0}</p></article>
        <article class="panel card"><h3>Course Endings (Current Month)</h3><p>${totals.total_course_endings_current_month || 0}</p></article>
      </section>
      <section class="panel"><h3>Totals by Activity Manager</h3><div class="mini-grid">${managerCards || '<p>No data</p>'}</div></section>
    `;
  }
};

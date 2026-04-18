import { escapeHtml } from './shared/html.js';

export const dashboardScreen = {
  load: ({ api }) => api.dashboard(),
  render(data) {
    const totals = data.totals || {};
    const managerCards = (data.by_activity_manager || []).map((row) => `
      <article class="mini-card">
        <h4>👤 ${escapeHtml(row.activity_manager)}</h4>
        <div class="count-chips">
          <span class="chip-mini">קצר: ${row.total_short}</span>
          <span class="chip-mini">ארוך: ${row.total_long}</span>
          <span class="chip-mini">סה״כ: ${row.total}</span>
        </div>
      </article>
    `).join('');
    return `
      <section class="grid cards">
        <article class="panel card"><h3>📘 פעילויות קצרות</h3><p>${totals.total_short_activities || 0}</p></article>
        <article class="panel card"><h3>📗 פעילויות ארוכות</h3><p>${totals.total_long_activities || 0}</p></article>
        <article class="panel card"><h3>🧑‍🏫 מדריכים</h3><p>${totals.total_instructors || 0}</p></article>
        <article class="panel card"><h3>⏳ מסיימים החודש</h3><p>${totals.total_course_endings_current_month || 0}</p></article>
      </section>
      <details class="compact-block" open>
        <summary>📊 סיכומים לפי אחראי/ת פעילות</summary>
        <div class="compact-body mini-grid">${managerCards || '<p>אין נתונים להצגה</p>'}</div>
      </details>
    `;
  }
};

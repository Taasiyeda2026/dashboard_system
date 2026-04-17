import { api } from '../api/client.js';

export async function renderDashboard() {
  const root = document.createElement('div');
  root.className = 'screen';
  root.innerHTML = '<div class="card">טוען Dashboard...</div>';

  try {
    const result = await api.getDashboard();
    const d = result.dashboard || {};
    const managers = d.by_manager || [];

    root.innerHTML = `
      <section class="stats-grid">
        <article class="card"><h3>סה"כ פעילויות קצרות</h3><div class="value">${d.total_short || 0}</div></article>
        <article class="card"><h3>סה"כ פעילויות ארוכות</h3><div class="value">${d.total_long || 0}</div></article>
        <article class="card"><h3>סה"כ מדריכים</h3><div class="value">${d.total_instructors || 0}</div></article>
        <article class="card"><h3>סיומי קורסים החודש</h3><div class="value">${d.total_course_endings_this_month || 0}</div></article>
      </section>
      <section class="card">
        <h2>סיכום לפי מנהל פעילות</h2>
        <div class="manager-list">
          ${managers.map((m) => `<div>${m.manager}: קצר ${m.total_short}, ארוך ${m.total_long}</div>`).join('') || '<div>אין נתונים</div>'}
        </div>
      </section>
    `;
  } catch (err) {
    root.innerHTML = `<div class="card error">${err.message}</div>`;
  }

  return root;
}

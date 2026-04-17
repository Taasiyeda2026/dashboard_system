import { api } from '../api/client.js';

const tabs = ['all', 'course', 'after_school', 'workshop', 'tour', 'escape_room'];

export async function renderActivities(filters, onFiltersChange) {
  const root = document.createElement('div');
  root.className = 'screen';

  root.innerHTML = `
    <section class="card filters">
      <div class="tab-row" id="tab-row"></div>
      <div class="filter-grid">
        <input data-filter="authority" placeholder="רשות" value="${filters.authority || ''}" />
        <input data-filter="school" placeholder="בית ספר" value="${filters.school || ''}" />
        <input data-filter="instructor_name" placeholder="מדריך" value="${filters.instructor_name || ''}" />
        <input data-filter="activity_manager" placeholder="מנהל פעילות" value="${filters.activity_manager || ''}" />
        <input data-filter="status" placeholder="סטטוס" value="${filters.status || ''}" />
      </div>
      <button id="apply-filters">עדכן מסננים</button>
    </section>
    <section class="card" id="activities-list">טוען פעילויות...</section>
  `;

  const tabRow = root.querySelector('#tab-row');
  tabRow.innerHTML = tabs
    .map((tab) => `<button class="tab-btn ${filters.activity_type === tab ? 'active' : ''}" data-tab="${tab}">${tab}</button>`)
    .join('');

  tabRow.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-tab]');
    if (!btn) return;
    onFiltersChange({ ...filters, activity_type: btn.dataset.tab });
  });

  root.querySelector('#apply-filters').addEventListener('click', () => {
    const next = { ...filters };
    root.querySelectorAll('[data-filter]').forEach((input) => {
      next[input.dataset.filter] = input.value.trim();
    });
    onFiltersChange(next);
  });

  const requestFilters = { ...filters };
  if (requestFilters.activity_type === 'all') requestFilters.activity_type = '';

  try {
    const result = await api.getActivities(requestFilters);
    const activities = result.activities || [];

    root.querySelector('#activities-list').innerHTML = activities.length
      ? `<ul class="list">${activities.map((row) => `<li>${row.RowID} · ${row.activity_name || '-'} · ${row.activity_type || '-'}</li>`).join('')}</ul>`
      : 'אין פעילויות לתצוגה';
  } catch (err) {
    root.querySelector('#activities-list').textContent = err.message;
  }

  return root;
}

import { escapeHtml } from './shared/html.js';
import { hebrewColumn } from './shared/ui-hebrew.js';

function cellDisplay(column, value) {
  if (column === 'active') {
    const v = String(value || '').toLowerCase();
    if (v === 'yes') return 'כן';
    if (v === 'no') return 'לא';
  }
  return value ?? '';
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data) {
    const columns = ['emp_id', 'full_name', 'mobile', 'email', 'employment_type', 'direct_manager', 'active'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => `<td>${escapeHtml(cellDisplay(column, row?.[column]))}</td>`).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>🧑‍🏫 מדריכים</h2>
        <details class="compact-block" open>
          <summary>רשימה (${rows.length} שורות)</summary>
          <div class="compact-body overflow-x">
            <table>
              <thead><tr>${columns.map((column) => `<th>${escapeHtml(hebrewColumn(column))}</th>`).join('')}</tr></thead>
              <tbody>${body || `<tr><td colspan="${columns.length}">לא נמצאו רשומות</td></tr>`}</tbody>
            </table>
          </div>
        </details>
      </section>
    `;
  }
};

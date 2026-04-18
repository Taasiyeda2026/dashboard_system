import { escapeHtml } from './shared/html.js';
import { hebrewColumn } from './shared/ui-hebrew.js';

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data) {
    const columns = ['kind', 'emp_id', 'full_name', 'authority', 'school', 'contact_name', 'phone', 'mobile', 'email'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? '')}</td>`).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>📇 אנשי קשר</h2>
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

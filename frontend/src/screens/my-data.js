import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewActivityType } from './shared/ui-hebrew.js';

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => {
        let val = row?.[column] ?? '';
        if (column === 'activity_type') val = hebrewActivityType(val);
        return `<td>${escapeHtml(val)}</td>`;
      }).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>🙋 הנתונים שלי</h2>
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

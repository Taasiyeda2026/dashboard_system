import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewFinanceStatus } from './shared/ui-hebrew.js';

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'finance_status', 'status'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => {
        let val = row?.[column] ?? '';
        if (column === 'finance_status') val = hebrewFinanceStatus(val);
        return `<td>${escapeHtml(val)}</td>`;
      }).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>💰 כספים</h2>
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

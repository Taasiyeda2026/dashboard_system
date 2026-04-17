import { escapeHtml } from './shared/html.js';

export const myDataScreen = {
  load: ({ api }) => api.myData(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'start_date', 'end_date', 'activity_type'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? '')}</td>`).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>🙋 My Data</h2>
        <details class="compact-block" open>
          <summary>📋 Rows (${rows.length})</summary>
          <div class="compact-body overflow-x">
            <table>
              <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
              <tbody>${body || `<tr><td colspan="${columns.length}">No records found.</td></tr>`}</tbody>
            </table>
          </div>
        </details>
      </section>
    `;
  }
};

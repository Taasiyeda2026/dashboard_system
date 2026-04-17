import { escapeHtml } from './shared/html.js';

export const financeScreen = {
  load: ({ api }) => api.finance(),
  render(data) {
    const columns = ['RowID', 'activity_name', 'finance_status', 'status'];
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const body = rows.map((row) => `
      <tr>${columns.map((column) => `<td>${escapeHtml(row?.[column] ?? '')}</td>`).join('')}</tr>
    `).join('');

    return `
      <section class="stack">
        <h2>Finance</h2>
        <article class="card overflow-x">
          <table>
            <thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
            <tbody>${body || `<tr><td colspan="${columns.length}">No records found.</td></tr>`}</tbody>
          </table>
        </article>
      </section>
    `;
  }
};

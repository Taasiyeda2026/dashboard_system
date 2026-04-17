import { escapeHtml } from './shared/html.js';

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const rows = safeRows.map((row) => `
      <tr><td>${escapeHtml(row.RowID)}</td><td>${escapeHtml(row.exception_type)}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>
    `).join('');

    return `
      <section class="stack">
        <h2>⚠️ Exceptions</h2>
        <div class="count-chips">
          <span class="chip-mini">👤 חסר מדריך: ${counts.missing_instructor}</span>
          <span class="chip-mini">📅 חסר תאריך: ${counts.missing_start_date}</span>
          <span class="chip-mini">⏰ תאריך מאוחר: ${counts.late_end_date}</span>
        </div>
        <details class="compact-block" open>
          <summary>📋 Rows (${safeRows.length})</summary>
          <div class="compact-body overflow-x">
            <table>
              <thead><tr><th>RowID</th><th>Exception</th><th>Activity</th><th>End Date</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4">No exceptions found.</td></tr>'}</tbody>
            </table>
          </div>
        </details>
      </section>
    `;
  }
};

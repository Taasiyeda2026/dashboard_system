import { escapeHtml } from './shared/html.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';

export const exceptionsScreen = {
  load: ({ api }) => api.exceptions(),
  render(data) {
    const safeRows = Array.isArray(data?.rows) ? data.rows : [];
    const counts = data?.counts || { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
    const rows = safeRows.map((row) => `
      <tr><td>${escapeHtml(row.RowID)}</td><td>${escapeHtml(hebrewExceptionType(row.exception_type))}</td><td>${escapeHtml(row.activity_name || '—')}</td><td>${escapeHtml(row.end_date || '—')}</td></tr>
    `).join('');

    return `
      <section class="stack">
        <h2>⚠️ חריגות</h2>
        <div class="count-chips">
          <span class="chip-mini">👤 חסר מדריך: ${counts.missing_instructor}</span>
          <span class="chip-mini">📅 חסר תאריך: ${counts.missing_start_date}</span>
          <span class="chip-mini">⏰ תאריך מאוחר: ${counts.late_end_date}</span>
        </div>
        <details class="compact-block" open>
          <summary>רשימה (${safeRows.length} שורות)</summary>
          <div class="compact-body overflow-x">
            <table>
              <thead><tr><th>${hebrewColumn('RowID')}</th><th>${hebrewColumn('exception_type')}</th><th>${hebrewColumn('activity_name')}</th><th>${hebrewColumn('end_date')}</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4">לא נמצאו חריגות</td></tr>'}</tbody>
            </table>
          </div>
        </details>
      </section>
    `;
  }
};

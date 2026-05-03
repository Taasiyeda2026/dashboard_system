import { escapeHtml } from './shared/html.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';

export const adminSettingsScreen = {
  load: ({ api }) => api.adminSettings(),
  render(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];

    const rowsHtml = rows.length === 0
      ? dsEmptyState('אין הגדרות מערכת')
      : `
        <div class="ds-table-wrap">
          <table class="ds-table">
            <thead>
              <tr>
                <th>מפתח</th>
                <th>ערך</th>
                <th>תיאור</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r) => `
                <tr>
                  <td><code>${escapeHtml(r.key)}</code></td>
                  <td>${escapeHtml(r.value || '—')}</td>
                  <td class="ds-muted">${escapeHtml(r.description || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

    return dsScreenStack(`
      ${dsPageHeader('הגדרות מערכת', `${rows.length} הגדרות`)}
      ${dsCard({ title: 'הגדרות', padded: false, body: rowsHtml })}
    `);
  },
  bind() {}
};

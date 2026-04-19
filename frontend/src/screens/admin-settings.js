import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsKpiGrid
} from './shared/layout.js';

function renderSettingsTable(settings) {
  if (!settings || (Array.isArray(settings) && settings.length === 0)) {
    return dsEmptyState('לא נמצאו הגדרות — בדקו שהגיליון settings מחובר');
  }

  const entries = Array.isArray(settings)
    ? settings
    : Object.entries(settings).map(([key, value]) => ({ key, value }));

  const rows = entries.map((entry) => {
    const key = escapeHtml(String(entry.key ?? entry.setting ?? entry.name ?? ''));
    const val = escapeHtml(String(entry.value ?? entry.val ?? ''));
    const desc = entry.description || entry.desc || '';
    return `<tr>
      <td style="font-weight:600;white-space:nowrap;">${key}</td>
      <td>${val}</td>
      ${desc ? `<td class="ds-muted" style="font-size:0.82rem;">${escapeHtml(String(desc))}</td>` : '<td></td>'}
    </tr>`;
  }).join('');

  return `<div class="ds-table-wrap"><table class="ds-table">
    <thead><tr>
      <th>מפתח</th>
      <th>ערך</th>
      <th>תיאור</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

export const adminSettingsScreen = {
  load: ({ api }) => {
    if (typeof api.adminSettings === 'function') {
      return api.adminSettings().catch(() => ({ rows: [], _fallback: true }));
    }
    return Promise.resolve({ rows: [], _fallback: true });
  },
  render(data, { state } = {}) {
    const isFallback = !data || data._fallback;
    const settings = data?.rows ?? data?.settings ?? (Array.isArray(data) ? data : []);

    const infoBox = isFallback
      ? `<div class="ds-info-banner ds-info-banner--warning" dir="rtl">
          <p>⚠ ה-API של הגדרות המערכת (<code>adminSettings</code>) אינו מוגדר עדיין בקוד השרת.<br/>
          הגדרות מנוהלות ישירות בגיליון <strong>settings</strong> ב-Google Sheets.</p>
        </div>`
      : '';

    const clientSettings = state?.clientSettings || {};
    const csEntries = Object.entries(clientSettings).map(([k, v]) => ({ key: k, value: v }));

    const clientTable = csEntries.length === 0 ? '' : dsCard({
      title: 'הגדרות לקוח (מהשרת)',
      body: `<div class="ds-table-wrap"><table class="ds-table">
        <thead><tr><th>מפתח</th><th>ערך</th></tr></thead>
        <tbody>${csEntries.map(({ key, value }) => `<tr>
          <td style="font-weight:600;">${escapeHtml(key)}</td>
          <td>${escapeHtml(String(value))}</td>
        </tr>`).join('')}</tbody>
      </table></div>`,
      padded: false
    });

    return dsScreenStack(`
      ${dsPageHeader('הגדרות מערכת', 'ניהול הגדרות — לקריאה בלבד')}
      ${infoBox}
      ${clientTable}
      ${dsCard({
        title: 'הגדרות מגיליון settings',
        body: isFallback
          ? `<div class="ds-empty" dir="rtl" style="padding:var(--ds-space-4);">
              <p class="ds-empty__msg">יש להגדיר את ה-API <code>adminSettings</code> בקוד Apps Script כדי לאכלס מסך זה.</p>
            </div>`
          : renderSettingsTable(settings),
        padded: isFallback
      })}
    `);
  },
  bind() {}
};

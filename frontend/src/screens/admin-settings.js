import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

function renderSettingsTable(entries, searchable) {
  if (!entries || entries.length === 0) return dsEmptyState('אין הגדרות להצגה');

  const rowsHtml = entries.map((entry) => {
    const key = escapeHtml(String(entry.key ?? entry.setting ?? entry.name ?? ''));
    const val = escapeHtml(String(entry.value ?? entry.val ?? ''));
    const desc = escapeHtml(String(entry.description ?? entry.desc ?? ''));
    const searchData = [key, val, desc].join(' ').toLowerCase();
    return `<tr data-list-item data-search="${escapeHtml(searchData)}">
      <td style="font-weight:600;white-space:nowrap;">${key}</td>
      <td><code style="font-size:0.8rem;background:var(--ds-surface-subtle);padding:2px 6px;border-radius:4px;border:1px solid var(--ds-border);">${val || '—'}</code></td>
      <td class="ds-muted" style="font-size:0.78rem;">${desc}</td>
    </tr>`;
  }).join('');

  return `${searchable ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש הגדרה...' }) : ''}
  <div class="ds-table-wrap"><table class="ds-table">
    <thead><tr><th>מפתח</th><th>ערך</th><th>תיאור</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table></div>`;
}

export const adminSettingsScreen = {
  load: ({ api, state }) => {
    if (typeof api.adminSettings === 'function') {
      return api.adminSettings().catch(() => ({ _fallback: true }));
    }
    return Promise.resolve({ _fallback: true, _clientSettings: state?.clientSettings });
  },

  render(data, { state } = {}) {
    const isFallback = !data || data._fallback;
    const clientSettings = state?.clientSettings || (data?._clientSettings) || {};
    const apiSettings = (!isFallback && (data?.rows || data?.settings)) || [];

    /* Always show client settings from bootstrap — these are real data */
    const csEntries = Object.entries(clientSettings).map(([k, v]) => ({
      key: k,
      value: typeof v === 'boolean' ? (v ? 'כן' : 'לא') : String(v),
      description: ''
    }));

    const apiEntries = Array.isArray(apiSettings)
      ? apiSettings
      : Object.entries(apiSettings).map(([key, value]) => ({ key, value }));

    const clientSettingsBlock = csEntries.length > 0
      ? dsCard({
          title: 'הגדרות לקוח פעילות',
          badge: `${csEntries.length} הגדרות`,
          body: renderSettingsTable(csEntries, false),
          padded: false
        })
      : '';

    const apiBlock = !isFallback && apiEntries.length > 0
      ? dsCard({
          title: 'הגדרות מגיליון settings',
          badge: `${apiEntries.length} הגדרות`,
          body: renderSettingsTable(apiEntries, true),
          padded: false
        })
      : dsCard({
          title: 'הגדרות מגיליון settings',
          body: `<div style="padding:var(--ds-space-4);">
            <p style="font-size:0.85rem;color:var(--ds-text-muted);margin:0;">
              יש להגדיר <code>adminSettings</code> ב-Apps Script כדי לאכלס נתונים כאן.<br/>
              הגדרות נוספות מנוהלות ישירות בגיליון <strong>settings</strong> ב-Google Sheets.
            </p>
          </div>`,
          padded: false
        });

    return dsScreenStack(`
      ${dsPageHeader('הגדרות מערכת', 'הגדרות תצורה — לקריאה בלבד')}
      ${clientSettingsBlock}
      ${apiBlock}
    `);
  },

  bind({ root }) {
    bindPageListTools(root);
  }
};

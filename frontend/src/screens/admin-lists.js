import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

function renderListSection(title, items, color) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const chips = items.map((item) => {
    const label = String(item?.label ?? item?.name ?? item?.value ?? item ?? '');
    const active = item?.active !== false && item?.active !== 'no';
    return `<span class="ds-list-item-chip${active ? '' : ' ds-list-item-chip--inactive'}" data-list-item data-search="${escapeHtml(label.toLowerCase())}">${escapeHtml(label)}</span>`;
  }).join('');
  return `<div class="ds-list-group">
    <p class="ds-list-group-title" style="color:${color || 'var(--ds-accent)'};">${escapeHtml(title)} <span class="ds-badge">${items.length}</span></p>
    <div class="ds-list-chip-wrap">${chips}</div>
  </div>`;
}

export const adminListsScreen = {
  load: ({ api }) => {
    if (typeof api.adminLists === 'function') {
      return api.adminLists().catch(() => ({ _fallback: true }));
    }
    return Promise.resolve({ _fallback: true });
  },
  render(data, { state } = {}) {
    const isFallback = !data || data._fallback;

    const infoBox = isFallback
      ? `<div class="ds-info-banner ds-info-banner--warning" dir="rtl">
          <p>⚠ ה-API של הרשימות (<code>adminLists</code>) אינו מוגדר עדיין בקוד השרת.<br/>
          הרשימות מנוהלות ישירות בגיליונות ב-Google Sheets.</p>
        </div>`
      : '';

    const knownLists = isFallback ? [] : [
      { key: 'schools', title: 'בתי ספר', color: 'var(--ds-accent)' },
      { key: 'authorities', title: 'גורמי מימון', color: 'var(--ds-success)' },
      { key: 'activity_types', title: 'סוגי פעילות', color: 'var(--ds-warning)' },
      { key: 'managers', title: 'מנהלים', color: 'var(--ds-danger)' },
      { key: 'statuses', title: 'סטטוסים', color: 'var(--ds-status-neutral)' }
    ];

    const sectionsHtml = knownLists
      .map(({ key, title, color }) => renderListSection(title, data?.[key], color))
      .filter(Boolean)
      .join('');

    const bodyHtml = isFallback
      ? `<div class="ds-empty" dir="rtl" style="padding:var(--ds-space-4);">
          <p class="ds-empty__msg">יש להגדיר את ה-API <code>adminLists</code> בקוד Apps Script כדי לאכלס מסך זה.</p>
        </div>`
      : (sectionsHtml || dsEmptyState('לא נמצאו רשימות'));

    return dsScreenStack(`
      ${dsPageHeader('ניהול רשימות', 'ערכים לרשימות נגללות — לקריאה בלבד')}
      ${infoBox}
      ${dsCard({
        title: 'רשימות המערכת',
        body: bodyHtml,
        padded: isFallback || !sectionsHtml
      })}
    `);
  },
  bind({ root }) {
    bindPageListTools(root);
  }
};

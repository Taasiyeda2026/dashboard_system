import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

function hebrewListTitle(key) {
  const k = String(key || '').trim();
  const map = {
    activity_type: 'סוג פעילות',
    finance_status: 'סטטוס כספים',
    funding: 'מימון',
    school: 'בית ספר',
    authority: 'רשות',
    grade: 'שכבה',
    activity_manager: 'מנהל פעילות',
    instructor_name: 'שם מדריך',
    activity_name: 'שם פעילות (רשימה)'
  };
  return map[k] || k;
}

function renderListGroups(listsByName) {
  const keys = Object.keys(listsByName || {}).sort((a, b) => a.localeCompare(b, 'he'));
  if (!keys.length) return '';
  return keys
    .map((key) => {
      const values = Array.isArray(listsByName[key]) ? listsByName[key] : [];
      const chips = values
        .map((v) => `<span class="ds-list-item-chip">${escapeHtml(String(v))}</span>`)
        .join('');
      const searchHay = [key, hebrewListTitle(key), ...values.map((v) => String(v))].join(' ');
      return `<section class="ds-list-group" data-list-item data-search="${escapeHtml(searchHay)}" data-filter="${escapeHtml(key)}">
        <h3 class="ds-list-group-title">${escapeHtml(hebrewListTitle(key))} <span class="ds-muted">(${escapeHtml(key)})</span></h3>
        <div class="ds-list-chip-wrap">${chips || '<span class="ds-muted">ריק</span>'}</div>
      </section>`;
    })
    .join('');
}

export const listsScreen = {
  load: ({ api }) => api.adminLists(),
  render(data) {
    const byName = data?.lists_by_name && typeof data.lists_by_name === 'object' ? data.lists_by_name : null;
    const rawRows = Array.isArray(data?.raw) ? data.raw : [];
    const filters = byName
      ? Object.keys(byName)
          .sort((a, b) => a.localeCompare(b, 'he'))
          .map((k) => ({ value: k, label: `${hebrewListTitle(k)} (${k})` }))
      : [];

    let body = '';
    if (byName) {
      body = renderListGroups(byName);
      if (!body.trim()) body = dsEmptyState('בגיליון הרשימות אין עדיין ערכים לפי list_name');
    } else if (rawRows.length === 0) {
      body = dsEmptyState('לא נמצאו נתונים בגיליון הרשימות');
    } else {
      body = dsEmptyState('בגיליון אין עמודת list_name — יש להגדיר עמודות כמו במקור הנתונים (list_name, value, …)');
    }

    return dsScreenStack(`
      <div class="ds-info-banner ds-info-banner--info" style="margin-bottom:12px">
        <p>ערכים אלה נטענים מגיליון <strong>lists</strong> (או מגיליון מקור שנקבע ב־<code>dropdown_source_sheet</code> בהגדרות). אותן רשימות משמשות את ה־dropdowns במערכת (למשל בעריכת פעילות).</p>
      </div>
      ${byName && filters.length && body.indexOf('ds-list-group') >= 0 ? dsPageListToolsBar({ searchPlaceholder: 'חיפוש ברשימות…', filterLabel: 'רשימה', filters }) : ''}
      ${dsCard({
        title: 'רשימות מערכת',
        body,
        padded: true
      })}
    `);
  },
  bind({ root }) {
    bindPageListTools(root);
  }
};

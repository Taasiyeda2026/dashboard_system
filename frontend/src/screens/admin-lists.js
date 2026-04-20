import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { hebrewActivityType } from './shared/ui-hebrew.js';

function extractLists(activitiesData) {
  const rows = Array.isArray(activitiesData?.rows) ? activitiesData.rows : [];
  const toSorted = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));

  return {
    schools: toSorted(rows.map((r) => String(r.school || '').trim())),
    fundings: toSorted(rows.map((r) => String(r.funding || '').trim())),
    authorities: toSorted(rows.map((r) => String(r.authority || '').trim())),
    activity_types: toSorted(rows.map((r) => String(r.activity_type || r.kind || '').trim())),
    managers: toSorted(rows.map((r) => String(r.activity_manager || '').trim()))
  };
}

function renderRawTable(title, rawRows) {
  if (!Array.isArray(rawRows) || rawRows.length === 0) return '';
  const headers = [...new Set(rawRows.flatMap((r) => Object.keys(r)))].filter((h) => {
    return rawRows.some((r) => String(r[h] || '').trim());
  });
  if (headers.length === 0) return '';

  const theadCells = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const tbodyRows = rawRows.map((row) => {
    const searchData = headers.map((h) => String(row[h] || '')).join(' ').toLowerCase();
    const cells = headers.map((h) => `<td>${escapeHtml(String(row[h] || ''))}</td>`).join('');
    return `<tr data-list-item data-search="${escapeHtml(searchData)}">${cells}</tr>`;
  }).join('');

  return dsCard({
    title,
    badge: `${rawRows.length} שורות`,
    body: `${dsPageListToolsBar({ searchPlaceholder: 'חיפוש...' })}
      <div class="ds-table-wrap"><table class="ds-table">
        <thead><tr>${theadCells}</tr></thead>
        <tbody>${tbodyRows}</tbody>
      </table></div>`,
    padded: false
  });
}

function renderListCard(title, items, mapLabel) {
  if (!items || items.length === 0) return '';
  const rows = items.map((item) => {
    const label = mapLabel ? mapLabel(item) : item;
    const searchData = `${item} ${label}`.toLowerCase();
    return `<tr data-list-item data-search="${escapeHtml(searchData)}">
      <td>${escapeHtml(label)}</td>
      <td class="ds-muted" style="font-size:0.75rem;">${escapeHtml(item)}</td>
    </tr>`;
  }).join('');

  return dsCard({
    title,
    badge: String(items.length),
    body: `${dsPageListToolsBar({ searchPlaceholder: `חיפוש ב${title}...` })}
      <div class="ds-table-wrap"><table class="ds-table">
        <thead><tr><th>ערך מוצג</th><th>ערך גולמי</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>`,
    padded: false
  });
}

export const adminListsScreen = {
  load: ({ api }) => {
    if (typeof api.adminLists === 'function') {
      return api.adminLists()
        .then((d) => ({ source: 'api', data: d }))
        .catch(() => api.activities({ date_from: '', date_to: '' })
          .then((d) => ({ source: 'activities', data: d }))
          .catch(() => ({ source: 'empty', data: null }))
        );
    }
    return api.activities({})
      .then((d) => ({ source: 'activities', data: d }))
      .catch(() => ({ source: 'empty', data: null }));
  },

  render(data, { state } = {}) {
    const source = data?.source || 'empty';
    const inner = data?.data;

    if (source === 'empty' || !inner) {
      return dsScreenStack(`
        ${dsPageHeader('ניהול רשימות', 'ערכים לרשימות — לקריאה בלבד')}
        ${dsCard({ title: 'רשימות', body: dsEmptyState('לא ניתן לטעון נתונים — בדקו את חיבור ה-API'), padded: true })}
      `);
    }

    let blocks = '';
    const rawRows = Array.isArray(inner?.raw) ? inner.raw : (Array.isArray(inner?.rows) ? inner.rows : []);

    if (source === 'api' && rawRows.length > 0) {
      /* Show raw tabular dataset as the primary view */
      blocks = renderRawTable('גיליון רשימות — נתונים גולמיים', rawRows);
    }

    if (source === 'api' && (Array.isArray(inner?.schools) || Array.isArray(inner?.fundings))) {
      const lists = {
        schools: Array.isArray(inner?.schools) ? inner.schools : [],
        fundings: Array.isArray(inner?.fundings) ? inner.fundings : [],
        authorities: Array.isArray(inner?.authorities) ? inner.authorities : [],
        activity_types: Array.isArray(inner?.activity_types) ? inner.activity_types : [],
        managers: Array.isArray(inner?.managers) ? inner.managers : []
      };
      const grouped = [
        renderListCard('בתי ספר', lists.schools, (v) => v),
        renderListCard('גורמי מימון', lists.authorities.length ? lists.authorities : lists.fundings, (v) => v),
        renderListCard('סוגי פעילות', lists.activity_types, (v) => hebrewActivityType(v) || v),
        renderListCard('מנהלי פעילויות', lists.managers, (v) => v)
      ].filter(Boolean).join('');
      if (grouped) blocks += grouped;
    } else if (source === 'activities') {
      const lists = extractLists(inner);
      blocks = [
        renderListCard('בתי ספר', lists.schools, (v) => v),
        renderListCard('גורמי מימון', lists.authorities.length ? lists.authorities : lists.fundings, (v) => v),
        renderListCard('סוגי פעילות', lists.activity_types, (v) => hebrewActivityType(v) || v),
        renderListCard('מנהלי פעילויות', lists.managers, (v) => v)
      ].filter(Boolean).join('');
    }

    const sourceNote = source === 'activities'
      ? `<p class="ds-muted" style="font-size:0.78rem;padding:var(--ds-space-2) 0;">הרשימות נוצרו מנתוני מסך הפעילויות. להגדרת רשימות ייעודיות, יש להשתמש בגיליון <strong>lists</strong>.</p>`
      : '';

    return dsScreenStack(`
      ${dsPageHeader('ניהול רשימות', 'ערכי גיליון lists — לקריאה בלבד')}
      ${sourceNote}
      ${blocks || dsEmptyState('לא נמצאו נתונים לרשימות')}
    `);
  },

  bind({ root }) {
    bindPageListTools(root);
  }
};

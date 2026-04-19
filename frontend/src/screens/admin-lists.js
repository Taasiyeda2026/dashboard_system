import { escapeHtml } from './shared/html.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { hebrewActivityType } from './shared/ui-hebrew.js';

/* Extract unique sorted values from activities data */
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

function renderListTable(title, items, badge, mapLabel) {
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
    badge: badge || String(items.length),
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
    /* Try adminLists first; fall back to activities to extract unique values */
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
        ${dsPageHeader('ניהול רשימות', 'ערכים לרשימות נגללות — לקריאה בלבד')}
        ${dsCard({ title: 'רשימות', body: dsEmptyState('לא ניתן לטעון נתונים — בדקו את חיבור ה-API'), padded: true })}
      `);
    }

    let lists;
    if (source === 'api') {
      /* adminLists API returns structured data or raw rows */
      if (Array.isArray(inner?.schools) || Array.isArray(inner?.fundings)) {
        lists = {
          schools: Array.isArray(inner?.schools) ? inner.schools : [],
          fundings: Array.isArray(inner?.fundings) ? inner.fundings : [],
          authorities: Array.isArray(inner?.authorities) ? inner.authorities : [],
          activity_types: Array.isArray(inner?.activity_types) ? inner.activity_types : [],
          managers: Array.isArray(inner?.managers) ? inner.managers : []
        };
      } else {
        /* Raw rows fallback: extract from activities-like data */
        lists = extractLists(inner?.raw ? { rows: inner.raw } : inner);
      }
    } else {
      /* Extract from activities data */
      lists = extractLists(inner);
    }

    const sourceNote = source === 'activities'
      ? `<p class="ds-muted" style="font-size:0.78rem;padding:var(--ds-space-2) 0;">הרשימות נוצרו מנתוני מסך הפעילויות. להגדרת רשימות ייעודיות, יש להגדיר <code>adminLists</code> ב-Apps Script.</p>`
      : '';

    const blocks = [
      renderListTable('בתי ספר', lists.schools, String(lists.schools.length), (v) => v),
      renderListTable('גורמי מימון', lists.authorities.length ? lists.authorities : lists.fundings, '', (v) => v),
      renderListTable('סוגי פעילות', lists.activity_types, '', (v) => hebrewActivityType(v) || v),
      renderListTable('מנהלי פעילויות', lists.managers, String(lists.managers.length), (v) => v)
    ].filter(Boolean).join('');

    return dsScreenStack(`
      ${dsPageHeader('ניהול רשימות', 'ערכים לרשימות נגללות — לקריאה בלבד')}
      ${sourceNote}
      ${blocks || dsEmptyState('לא נמצאו נתונים לרשימות')}
    `);
  },

  bind({ root }) {
    bindPageListTools(root);
  }
};

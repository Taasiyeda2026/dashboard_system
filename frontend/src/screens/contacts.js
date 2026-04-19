import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewContactKind } from './shared/ui-hebrew.js';
import { dsPageHeader, dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';

const CONTACT_COLUMNS = ['kind', 'emp_id', 'full_name', 'authority', 'school', 'contact_name', 'phone', 'mobile', 'email'];

function cellVal(row, column) {
  let val = row?.[column] ?? '';
  if (column === 'kind') val = hebrewContactKind(val);
  return val;
}

function contactDetailPanel(row) {
  const lines = CONTACT_COLUMNS.map((col) => {
    const val = cellVal(row, col);
    return `<div class="ds-contact-detail-row"><span class="ds-muted">${escapeHtml(hebrewColumn(col))}</span> <span>${escapeHtml(String(val || '—'))}</span></div>`;
  }).join('');
  return `<div class="ds-contact-detail-grid" dir="rtl">${lines}</div>`;
}

function searchHayForRow(row) {
  return CONTACT_COLUMNS.map((c) => String(cellVal(row, c) || '')).join(' ');
}

function groupMeta(row) {
  const school = String(row?.school || '').trim();
  if (school) return { key: `school:${school}`, title: school };
  const auth = String(row?.authority || '').trim();
  if (auth) return { key: `auth:${auth}`, title: auth };
  return { key: 'other:__none', title: 'ללא בית ספר / גורם מזוהה' };
}

export const contactsScreen = {
  load: ({ api }) => api.contacts(),
  render(data) {
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    if (rows.length === 0) {
      return dsScreenStack(`
      ${dsPageHeader('אנשי קשר', 'בתי ספר, רשויות וגורמים כלליים')}
      ${dsCard({ title: 'אנשי קשר', badge: '0', body: dsEmptyState('לא נמצאו רשומות'), padded: true })}
    `);
    }

    const kindUniq = [...new Set(rows.map((r) => String(r.kind || '').trim()).filter(Boolean))];
    const kindFilters = kindUniq.map((k) => ({ value: k, label: hebrewContactKind(k) }));

    const groupsMap = new Map();
    rows.forEach((row) => {
      const g = groupMeta(row);
      if (!groupsMap.has(g.key)) {
        groupsMap.set(g.key, { title: g.title, rows: [] });
      }
      groupsMap.get(g.key).rows.push({ row });
    });

    const groups = Array.from(groupsMap.values()).sort((a, b) => a.title.localeCompare(b.title, 'he'));

    const summaryHtml = `<div class="ds-contacts-summary" dir="rtl"><span aria-hidden="true">📋</span> <strong>${groups.length}</strong> מוסדות · <strong>${rows.length}</strong> אנשי קשר</div>`;

    const blocks = groups
      .map((g) => {
        const groupSearch = g.rows.map(({ row }) => searchHayForRow(row)).join(' ');
        const kindsInGroup = [...new Set(g.rows.map(({ row }) => String(row.kind || '').trim()).filter(Boolean))];
        const filterAttr = kindsInGroup.join(' ');
        return `<section class="ds-school-contact-box" data-list-item data-search="${escapeHtml(groupSearch)}" data-filter="${escapeHtml(filterAttr)}">
          <header class="ds-school-contact-box__head"><span class="ds-school-contact-box__icon" aria-hidden="true">🏫</span><span class="ds-school-contact-box__title">${escapeHtml(g.title)}</span><span class="ds-badge">${g.rows.length}</span></header>
          <div class="ds-school-contact-box__body">
            ${g.rows
              .map(({ row }) => {
                const lineTitle = cellVal(row, 'contact_name') || cellVal(row, 'full_name') || '—';
                const phones = [row.phone, row.mobile, row.email].filter((x) => x && String(x).trim()).join(' · ') || 'ללא פרטי קשר';
                return `<div class="ds-contact-line">
                  <button type="button" class="ds-contact-line__btn" aria-expanded="false">
                    <span class="ds-contact-line__main">${escapeHtml(String(lineTitle))}</span>
                    <span class="ds-contact-line__sub">${escapeHtml(String(phones))}</span>
                    <span class="ds-contact-line__chev" aria-hidden="true">▾</span>
                  </button>
                  <div class="ds-contact-line__detail" hidden>${contactDetailPanel(row)}</div>
                </div>`;
              })
              .join('')}
          </div>
        </section>`;
      })
      .join('');

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר', 'ריכוז לפי מוסד — לחיצה על שורה פותחת פירוט מתחתיה')}
      ${dsCard({
        title: 'אנשי קשר לפי מוסד',
        badge: `${rows.length} רשומות`,
        body: `${dsPageListToolsBar({
          searchPlaceholder: 'חיפוש באנשי קשר…',
          filterLabel: 'סוג רשומה',
          filters: kindFilters
        })}${summaryHtml}<div class="ds-contacts-group-stack">${blocks}</div>`,
        padded: true
      })}
    `);
  },
  bind({ root, data }) {
    bindPageListTools(root);

    root.querySelectorAll('.ds-contact-line__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('.ds-contact-line');
        const panel = wrap?.querySelector('.ds-contact-line__detail');
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }
};

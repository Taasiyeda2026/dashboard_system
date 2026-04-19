import { escapeHtml } from './shared/html.js';
import { hebrewColumn, hebrewEmploymentType } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsCard,
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
const AVATAR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#14b8a6',
  '#f43f5e','#a855f7','#0ea5e9','#10b981'
];

function avatarColor(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function avatarInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return parts[0][0] + parts[1][0];
  if (parts.length === 1) return parts[0].slice(0, 2);
  return '??';
}

function drawerHtml(row) {
  const columns = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
  const lines = columns.map((col) => {
    const raw = row?.[col] ?? '';
    if (col === 'active') {
      const label = String(raw).toLowerCase() === 'yes' ? 'כן' : 'לא';
      const kind = String(raw).toLowerCase() === 'yes' ? 'success' : 'neutral';
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
    }
    const val = col === 'employment_type' ? hebrewEmploymentType(raw) : (raw || '—');
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val))}</p>`;
  }).join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.full_name || '').toLowerCase().includes(lq) ||
    String(r.emp_id || '').toLowerCase().includes(lq) ||
    String(r.email || '').toLowerCase().includes(lq) ||
    String(r.mobile || '').toLowerCase().includes(lq) ||
    hebrewEmploymentType(r.employment_type).toLowerCase().includes(lq)
  );
}

function renderContactCard(row) {
  const name = row.full_name || row.emp_id || '—';
  const initials = avatarInitials(name);
  const color = avatarColor(row.emp_id || name);
  const role = hebrewEmploymentType(row.employment_type) || '';
  const phone = row.mobile || row.email || '';
  const activeClass = String(row.active || '').toLowerCase() === 'no' ? ' ds-person-card--inactive' : '';
  const phoneHtml = phone
    ? `<span class="ds-person-phone" aria-label="טלפון">📞 ${escapeHtml(phone)}</span>`
    : '';
  return `
    <button type="button" class="ds-person-card ds-person-card--contact${activeClass}" data-card-action="icontact:${encodeURIComponent(row.emp_id)}">
      <span class="ds-person-avatar" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</span>
      <span class="ds-person-name">${escapeHtml(name)}</span>
      ${role ? `<span class="ds-person-meta">${escapeHtml(role)}</span>` : ''}
      ${phoneHtml}
    </button>`;
}

/** אנשי קשר של מדריכים — לפי גיליון contacts_instructors במקור הנתונים (צפייה בלבד). */
export const instructorContactsScreen = {
  load: ({ api }) => api.instructorContacts(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.instrContactsSearch || '';
    const activeFilter = state?.instrContactsActiveFilter || '';

    let rows = applySearch(allRows, searchQ);
    if (activeFilter) {
      rows = rows.filter((r) => String(r.active || '').toLowerCase() === activeFilter);
    }

    const activeChips = [
      { val: '', label: 'הכל' },
      { val: 'yes', label: 'פעיל' },
      { val: 'no', label: 'לא פעיל' }
    ].map((c) =>
      `<button type="button" class="ds-chip ${c.val === activeFilter ? 'is-active' : ''}" data-active-filter="${c.val}">${escapeHtml(c.label)}</button>`
    ).join('');

    const cardsHtml = rows.length === 0
      ? dsEmptyState('לא נמצאו אנשי קשר')
      : `<div class="ds-person-grid">${rows.map(renderContactCard).join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('אנשי קשר מדריכים', 'נתונים מגיליון אנשי הקשר')}
      <div class="ds-screen-top-row">
        <input
          id="instr-contacts-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
      </div>
      <div class="ds-filter-bar" role="toolbar">${activeChips}</div>
      ${dsCard({
        title: `אנשי קשר מדריכים · ${rows.length}`,
        body: cardsHtml,
        padded: rows.length === 0
      })}
    `);
  },
  bind({ root, data, state, ui, rerender }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];

    root.querySelector('#instr-contacts-search')?.addEventListener('input', (ev) => {
      state.instrContactsSearch = ev.target.value || '';
      rerender();
    });

    root.querySelectorAll('[data-active-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.instrContactsActiveFilter = btn.dataset.activeFilter || '';
        rerender();
      });
    });

    const openRow = (empId) => {
      const hit = allRows.find((r) => String(r.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id,
        content: drawerHtml(hit)
      });
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('icontact:')) return;
      openRow(decodeURIComponent(action.slice('icontact:'.length)));
    });
  }
};

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

function instructorDrawerHtml(row) {
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
  const actCount = row?.activity_count ?? 0;
  return `<div class="ds-details-grid" dir="rtl">
    <p><strong>שיעורים:</strong> ${actCount}</p>
    ${lines}
  </div>`;
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

function renderInstructorCard(row) {
  const name = row.full_name || row.emp_id || '—';
  const initials = avatarInitials(name);
  const color = avatarColor(row.emp_id || name);
  const count = row.activity_count ?? 0;
  const activeClass = String(row.active || '').toLowerCase() === 'no' ? ' ds-person-card--inactive' : '';
  return `
    <button type="button" class="ds-person-card${activeClass}" data-card-action="instructor:${encodeURIComponent(row.emp_id)}">
      <span class="ds-person-avatar" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</span>
      <span class="ds-person-name">${escapeHtml(name)}</span>
      <span class="ds-person-meta">${count} שיעורים</span>
    </button>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.instructorsSearch || '';
    const activeFilter = state?.instructorsActiveFilter || '';

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
      ? dsEmptyState('לא נמצאו מדריכים')
      : `<div class="ds-person-grid">${rows.map(renderInstructorCard).join('')}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('מדריכים', 'רשימת מדריכים לפי פעילויות')}
      <div class="ds-screen-top-row">
        <input
          id="instructors-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש מדריך..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
        <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-goto-instructor-contacts>📇 אנשי קשר מדריכים</button>
      </div>
      <div class="ds-filter-bar" role="toolbar">${activeChips}</div>
      ${dsCard({
        title: `מדריכים · ${rows.length}`,
        body: cardsHtml,
        padded: rows.length === 0
      })}
    `);
  },
  bind({ root, data, state, ui, rerender }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];

    root.querySelector('#instructors-search')?.addEventListener('input', (ev) => {
      state.instructorsSearch = ev.target.value || '';
      rerender();
    });

    root.querySelector('[data-goto-instructor-contacts]')?.addEventListener('click', () => {
      state.route = 'instructor-contacts';
      rerender();
    });

    root.querySelectorAll('[data-active-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.instructorsActiveFilter = btn.dataset.activeFilter || '';
        rerender();
      });
    });

    const openInstructor = (empId) => {
      const hit = allRows.find((r) => String(r.emp_id) === String(empId));
      if (!hit || !ui) return;
      ui.openDrawer({
        title: hit.full_name || hit.emp_id,
        content: instructorDrawerHtml(hit)
      });
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('instructor:')) return;
      openInstructor(decodeURIComponent(action.slice('instructor:'.length)));
    });
  }
};

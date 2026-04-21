import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewEmploymentType, hebrewInstructorsSourcesLabel } from './shared/ui-hebrew.js';
import {
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

function instructorDrawerHtml(row, hideEmpIds) {
  const columns = ['emp_id', 'full_name', 'mobile', 'email', 'address', 'employment_type', 'direct_manager', 'active'];
  const lines = columns.map((col) => {
    if (hideEmpIds && col === 'emp_id') return '';
    const raw = row?.[col] ?? '';
    if (col === 'active') {
      const label = String(raw).toLowerCase() === 'yes' ? 'כן' : 'לא';
      const kind = String(raw).toLowerCase() === 'yes' ? 'success' : 'neutral';
      return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${dsStatusChip(label, kind)}</p>`;
    }
    const val = col === 'employment_type' ? hebrewEmploymentType(raw) : (raw || '—');
    return `<p><strong>${escapeHtml(hebrewColumn(col))}:</strong> ${escapeHtml(String(val))}</p>`;
  }).join('');
  const dataLong = row?.data_long ?? 0;
  const dataShort = row?.data_short ?? 0;
  return `<div class="ds-details-grid" dir="rtl">
    <p><strong>תוכניות (ארוכות):</strong> ${escapeHtml(String(dataLong))}</p>
    <p><strong>חד-יומיות:</strong> ${escapeHtml(String(dataShort))}</p>
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
  const dataLong = row.data_long ?? 0;
  const dataShort = row.data_short ?? 0;
  const activeClass = String(row.active || '').toLowerCase() === 'no' ? ' ds-person-card--inactive' : '';
  return `
    <button type="button" class="ds-person-card${activeClass}" data-card-action="instructor:${encodeURIComponent(row.emp_id)}">
      <span class="ds-person-avatar" style="background:${color}" aria-hidden="true">${escapeHtml(initials)}</span>
      <span class="ds-person-name">${escapeHtml(name)}</span>
      <span class="ds-person-meta">תוכניות: ${escapeHtml(String(dataLong))}</span>
      <span class="ds-person-meta">חד-יומיות: ${escapeHtml(String(dataShort))}</span>
    </button>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ = state?.instructorsSearch || '';
    const activeFilter = state?.instructorsActiveFilter || '';

    const sources = state?.clientSettings?.instructors_screen_sources;
    const sourcesLabel = hebrewInstructorsSourcesLabel(sources);

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

    const sourcesBanner = `<div class="ds-info-banner" dir="rtl">
      <span>📋 <strong>מקור נתונים:</strong> מדריכים שמופיעים ב${escapeHtml(sourcesLabel)}</span>
    </div>`;

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      ${sourcesBanner}
      <div class="ds-screen-top-row">
        <input
          id="instructors-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש מדריך..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
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
    bindActNavGrid(root, { state, rerender });
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    let _searchTimer;
    root.querySelector('#instructors-search')?.addEventListener('input', (ev) => {
      state.instructorsSearch = ev.target.value || '';
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => rerender(), 220);
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
        content: instructorDrawerHtml(hit, hideEmpIds)
      });
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('instructor:')) return;
      openInstructor(decodeURIComponent(action.slice('instructor:'.length)));
    });
  }
};

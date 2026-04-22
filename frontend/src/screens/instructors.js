import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { formatDateHe } from './shared/format-date.js';

function applySearch(rows, q) {
  if (!q) return rows;
  const lq = q.toLowerCase();
  return rows.filter((r) =>
    String(r.full_name || '').toLowerCase().includes(lq) ||
    String(r.emp_id   || '').toLowerCase().includes(lq)
  );
}

function applyActiveFilter(rows, activeOnly) {
  if (!activeOnly) return rows;
  return rows.filter((r) => (r.programs_count || 0) + (r.one_day_count || 0) > 0);
}

function countBadge(count, label, cls) {
  if (!count && count !== 0) return '';
  return `<span class="instr-count-badge instr-count-badge--${cls}">
    <span class="instr-count-badge__num">${escapeHtml(String(count))}</span>
    <span class="instr-count-badge__lbl">${escapeHtml(label)}</span>
  </span>`;
}

function renderInstructorRow(row) {
  const name     = escapeHtml(row.full_name || row.emp_id || '—');
  const endDate  = row.latest_end_date ? formatDateHe(row.latest_end_date) : '';
  const programs = row.programs_count || 0;
  const oneDay   = row.one_day_count  || 0;
  const total    = programs + oneDay;
  const hasActivity = total > 0;
  const inactiveClass = hasActivity ? '' : ' ci-row--inactive';

  return `
    <div class="ci-row instr-summary-row${inactiveClass}" dir="rtl">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        <span class="instr-count-badges">
          ${countBadge(programs, 'תוכניות', 'program')}
          ${countBadge(oneDay, 'חד-יומיות', 'oneday')}
        </span>
        ${endDate ? `<span class="instr-end-date">🏁 ${escapeHtml(endDate)}</span>` : ''}
      </div>
    </div>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),

  render(data, { state } = {}) {
    const allRows  = Array.isArray(data?.rows) ? data.rows : [];
    const ym       = data?.ym || '';
    const searchQ  = state?.instructorsSearch  || '';
    const activeOnly = state?.instructorsActiveOnly !== false;

    const searched  = applySearch(allRows, searchQ);
    const filtered  = applyActiveFilter(searched, activeOnly);
    const totalAll  = searched.length;

    const ymLabel = ym ? ym.slice(0, 7) : '';
    const activeChk = activeOnly ? 'checked' : '';

    const bodyHtml = filtered.length === 0
      ? dsEmptyState(searchQ || activeOnly ? 'לא נמצאו מדריכים לסינון זה' : 'אין נתוני מדריכים')
      : `<div class="ci-list">${filtered.map(renderInstructorRow).join('')}</div>`;

    const subtitle = ymLabel
      ? `מדריכים · ${filtered.length}${activeOnly && totalAll !== filtered.length ? ` (מתוך ${totalAll})` : ''} · חודש ${ymLabel}`
      : `מדריכים · ${filtered.length}`;

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      <div class="ds-screen-top-row">
        <input
          id="instructors-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש לפי שם / מזהה..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
        <label class="ds-toggle-label" dir="rtl">
          <input type="checkbox" id="instructors-active-only" ${activeChk} />
          פעילים החודש בלבד
        </label>
      </div>
      ${dsCard({ title: subtitle, body: bodyHtml, padded: filtered.length === 0 })}
    `);
  },

  bind({ root, data, state, rerender }) {
    bindActNavGrid(root, { state, rerender });

    root.querySelector('#instructors-active-only')?.addEventListener('change', (ev) => {
      state.instructorsActiveOnly = ev.target.checked;
      rerender();
    });

    let _searchTimer;
    root.querySelector('#instructors-search')?.addEventListener('input', (ev) => {
      state.instructorsSearch = ev.target.value || '';
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => rerender(), 220);
    });
  }
};

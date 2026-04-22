import { escapeHtml } from './shared/html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';
import { hebrewColumn, hebrewActivityType, hebrewFinanceStatus } from './shared/ui-hebrew.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';

const NO_INSTRUCTOR_LABEL = 'ללא מדריך';

function rowKey(row) {
  return encodeURIComponent(String(row.RowID || '') + '|' + String(row.source_sheet || ''));
}

function findRowByKey(allRows, key) {
  const decoded = decodeURIComponent(key);
  const sep = decoded.indexOf('|');
  const rid = decoded.slice(0, sep);
  const src = decoded.slice(sep + 1);
  return allRows.find((r) => String(r.RowID) === rid && String(r.source_sheet || '') === src) || null;
}

function groupByInstructor(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.instructor_name || '').trim() || NO_INSTRUCTOR_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'he')));
}

const ACTIVE_STATUS = 'פעיל';

function isActiveRow(row) {
  return String(row.status || '').trim() === ACTIVE_STATUS;
}

function applySearch(rows, q, activeOnly) {
  let out = activeOnly ? rows.filter(isActiveRow) : rows;
  if (!q) return out;
  const lq = q.toLowerCase();
  return out.filter((r) =>
    String(r.instructor_name || '').toLowerCase().includes(lq) ||
    String(r.instructor_name_2 || '').toLowerCase().includes(lq) ||
    String(r.activity_name || '').toLowerCase().includes(lq) ||
    String(r.school || '').toLowerCase().includes(lq) ||
    String(r.authority || '').toLowerCase().includes(lq)
  );
}

function activityDrawerHtml(row) {
  const fields = [
    ['activity_name', row.activity_name],
    ['activity_type', hebrewActivityType(row.activity_type)],
    ['school', row.school],
    ['authority', row.authority],
    ['activity_manager', row.activity_manager],
    ['start_date', row.start_date],
    ['end_date', row.end_date],
    ['status', row.status],
    ['finance_status', hebrewFinanceStatus(row.finance_status)],
    ['sessions', row.sessions],
    ['instructor_name', row.instructor_name],
    ['instructor_name_2', row.instructor_name_2],
    ['notes', row.notes],
  ];
  const lines = fields
    .filter(([, v]) => v && String(v).trim() && String(v) !== '—')
    .map(([k, v]) => `<p><strong>${escapeHtml(hebrewColumn(k))}:</strong> ${escapeHtml(String(v))}</p>`)
    .join('');
  return `<div class="ds-details-grid" dir="rtl">${lines}</div>`;
}

function statusBadge(status) {
  const s = String(status || '').trim();
  if (!s) return '';
  const isActive = s === ACTIVE_STATUS;
  const cls = isActive ? 'ci-status ci-status--active' : 'ci-status ci-status--inactive';
  return `<span class="${cls}">${escapeHtml(s)}</span>`;
}

function renderActivityRow(row) {
  const name = escapeHtml(row.activity_name || '—');
  const school = escapeHtml(row.school || '—');
  const authority = escapeHtml(row.authority || '');
  const meta = [school, authority].filter(Boolean).join(' · ');
  return `
    <div class="ci-row" data-instr-row="${rowKey(row)}" role="button" tabindex="0">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        ${meta ? `<span class="ci-row__meta">${meta}</span>` : ''}
        ${statusBadge(row.status)}
        <span class="ci-row__toggle" aria-hidden="true">&#9658;</span>
      </div>
    </div>`;
}

function renderGroups(groups) {
  let html = '';
  groups.forEach((rows, instructorName) => {
    const rowsHtml = rows.map((r) => renderActivityRow(r)).join('');
    html += `
      <div class="ci-school-block">
        <div class="ci-school-head">👥 ${escapeHtml(instructorName)} <span class="ci-count">${rows.length}</span></div>
        <div class="ci-school-rows">${rowsHtml}</div>
      </div>`;
  });
  return html;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),
  render(data, { state } = {}) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const searchQ  = state?.instructorsSearch || '';
    const activeOnly = state?.instructorsActiveOnly !== false;
    const filtered = applySearch(allRows, searchQ, activeOnly);
    const groups = groupByInstructor(filtered);

    const activeCount = allRows.filter(isActiveRow).length;
    const totalCount  = allRows.length;

    const bodyHtml = filtered.length === 0
      ? dsEmptyState(searchQ || activeOnly ? 'לא נמצאו פעילויות לסינון זה' : 'אין פעילויות')
      : `<div class="ci-list">${renderGroups(groups)}</div>`;

    const activeLbl = activeOnly ? 'פעילים בלבד' : 'כולל לא פעילים';
    const activeChk = activeOnly ? 'checked' : '';

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      <div class="ds-screen-top-row">
        <input
          id="instructors-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש לפי מדריך / פעילות / בית ספר / רשות..."
          value="${escapeHtml(searchQ)}"
          dir="rtl"
        />
        <label class="ds-toggle-label" dir="rtl">
          <input type="checkbox" id="instructors-active-only" ${activeChk} />
          ${escapeHtml(activeLbl)}
        </label>
      </div>
      ${dsCard({
        title: `מדריכים · ${groups.size} | פעילויות · ${filtered.length}${activeOnly && totalCount !== activeCount ? ` (מתוך ${totalCount})` : ''}`,
        body: bodyHtml,
        padded: filtered.length === 0
      })}
    `);
  },
  bind({ root, data, state, ui, rerender }) {
    bindActNavGrid(root, { state, rerender });
    const allRows = Array.isArray(data?.rows) ? data.rows : [];

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

    root.querySelectorAll('[data-instr-row]').forEach((rowEl) => {
      const key = rowEl.dataset.instrRow;
      const open = () => {
        const row = findRowByKey(allRows, key);
        if (!row || !ui) return;
        const title = [row.activity_name, row.school].filter(Boolean).join(' — ');
        ui.openDrawer({ title, content: activityDrawerHtml(row) });
      };
      rowEl.addEventListener('click', open);
      rowEl.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });
  }
};

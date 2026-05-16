import { escapeHtml } from './shared/html.js';
import { dsCard, dsScreenStack, dsEmptyState } from './shared/layout.js';
import { formatDateHe } from './shared/format-date.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters,
  splitVisibleRows
} from './shared/activity-list-filters.js';

const INSTRUCTORS_SCOPE = 'instructors';
const INSTRUCTOR_FILTER_FIELDS = [{
  key: 'activity_manager',
  label: 'מנהל פעילות',
  getValues: (row) => Array.isArray(row.activity_managers) ? row.activity_managers : (row.activity_manager ? [row.activity_manager] : [])
}];

function applyActiveFilter(rows) {
  return rows.filter((r) => (r.programs_count || 0) + (r.one_day_count || 0) > 0);
}

const HEBREW_MONTH_NAMES = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];

function ymLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m) return ym;
  return `${HEBREW_MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

function toYm(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function nextYm(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
}

function buildMonthOptions(minYm, maxYm) {
  const opts = [];
  let cur = minYm;
  let guard = 0;
  while (cur <= maxYm && guard++ < 120) {
    opts.push({ value: cur, label: ymLabel(cur) });
    cur = nextYm(cur);
  }
  return opts;
}

function applyDateFilter(rows, fromYm, toYm_) {
  if (!fromYm && !toYm_) return rows;
  return rows.filter((r) => {
    const startYm = toYm(r.earliest_start_date || '');
    const endYm   = toYm(r.latest_end_date     || '');
    if (!startYm && !endYm) return false;
    const rowEndYm   = endYm   || startYm;
    const rowStartYm = startYm || endYm;
    if (toYm_  && rowStartYm > toYm_)  return false;
    if (fromYm && rowEndYm   < fromYm) return false;
    return true;
  });
}

function globalDateRange(rows) {
  let min = '', max = '';
  rows.forEach((r) => {
    const s = toYm(r.earliest_start_date || '');
    const e = toYm(r.latest_end_date     || '');
    if (s && (!min || s < min)) min = s;
    if (e && (!max || e > max)) max = e;
  });
  return { min, max };
}


function currentYm() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function resolveInstructorDetailsTargetYm(selectedYm) {
  const candidate = String(selectedYm || '').trim().slice(0, 7);
  return /^\d{4}-\d{2}$/.test(candidate) ? candidate : currentYm();
}

function normalizeInstructorIdentity(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function instructorMatchesActivity(row, empId, instrName) {
  const targetEmpId = String(empId || '').trim();
  const normalizedTargets = new Set([
    normalizeInstructorIdentity(instrName),
    normalizeInstructorIdentity(empId)
  ].filter(Boolean));

  if (targetEmpId && (String(row.emp_id || '').trim() === targetEmpId || String(row.emp_id_2 || '').trim() === targetEmpId)) {
    return true;
  }

  return [row.instructor_name, row.instructor_name_2].some((value) => {
    const normalized = normalizeInstructorIdentity(value);
    return normalized && normalizedTargets.has(normalized);
  });
}

function activityHasMeetingInMonth(row, targetYm) {
  let hasMeetingDate = false;
  let hasMeetingInTargetMonth = false;
  for (let i = 1; i <= 35; i++) {
    const d = String((row[`date_${i}`] || row[`Date${i}`]) || '').trim();
    if (!d) continue;
    hasMeetingDate = true;
    if (d.startsWith(targetYm)) hasMeetingInTargetMonth = true;
  }
  return { hasMeetingDate, hasMeetingInTargetMonth };
}

function activityOverlapsFallbackMonth(row, targetYm) {
  const startYm = toYm(row.start_date || '');
  const endYm = toYm(row.end_date || '');
  if (!startYm && !endYm) return false;
  const rowStartYm = startYm || endYm;
  const rowEndYm = endYm || startYm;
  return rowStartYm <= targetYm && rowEndYm >= targetYm;
}

function activityInDetailsMonth(row, targetYm) {
  if (!targetYm) return true;
  const { hasMeetingDate, hasMeetingInTargetMonth } = activityHasMeetingInMonth(row, targetYm);
  if (hasMeetingDate) return hasMeetingInTargetMonth;
  return activityOverlapsFallbackMonth(row, targetYm);
}

export function buildInstructorActivityDetailsForMonth(allRows, { empId, instrName, targetYm } = {}) {
  const items = [];
  const seenRowIds = new Set();
  (Array.isArray(allRows) ? allRows : []).forEach((r) => {
    if (String(r.status || '').trim() === 'סגור') return;
    if (!instructorMatchesActivity(r, empId, instrName)) return;
    if (!activityInDetailsMonth(r, targetYm)) return;

    const rowId = String(r.row_id || r.RowID || '').trim();
    if (rowId) {
      if (seenRowIds.has(rowId)) return;
      seenRowIds.add(rowId);
    }

    items.push({
      activity_name: String(r.activity_name || '—'),
      school:        String(r.school || '—'),
      authority:     String(r.authority || '—')
    });
  });
  return items;
}

function instructorTypeIcon(icon) {
  const S = (d) => `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const map = {
    book:        S('<path d="M3 2.5C4.5 2 6.5 2 8 3V14C6.5 13 4.5 13 3 13.5V2.5z"/><path d="M13 2.5C11.5 2 9.5 2 8 3V14C9.5 13 11.5 13 13 13.5V2.5z"/>'),
    pin:         S('<path d="M8 1.5a4 4 0 0 1 4 4c0 4-4 9-4 9s-4-5-4-9a4 4 0 0 1 4-4z"/><circle cx="8" cy="5.5" r="1.4"/>'),
    bulb:        S('<path d="M8 2a4 4 0 0 1 2.8 6.8L11 10H5l.2-1.2A4 4 0 0 1 8 2z"/><line x1="6.5" y1="12" x2="9.5" y2="12"/><line x1="7" y1="14" x2="9" y2="14"/>'),
    schoolClock: S('<circle cx="8" cy="8" r="6"/><polyline points="8 4.5 8 8 10.5 9.5"/>'),
  };
  return map[icon] || '';
}

const TYPE_ITEMS = [
  { keys: ['course', 'קורס', 'קורסים'],                                                  label: 'קורסים',    icon: 'book'        },
  { keys: ['tour', 'סיור', 'סיורים'],                                                     label: 'סיורים',    icon: 'pin'         },
  { keys: ['workshop', 'סדנה', 'סדנאות'],                                                 label: 'סדנאות',    icon: 'bulb'        },
  { keys: ['after_school', 'after school', 'afterschool', 'חוג אפטרסקול', 'אפטרסקול'], label: 'אפטרסקול', icon: 'schoolClock' },
];

function renderInstructorRow(row) {
  const name       = escapeHtml(row.full_name || row.emp_id || '—');
  const empId      = String(row.emp_id || '').trim();
  const typeCounts = row.activity_type_counts || {};

  const statCells = TYPE_ITEMS.map(({ keys, label, icon }) => {
    const count = keys.reduce((sum, key) => sum + Number(typeCounts[key] || 0), 0);
    return `<span class="instr-stat" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}: ${count}"><span class="instr-stat__icon">${instructorTypeIcon(icon)}</span><span class="instr-stat__num">${count}</span></span>`;
  }).join('');

  return `<article class="instr-card" data-instructor-item="${escapeHtml(empId)}">
    <button type="button" class="ci-row instr-summary-row" dir="rtl" data-instructor-card="${escapeHtml(empId)}" data-instructor-name="${name}">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        <span class="instr-stats">${statCells}</span>
      </div>
    </button>
  </article>`;
}

function buildPopupHtml(name, items) {
  let bodyHtml;
  if (!items) {
    bodyHtml = '<p class="instr-popup__empty">טוען…</p>';
  } else if (items.length === 0) {
    bodyHtml = '<p class="instr-popup__empty">אין פעילויות משויכות.</p>';
  } else {
    const rows = items.map((it) => `<tr>
      <td class="instr-pt__name">${escapeHtml(String(it.activity_name || '—'))}</td>
      <td class="instr-pt__school">${escapeHtml(String(it.school || '—'))}</td>
      <td class="instr-pt__authority">${escapeHtml(String(it.authority || '—'))}</td>
    </tr>`).join('');
    bodyHtml = `<table class="instr-popup-table" dir="rtl">
      <thead><tr>
        <th>פעילות</th><th>בית ספר</th><th>רשות</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
  return `<div class="instr-popup-overlay ds-instructors-screen" id="instr-popup-overlay" role="dialog" aria-modal="true" dir="rtl">
    <div class="instr-popup" id="instr-popup">
      <div class="instr-popup__head">
        <span class="instr-popup__name">${name}</span>
        <button type="button" class="instr-popup__close" id="instr-popup-close" aria-label="סגור">✕</button>
      </div>
      <div class="instr-popup__body">${bodyHtml}</div>
    </div>
  </div>`;
}

function removePopup() {
  document.getElementById('instr-popup-overlay')?.remove();
}

function openPopup(name, items) {
  removePopup();
  document.body.insertAdjacentHTML('beforeend', buildPopupHtml(name, items));
  const overlay = document.getElementById('instr-popup-overlay');
  overlay.addEventListener('click', (e) => { if (e.target === overlay) removePopup(); });
  document.getElementById('instr-popup-close')?.addEventListener('click', removePopup);
  const onKey = (e) => { if (e.key === 'Escape') { removePopup(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
}

function updatePopupBody(items, name) {
  const overlay = document.getElementById('instr-popup-overlay');
  if (!overlay) return;
  const popup = document.getElementById('instr-popup');
  if (!popup) return;
  popup.querySelector('.instr-popup__name').textContent = name || '';
  const body = popup.querySelector('.instr-popup__body');
  if (!body) return;
  if (items.length === 0) {
    body.innerHTML = '<p class="instr-popup__empty">אין פעילויות משויכות.</p>';
  } else {
    const rows = items.map((it) => `<tr>
      <td class="instr-pt__name">${escapeHtml(String(it.activity_name || '—'))}</td>
      <td class="instr-pt__school">${escapeHtml(String(it.school || '—'))}</td>
      <td class="instr-pt__authority">${escapeHtml(String(it.authority || '—'))}</td>
    </tr>`).join('');
    body.innerHTML = `<table class="instr-popup-table" dir="rtl">
      <thead><tr><th>פעילות</th><th>בית ספר</th><th>רשות</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }
}

function monthFilterBarHtml(fromYm, minYm, maxYm) {
  if (!minYm || !maxYm) return '';
  const opts = buildMonthOptions(minYm, maxYm);
  const blankOpt = '<option value="">— כל התקופה —</option>';
  const fromOpts = opts.map((o) =>
    `<option value="${escapeHtml(o.value)}"${o.value === fromYm ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
  ).join('');
  const clearBtn = fromYm
    ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-instr-date-clear title="נקה סינון חודש">✕</button>`
    : '';
  return `<div class="instr-date-filter" dir="rtl">
    <select class="ds-input ds-input--sm" data-instr-month-from>${blankOpt}${fromOpts}</select>
    ${clearBtn}
  </div>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),

  render(data, { state } = {}) {
    const allRows  = Array.isArray(data?.rows) ? data.rows : [];
    prepareRowsForSearch(allRows, [
      'full_name', 'name', 'instructor_name', 'emp_id', 'employee_id', 'EmployeeID',
      'activity_name', 'activity_type', 'activity_manager', 'authority', 'school',
      'status', 'start_date', 'end_date', 'earliest_start_date', 'latest_end_date',
      'mobile', 'phone', 'email', 'employment_type', 'direct_manager',
      (row) => (Array.isArray(row.activity_managers) ? row.activity_managers : []).join(' '),
      (row) => (Array.isArray(row.authorities) ? row.authorities : []).join(' '),
      (row) => (Array.isArray(row.schools) ? row.schools : []).join(' '),
      (row) => (Array.isArray(row.activity_names) ? row.activity_names : []).join(' '),
      (row) => (Array.isArray(row.activity_types) ? row.activity_types : []).join(' '),
      (row) => row.activity_type_counts ? Object.keys(row.activity_type_counts).join(' ') : ''
    ]);
    const filters = ensureActivityListFilters(state, INSTRUCTORS_SCOPE);

    const activeRows = applyActiveFilter(allRows);
    const locallyFiltered = applyLocalFilters(activeRows, filters, { filterFields: INSTRUCTOR_FILTER_FIELDS });

    const instrState = state._instrDateFilter = state._instrDateFilter || {};
    const dateFrom = instrState.from || '';

    const { min: globalMin, max: globalMax } = globalDateRange(activeRows);

    const filtered = applyDateFilter(locallyFiltered, dateFrom, '');
    const { visible: visibleRows, hasMore, nextCount } = splitVisibleRows(filtered, filters);

    const toolbarHtml = filtersToolbarHtml(INSTRUCTORS_SCOPE, activeRows, state, {
      filterFields: INSTRUCTOR_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש לפי שם מדריך / מזהה / מנהל / רשות / בית ספר…'
    });

    const mappingWarning = data && data.activities_loaded === false
      ? '<p class="ds-muted" role="status">נתוני הפעילויות לא נטענו, ולכן לא ניתן לחשב שיוך מדריכים.</p>'
      : '';
    const bodyHtml = visibleRows.length === 0
      ? dsEmptyState(filters.q || dateFrom ? 'לא נמצאו מדריכים לסינון זה' : 'אין נתוני מדריכים')
      : `${mappingWarning}<div class="ci-list ci-list--instr-grid">${visibleRows.map((row) => renderInstructorRow(row)).join('')}</div>${
        hasMore ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${INSTRUCTORS_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>` : ''
      }`;

    const pageHeader = `<div class="instr-page-header" dir="rtl"><span class="instr-page-header__title">מדריכים פעילים</span><span class="instr-page-header__count">${filtered.length} מדריכים</span></div>`;

    return dsScreenStack(`
      <section class="ds-screen-compact-90 instr-page ds-instructors-screen">
      ${pageHeader}
      <div class="ds-screen-top-row">
        ${toolbarHtml}
      </div>
      ${monthFilterBarHtml(dateFrom, globalMin, globalMax)}
      ${dsCard({ title: '', body: bodyHtml, padded: filtered.length === 0 })}
      </section>
    `);
  },

  bind({ root, data, state, rerender, api }) {
    bindLocalFilters(root, state, INSTRUCTORS_SCOPE, rerender, { debounceMs: 150 });
    root.querySelector(`[data-list-show-more="${INSTRUCTORS_SCOPE}"]`)?.addEventListener('click', (ev) => {
      ensureActivityListFilters(state, INSTRUCTORS_SCOPE).visibleCount = Number(ev.currentTarget?.dataset?.nextCount || 200);
      rerender();
    });

    const instrState = state._instrDateFilter = state._instrDateFilter || {};

    const fromSel  = root.querySelector('[data-instr-month-from]');
    const clearBtn = root.querySelector('[data-instr-date-clear]');

    if (fromSel) {
      fromSel.addEventListener('change', () => {
        instrState.from = fromSel.value || '';
        rerender();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        instrState.from = '';
        rerender();
      });
    }

    state.instructorsActivityDetailsCache = state.instructorsActivityDetailsCache || {};

    root.querySelectorAll('[data-instructor-card]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const empId      = String(btn.dataset.instructorCard || '').trim();
        const instrName  = String(btn.dataset.instructorName || '').trim();
        if (!empId) return;

        const targetYm = resolveInstructorDetailsTargetYm(instrState.from);
        const cacheKey = `${empId}:${targetYm}`;
        const cached = state.instructorsActivityDetailsCache[cacheKey];
        if (Array.isArray(cached)) {
          openPopup(instrName, cached);
          return;
        }

        openPopup(instrName, null);

        try {
          const cachedActivities = state?.screenDataCache?.['activities:all']?.data;
          const res = cachedActivities || await api.activities({ activity_type: 'all' });
          const allRows = Array.isArray(res?.rows) ? res.rows : [];
          const items = buildInstructorActivityDetailsForMonth(allRows, { empId, instrName, targetYm });

          state.instructorsActivityDetailsCache[cacheKey] = items;
          updatePopupBody(items, instrName);
        } catch (_e) {
          state.instructorsActivityDetailsCache[cacheKey] = [];
          updatePopupBody([], instrName);
        }
      });
    });
  }
};

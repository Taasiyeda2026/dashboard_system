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

function applyDateFilter(rows, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return rows;
  return rows.filter((r) => {
    const start = r.earliest_start_date || '';
    const end   = r.latest_end_date     || '';
    if (!start && !end) return false;
    const rowEnd   = end   || start;
    const rowStart = start || end;
    if (dateTo   && rowStart > dateTo)   return false;
    if (dateFrom && rowEnd   < dateFrom) return false;
    return true;
  });
}

function globalDateRange(rows) {
  let min = '', max = '';
  rows.forEach((r) => {
    const s = r.earliest_start_date || '';
    const e = r.latest_end_date     || '';
    if (s && (!min || s < min)) min = s;
    if (e && (!max || e > max)) max = e;
  });
  return { min, max };
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
  return `<div class="instr-popup-overlay" id="instr-popup-overlay" role="dialog" aria-modal="true" dir="rtl">
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

function dateFilterBarHtml(dateFrom, dateTo, globalMin, globalMax) {
  const minAttr = globalMin ? ` min="${escapeHtml(globalMin)}"` : '';
  const maxAttr = globalMax ? ` max="${escapeHtml(globalMax)}"` : '';
  const fromVal = dateFrom ? ` value="${escapeHtml(dateFrom)}"` : '';
  const toVal   = dateTo   ? ` value="${escapeHtml(dateTo)}"` : '';
  const hasDates = dateFrom || dateTo;
  const clearBtn = hasDates
    ? `<button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-instr-date-clear title="נקה סינון תאריכים">✕ נקה</button>`
    : '';
  return `<div class="instr-date-filter" dir="rtl" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:6px 0;">
    <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;">
      <span class="ds-muted">מ-</span>
      <input type="date" class="ds-input ds-input--sm" data-instr-date-from${fromVal}${minAttr}${maxAttr} style="width:140px">
    </label>
    <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;">
      <span class="ds-muted">עד-</span>
      <input type="date" class="ds-input ds-input--sm" data-instr-date-to${toVal}${minAttr}${maxAttr} style="width:140px">
    </label>
    ${clearBtn}
  </div>`;
}

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),

  render(data, { state } = {}) {
    const allRows  = Array.isArray(data?.rows) ? data.rows : [];
    prepareRowsForSearch(allRows, [
      'full_name', 'emp_id',
      (row) => (Array.isArray(row.activity_managers) ? row.activity_managers : []).join(' '),
      (row) => (Array.isArray(row.authorities) ? row.authorities : []).join(' '),
      (row) => (Array.isArray(row.schools) ? row.schools : []).join(' '),
      (row) => (Array.isArray(row.activity_names) ? row.activity_names : []).join(' '),
      'authority', 'school', 'activity_name'
    ]);
    const filters = ensureActivityListFilters(state, INSTRUCTORS_SCOPE);

    const activeRows = applyActiveFilter(allRows);
    const locallyFiltered = applyLocalFilters(activeRows, filters, { filterFields: INSTRUCTOR_FILTER_FIELDS });

    const instrState = state._instrDateFilter = state._instrDateFilter || {};
    const dateFrom = instrState.from || '';
    const dateTo   = instrState.to   || '';

    const { min: globalMin, max: globalMax } = globalDateRange(activeRows);

    const filtered = applyDateFilter(locallyFiltered, dateFrom, dateTo);
    const { visible: visibleRows, hasMore, nextCount } = splitVisibleRows(filtered, filters);

    const toolbarHtml = filtersToolbarHtml(INSTRUCTORS_SCOPE, activeRows, state, {
      filterFields: INSTRUCTOR_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש לפי שם מדריך / מזהה / מנהל / רשות / בית ספר…'
    });

    const mappingWarning = data && data.activities_loaded === false
      ? '<p class="ds-muted" role="status">נתוני הפעילויות לא נטענו, ולכן לא ניתן לחשב שיוך מדריכים.</p>'
      : '';
    const bodyHtml = visibleRows.length === 0
      ? dsEmptyState(filters.q || dateFrom || dateTo ? 'לא נמצאו מדריכים לסינון זה' : 'אין נתוני מדריכים')
      : `${mappingWarning}<div class="ci-list ci-list--instr-grid">${visibleRows.map((row) => renderInstructorRow(row)).join('')}</div>${
        hasMore ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${INSTRUCTORS_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>` : ''
      }`;

    const pageHeader = `<div class="instr-page-header" dir="rtl"><span class="instr-page-header__title">מדריכים פעילים</span><span class="instr-page-header__count">${filtered.length} מדריכים</span></div>`;

    return dsScreenStack(`
      <section class="ds-screen-compact-90 instr-page">
      ${pageHeader}
      <div class="ds-screen-top-row">
        ${toolbarHtml}
      </div>
      ${dateFilterBarHtml(dateFrom, dateTo, globalMin, globalMax)}
      ${dsCard({ title: '', body: bodyHtml, padded: filtered.length === 0 })}
      </section>
    `);
  },

  bind({ root, data, state, rerender, api }) {
    bindLocalFilters(root, state, INSTRUCTORS_SCOPE, rerender, { debounceMs: 300 });
    root.querySelector(`[data-list-show-more="${INSTRUCTORS_SCOPE}"]`)?.addEventListener('click', (ev) => {
      ensureActivityListFilters(state, INSTRUCTORS_SCOPE).visibleCount = Number(ev.currentTarget?.dataset?.nextCount || 200);
      rerender();
    });

    const instrState = state._instrDateFilter = state._instrDateFilter || {};

    const fromInput = root.querySelector('[data-instr-date-from]');
    const toInput   = root.querySelector('[data-instr-date-to]');
    const clearBtn  = root.querySelector('[data-instr-date-clear]');

    if (fromInput) {
      fromInput.addEventListener('change', () => {
        instrState.from = fromInput.value || '';
        rerender();
      });
    }
    if (toInput) {
      toInput.addEventListener('change', () => {
        instrState.to = toInput.value || '';
        rerender();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        instrState.from = '';
        instrState.to   = '';
        rerender();
      });
    }

    state.instructorsActivityDetailsCache = state.instructorsActivityDetailsCache || {};

    root.querySelectorAll('[data-instructor-card]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const empId      = String(btn.dataset.instructorCard || '').trim();
        const instrName  = String(btn.dataset.instructorName || '').trim();
        if (!empId) return;

        const cached = state.instructorsActivityDetailsCache[empId];
        if (Array.isArray(cached)) {
          openPopup(instrName, cached);
          return;
        }

        openPopup(instrName, null);

        try {
          const cachedActivities = state?.screenDataCache?.['activities:all']?.data;
          const res = cachedActivities || await api.activities({ activity_type: 'all' });
          const allRows = Array.isArray(res?.rows) ? res.rows : [];
          const ym = String(res?.ym || '').slice(0, 7);

          const myRows = allRows.filter((r) => {
            if (String(r.status || '').trim() === 'סגור') return false;
            return String(r.emp_id || '').trim() === empId || String(r.emp_id_2 || '').trim() === empId;
          });

          const items = [];
          const seen = new Set();
          myRows.forEach((r) => {
            const isLong = String(r.activity_family || '').trim() === 'program';
            if (!isLong && ym && !String(r.start_date || '').startsWith(ym)) return;
            if (isLong && ym) {
              let hasMeeting = false;
              for (let i = 1; i <= 35; i++) {
                const d = String((r[`date_${i}`] || r[`Date${i}`]) || '').trim();
                if (d && d.startsWith(ym)) { hasMeeting = true; break; }
              }
              if (!hasMeeting) return;
            }
            const key = `${r.activity_name}|${r.school}|${r.authority}`;
            if (seen.has(key)) return;
            seen.add(key);
            items.push({
              activity_name: String(r.activity_name || '—'),
              school:        String(r.school || '—'),
              authority:     String(r.authority || '—')
            });
          });

          state.instructorsActivityDetailsCache[empId] = items;
          updatePopupBody(items, instrName);
        } catch (_e) {
          state.instructorsActivityDetailsCache[empId] = [];
          updatePopupBody([], instrName);
        }
      });
    });
  }
};

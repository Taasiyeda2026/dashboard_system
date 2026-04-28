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
const INSTRUCTOR_FILTER_FIELDS = [{ key: 'activity_manager', label: 'מנהל פעילות' }];

function applyActiveFilter(rows, activeOnly) {
  if (!activeOnly) return rows;
  return rows.filter((r) => (r.programs_count || 0) + (r.one_day_count || 0) > 0);
}

function renderInstructorRow(row, state) {
  const name       = escapeHtml(row.full_name || row.emp_id || '—');
  const empId      = String(row.emp_id || '').trim();
  const endDate    = row.latest_end_date ? formatDateHe(row.latest_end_date) : '';
  const programs   = row.programs_count || 0;
  const oneDay     = row.one_day_count  || 0;
  const hasActivity = (programs + oneDay) > 0;
  const inactiveClass = hasActivity ? '' : ' ci-row--inactive';

  const statsHtml = `<span class="instr-stats">
    <span class="instr-stat"><span class="instr-stat__lbl">תוכניות</span><span class="instr-stat__num">${programs}</span></span>
    <span class="instr-stat"><span class="instr-stat__lbl">חד-יומיות</span><span class="instr-stat__num">${oneDay}</span></span>
    <span class="instr-stat"><span class="instr-stat__lbl">תאריך אחרון</span><span class="instr-stat__num instr-stat__num--date">${escapeHtml(endDate || '—')}</span></span>
  </span>`;

  return `<article class="instr-card" data-instructor-item="${escapeHtml(empId)}">
    <button type="button" class="ci-row instr-summary-row${inactiveClass}" dir="rtl" data-instructor-card="${escapeHtml(empId)}" data-instructor-name="${name}">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        ${statsHtml}
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

export const instructorsScreen = {
  load: ({ api }) => api.instructors(),

  render(data, { state } = {}) {
    const allRows  = Array.isArray(data?.rows) ? data.rows : [];
    const ym       = data?.ym || '';
    prepareRowsForSearch(allRows, ['full_name', 'emp_id', 'activity_manager', 'authority', 'school', 'activity_name']);
    const filters = ensureActivityListFilters(state, INSTRUCTORS_SCOPE);
    const activeOnly = state?.instructorsActiveOnly !== false;

    const locallyFiltered = applyLocalFilters(allRows, filters, { filterFields: INSTRUCTOR_FILTER_FIELDS });
    const filtered  = applyActiveFilter(locallyFiltered, activeOnly);
    const totalAll  = locallyFiltered.length;
    const { visible: visibleRows, hasMore, nextCount } = splitVisibleRows(filtered, filters);
    const toolbarHtml = filtersToolbarHtml(INSTRUCTORS_SCOPE, allRows, state, {
      filterFields: INSTRUCTOR_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש לפי שם מדריך / מזהה / מנהל / רשות / בית ספר…'
    });

    const ymLabel = ym ? ym.slice(0, 7) : '';
    const activeChk = activeOnly ? 'checked' : '';

    const bodyHtml = visibleRows.length === 0
      ? dsEmptyState(filters.q || activeOnly ? 'לא נמצאו מדריכים לסינון זה' : 'אין נתוני מדריכים')
      : `<div class="ci-list ci-list--instr-grid">${visibleRows.map((row) => renderInstructorRow(row, state)).join('')}</div>${
        hasMore ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${INSTRUCTORS_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>` : ''
      }`;

    const subtitle = ymLabel
      ? `מדריכים · ${filtered.length}${activeOnly && totalAll !== filtered.length ? ` (מתוך ${totalAll})` : ''} · חודש ${ymLabel}`
      : `מדריכים · ${filtered.length}`;

    return dsScreenStack(`
      <div class="ds-screen-top-row">
        ${toolbarHtml}
        <label class="ds-toggle-label" dir="rtl">
          <input type="checkbox" id="instructors-active-only" ${activeChk} />
          פעילים החודש בלבד
        </label>
      </div>
      ${dsCard({ title: subtitle, body: bodyHtml, padded: filtered.length === 0 })}
    `);
  },

  bind({ root, data, state, rerender, api }) {
    bindLocalFilters(root, state, INSTRUCTORS_SCOPE, rerender, { debounceMs: 300 });
    root.querySelector(`[data-list-show-more="${INSTRUCTORS_SCOPE}"]`)?.addEventListener('click', (ev) => {
      ensureActivityListFilters(state, INSTRUCTORS_SCOPE).visibleCount = Number(ev.currentTarget?.dataset?.nextCount || 200);
      rerender();
    });

    root.querySelector('#instructors-active-only')?.addEventListener('change', (ev) => {
      state.instructorsActiveOnly = ev.target.checked;
      rerender();
    });

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
            const isLong = String(r.source_sheet || '').trim() === 'data_long';
            if (!isLong && ym && !String(r.start_date || '').startsWith(ym)) return;
            if (isLong && ym) {
              let hasMeeting = false;
              for (let i = 1; i <= 35; i++) {
                const d = String(r[`Date${i}`] || '').trim();
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

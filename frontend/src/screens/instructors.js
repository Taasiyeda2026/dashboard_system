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

function renderInstructorRow(row, state, detailsCache) {
  const name       = escapeHtml(row.full_name || row.emp_id || '—');
  const empId      = String(row.emp_id || '').trim();
  const endDate    = row.latest_end_date ? formatDateHe(row.latest_end_date) : '';
  const programs   = row.programs_count || 0;
  const oneDay     = row.one_day_count  || 0;
  const hasActivity = (programs + oneDay) > 0;
  const inactiveClass = hasActivity ? '' : ' ci-row--inactive';
  const expandedEmpId = String(state?.instructorsExpandedEmpId || '').trim();
  const isExpanded = !!empId && expandedEmpId === empId;
  const cachedDetails = Array.isArray(detailsCache?.[empId]) ? detailsCache[empId] : null;
  const isLoading = String(state?.instructorsDetailsLoadingEmpId || '') === empId;

  const statsHtml = `<span class="instr-stats">
    <span class="instr-stat"><span class="instr-stat__lbl">תוכניות</span><span class="instr-stat__num">${programs}</span></span>
    <span class="instr-stat"><span class="instr-stat__lbl">חד-יומיות</span><span class="instr-stat__num">${oneDay}</span></span>
    <span class="instr-stat"><span class="instr-stat__lbl">תאריך אחרון</span><span class="instr-stat__num instr-stat__num--date">${escapeHtml(endDate || '—')}</span></span>
  </span>`;

  const detailsHtml = !isExpanded
    ? ''
    : `<div class="instr-card-details" dir="rtl" data-instructor-details="${escapeHtml(empId)}">
      ${isLoading
        ? '<p class="ds-muted">טוען פעילויות…</p>'
        : !cachedDetails
          ? '<p class="ds-muted">אין נתונים להצגה.</p>'
          : cachedDetails.length
            ? `<ul class="instr-act-list">${cachedDetails.map((item) => `<li class="instr-act-item">${item}</li>`).join('')}</ul>`
            : '<p class="ds-muted">אין פעילויות משויכות.</p>'}
    </div>`;

  return `<article class="instr-card${isExpanded ? ' is-expanded' : ''}" data-instructor-item="${escapeHtml(empId)}">
    <button type="button" class="ci-row instr-summary-row${inactiveClass}" dir="rtl" data-instructor-card="${escapeHtml(empId)}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="instructor-details-${escapeHtml(empId)}">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        ${statsHtml}
      </div>
    </button>
    ${detailsHtml}
  </article>`;
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

    const detailsCache = state?.instructorsActivityDetailsCache || {};
    const bodyHtml = visibleRows.length === 0
      ? dsEmptyState(filters.q || activeOnly ? 'לא נמצאו מדריכים לסינון זה' : 'אין נתוני מדריכים')
      : `<div class="ci-list ci-list--instr-grid">${visibleRows.map((row) => renderInstructorRow(row, state, detailsCache)).join('')}</div>${
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
        const empId = String(btn.dataset.instructorCard || '').trim();
        if (!empId) return;
        if (state.instructorsExpandedEmpId === empId) {
          state.instructorsExpandedEmpId = '';
          state.instructorsDetailsLoadingEmpId = '';
          rerender();
          return;
        }
        state.instructorsExpandedEmpId = empId;
        if (Array.isArray(state.instructorsActivityDetailsCache[empId])) {
          state.instructorsDetailsLoadingEmpId = '';
          rerender();
          return;
        }
        state.instructorsDetailsLoadingEmpId = empId;
        rerender();
        try {
          const cachedActivities = state?.screenDataCache?.['activities:all']?.data;
          const res = cachedActivities || await api.activities({ activity_type: 'all' });
          const allRows = Array.isArray(res?.rows) ? res.rows : [];
          const ym = String(res?.ym || '').slice(0, 7); // "YYYY-MM"

          const myRows = allRows.filter((r) => {
            if (String(r.status || '').trim() === 'סגור') return false;
            return String(r.emp_id || '').trim() === empId || String(r.emp_id_2 || '').trim() === empId;
          });

          const items = myRows.flatMap((r) => {
            const courseName = escapeHtml(String(r.activity_name || '—'));
            const school = escapeHtml(String(r.school || '—').trim() || '—');
            const authority = escapeHtml(String(r.authority || '—').trim() || '—');
            const metaHtml = `<span class="instr-act-meta">קורס: ${courseName} · בית ספר: ${school} · רשות: ${authority}</span>`;
            const isLong = String(r.source_sheet || '').trim() === 'data_long';
            if (!isLong) {
              if (ym && !String(r.start_date || '').startsWith(ym)) return [];
              return [`<li class="instr-act-item">${metaHtml}</li>`];
            }
            if (ym) {
              const meetings = [];
              for (let i = 1; i <= 35; i++) {
                const d = String(r[`Date${i}`] || '').trim();
                if (d && d.startsWith(ym)) meetings.push(i);
              }
              if (meetings.length === 0) return [];
              return meetings.map(
                (n) => `<li class="instr-act-item"><span class="instr-meeting-pill">מפגש ${n}</span> ${metaHtml}</li>`
              );
            }
            return [`<li class="instr-act-item">${metaHtml}</li>`];
          });

          state.instructorsActivityDetailsCache[empId] = items;
        } catch (_e) {
          state.instructorsActivityDetailsCache[empId] = [];
        } finally {
          state.instructorsDetailsLoadingEmpId = '';
          rerender();
        }
      });
    });
  }
};

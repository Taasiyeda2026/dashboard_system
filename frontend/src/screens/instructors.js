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

function renderInstructorRow(row) {
  const name       = escapeHtml(row.full_name || row.emp_id || '—');
  const endDate    = row.latest_end_date ? formatDateHe(row.latest_end_date) : '';
  const programs   = row.programs_count || 0;
  const oneDay     = row.one_day_count  || 0;
  const hasActivity = (programs + oneDay) > 0;
  const inactiveClass = hasActivity ? '' : ' ci-row--inactive';

  const statsHtml = `<span class="instr-stats">
    <span class="instr-stat"><span class="instr-stat__num">${programs}</span><span class="instr-stat__lbl">תוכניות</span></span>
    <span class="instr-stat__sep">·</span>
    <span class="instr-stat"><span class="instr-stat__num">${oneDay}</span><span class="instr-stat__lbl">חד-יומיות</span></span>
  </span>`;

  return `
    <button type="button" class="ci-row instr-summary-row${inactiveClass}" dir="rtl" data-instructor-card="${escapeHtml(String(row.emp_id || ''))}">
      <div class="ci-row__main">
        <span class="ci-row__name">${name}</span>
        ${statsHtml}
        ${endDate ? `<span class="instr-end-date">${escapeHtml(endDate)}</span>` : ''}
      </div>
    </button>`;
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
      : `<div class="ci-list ci-list--instr-grid">${visibleRows.map(renderInstructorRow).join('')}</div>${
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

  bind({ root, data, state, rerender, ui, api }) {
    bindLocalFilters(root, state, INSTRUCTORS_SCOPE, rerender, { debounceMs: 300 });
    root.querySelector(`[data-list-show-more="${INSTRUCTORS_SCOPE}"]`)?.addEventListener('click', (ev) => {
      ensureActivityListFilters(state, INSTRUCTORS_SCOPE).visibleCount = Number(ev.currentTarget?.dataset?.nextCount || 200);
      rerender();
    });

    root.querySelector('#instructors-active-only')?.addEventListener('change', (ev) => {
      state.instructorsActiveOnly = ev.target.checked;
      rerender();
    });

    root.querySelectorAll('[data-instructor-card]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const empId = String(btn.dataset.instructorCard || '').trim();
        if (!empId || !ui) return;
        ui.openDrawer({ title: 'מדריך', content: '<p class="ds-muted">טוען פעילויות…</p>' });
        try {
          const res = await api.activities({ activity_type: 'all' });
          const allRows = Array.isArray(res?.rows) ? res.rows : [];
          const ym = String(res?.ym || '').slice(0, 7); // "YYYY-MM"

          const myRows = allRows.filter((r) => {
            if (String(r.status || '').trim() === 'סגור') return false;
            return String(r.emp_id || '').trim() === empId || String(r.emp_id_2 || '').trim() === empId;
          });

          const items = myRows.flatMap((r) => {
            const name = escapeHtml(String(r.activity_name || '—'));
            const isLong = String(r.source_sheet || '').trim() === 'data_long';
            if (!isLong) {
              if (ym && !String(r.start_date || '').startsWith(ym)) return [];
              return [`<li class="instr-act-item">${name}</li>`];
            }
            if (ym) {
              const meetings = [];
              for (let i = 1; i <= 35; i++) {
                const d = String(r[`Date${i}`] || '').trim();
                if (d && d.startsWith(ym)) meetings.push(i);
              }
              if (meetings.length === 0) return [];
              return meetings.map(
                (n) => `<li class="instr-act-item">${name} <span class="instr-meeting-pill">מפגש ${n}</span></li>`
              );
            }
            return [`<li class="instr-act-item">${name}</li>`];
          });

          const list = items.length
            ? `<ul class="ds-summary-panel__list instr-act-list">${items.join('')}</ul>`
            : '<p class="ds-muted">אין פעילויות בחודש הנוכחי.</p>';
          ui.openDrawer({ title: 'פעילויות מדריך', content: list });
        } catch (_e) {
          ui.openDrawer({ title: 'פעילויות מדריך', content: '<p class="ds-muted">טעינת הפעילויות נכשלה.</p>' });
        }
      });
    });
  }
};

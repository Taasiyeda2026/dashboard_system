import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { visibleActivityCategoryLabel } from './shared/ui-hebrew.js';
import {
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState
} from './shared/layout.js';
import { activityWorkDrawerHtml, patchDrawerDatesSection } from './shared/activity-detail-html.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  normalizeText,
  splitVisibleRows
} from './shared/activity-list-filters.js';
import { activityManagerDisplayName, getRosterUsers } from './shared/activity-options.js';

const ARCHIVE_SCOPE = 'archive';
const ARCHIVE_SEARCH_DEBOUNCE_MS = 280;
const ARCHIVE_MIN_SEARCH_CHARS = 2;
const ARCHIVE_DEFAULT_VISIBLE_LIMIT = 200;

const ARCHIVE_TYPE_KPIS = [
  { label: 'קורסים',      keys: ['course', 'קורס', 'קורסים'],                                              color: 'blue'   },
  { label: 'סדנאות',      keys: ['workshop', 'סדנה', 'סדנאות'],                                           color: 'purple' },
  { label: 'סיורים',      keys: ['tour', 'סיור', 'סיורים'],                                               color: 'green'  },
  { label: 'אפטרסקול',   keys: ['after_school', 'after school', 'afterschool', 'חוג אפטרסקול', 'אפטרסקול'], color: 'orange' },
];

function archiveTypeKpiHtml(rows, activeLabel = '') {
  const cells = ARCHIVE_TYPE_KPIS.map(({ label, keys, color }) => {
    const count = rows.filter((r) => keys.includes(String(r.activity_type || '').trim())).length;
    const activeClass = activeLabel === label ? ' is-active' : '';
    return `<button type="button" class="ds-archive-kpi ds-archive-kpi--${color}${activeClass}" data-archive-kpi="${escapeHtml(label)}">
      <span class="ds-archive-kpi__value">${count}</span>
      <span class="ds-archive-kpi__label">${escapeHtml(label)}</span>
    </button>`;
  }).join('');
  return `<div class="ds-archive-kpi-row" dir="rtl">${cells}</div>`;
}

const ARCHIVE_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות', getValues: (row) => [activityManagerDisplayName(row?.activity_manager)] },
  { key: 'activity_type', label: 'סוג הפעילות', getOptionLabel: (value) => visibleActivityCategoryLabel(value) },
  { key: 'authority', label: 'רשות' }
];

const ARCHIVE_SEARCH_FIELDS = [
  'RowID', 'row_id', 'source_row_id',
  'activity_no', 'activity_number', 'activity_name', 'activity_type', 'activity_family',
  'activity_manager', 'manager_name',
  'instructor_name', 'instructor_name_2', 'Instructor', 'Instructor2',
  'emp_id', 'emp_id_2', 'EmployeeID', 'EmployeeID2',
  'authority', 'school', 'grade', 'class_group', 'group', 'class',
  'funding', 'status',
  'start_date', 'end_date', 'date_1', 'meeting_dates', 'date_cols',
  'notes', 'description',
  (row) => activityManagerDisplayName(row?.activity_manager),
  (row) => Array.from({ length: 30 }, (_, i) => row?.[`date_${i + 1}`]).filter(Boolean).join(' '),
  (row) => Array.isArray(row?.meeting_dates) ? row.meeting_dates.join(' ') : '',
  (row) => Array.isArray(row?.date_cols) ? row.date_cols.join(' ') : ''
];

const inflightDetailRequests = new Map();

function detailCacheKey(row) {
  return `archiveDetail:${row.source_sheet || ''}:${row.RowID || ''}`;
}
function datesCacheKey(row) {
  return `archiveDates:${row.source_sheet || ''}:${row.RowID || ''}`;
}

function instructorText(row) {
  const n1 = String(row?.instructor_name ?? '').trim();
  const n2 = String(row?.instructor_name_2 ?? '').trim();
  return [n1, n2].filter(Boolean).join(' · ') || '—';
}

function endYear(row) {
  const d = String(row?.end_date || row?.start_date || '').trim().slice(0, 4);
  return d || '—';
}

const ARCHIVE_FIXED_YEARS = ['2026', '2025'];

function todayIso() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function reopenModalHtml(today) {
  return `<div class="ds-perm-edit-form" dir="rtl" data-archive-reopen-form>
    <p class="ds-muted">כדי להחזיר את הפעילות לפעילה, יש לבחור תאריך התחלה חדש.<br>ניתן לבחור רק תאריך מהיום והלאה.</p>
    <label class="ds-perm-field">
      <span class="ds-muted">תאריך התחלה חדש</span>
      <input class="ds-input ds-input--sm" type="date" name="start_date" min="${escapeHtml(today)}" required data-reopen-start>
    </label>
    <label class="ds-perm-field">
      <span class="ds-muted">תאריך סיום חדש</span>
      <input class="ds-input ds-input--sm" type="date" name="end_date" min="${escapeHtml(today)}" data-reopen-end>
    </label>
    <p class="ds-muted" role="alert" data-reopen-error></p>
  </div>`;
}

function clearArchiveReopenCaches(state) {
  const prefixes = ['archive', 'archiveDetail:', 'archiveDates:', 'activities:', 'month:', 'week:', 'dashboard:'];
  Object.keys(state?.screenDataCache || {}).forEach((key) => {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
      delete state.screenDataCache[key];
    }
  });
}

function archiveEffectiveFilters(filters) {
  const rawSearch = Object.prototype.hasOwnProperty.call(filters || {}, 'appliedQ') ? filters.appliedQ : filters?.q;
  const normalizedSearch = normalizeText(rawSearch || '');
  return {
    ...(filters || {}),
    appliedQ: normalizedSearch.length >= ARCHIVE_MIN_SEARCH_CHARS ? rawSearch : ''
  };
}

function applyArchiveYearFilter(rows, state) {
  const year = String(state.archiveYear || '').trim();
  const list = Array.isArray(rows) ? rows : [];
  if (!year) return list.slice();
  return list.filter((row) => endYear(row) === year);
}

function applyArchiveFilters(rows, state) {
  const filters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
  let out = applyArchiveYearFilter(rows, state);
  const typeFilterLabel = String(state.archiveTypeFilter || '').trim();
  if (typeFilterLabel) {
    const matchType = ARCHIVE_TYPE_KPIS.find((k) => k.label === typeFilterLabel);
    if (matchType) out = out.filter((row) => matchType.keys.includes(String(row.activity_type || '').trim()));
  }
  return applyLocalFilters(out, archiveEffectiveFilters(filters), { filterFields: ARCHIVE_FILTER_FIELDS });
}

function archiveTableRowsHtml(rows) {
  return rows.map((row) => {
    const name = escapeHtml(row.activity_name || '—');
    const typeLabel = escapeHtml(visibleActivityCategoryLabel(row.activity_type));
    const authority = escapeHtml(row.authority || '—');
    const school = escapeHtml(row.school || '—');
    const instructor = escapeHtml(instructorText(row));
    const manager = escapeHtml(activityManagerDisplayName(row.activity_manager));
    const endRaw = String(row?.end_date || row?.start_date || '').trim();
    const endHe = endRaw ? (formatDateHe(endRaw) || endRaw) : '—';
    const startRaw = String(row?.start_date || '').trim();
    const startHe = startRaw ? (formatDateHe(startRaw) || startRaw) : '—';

    return `
      <tr class="ds-data-row ds-activities-row" data-list-item data-row-id="${escapeHtml(row.RowID)}">
        <td class="ds-activities-col ds-activities-col--program">
          <div class="ds-activities-program-cell">
            <strong class="ds-activities-program-name" title="${name}">${name}</strong>
            <span class="ds-activities-program-type">${typeLabel}</span>
          </div>
        </td>
        <td class="ds-activities-col ds-activities-col--authority">
          <span class="ds-activities-cell-ellipsis" title="${authority}">${authority}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--school">
          <span class="ds-activities-cell-ellipsis" title="${school}">${school}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--instructor">
          <span class="ds-activities-cell-ellipsis">${instructor}</span>
        </td>
        <td class="ds-activities-col ds-activities-col--manager ds-archive-col-manager">${escapeHtml(manager)}</td>
        <td class="ds-archive-date-col"><time class="ds-activities-date">${escapeHtml(startHe)}</time></td>
        <td class="ds-archive-date-col"><time class="ds-activities-date ds-archive-end-date">${escapeHtml(endHe)}</time></td>
      </tr>`;
  }).join('');
}

function renderArchiveTableSection(rows, state, allRowsCount = rows.length) {
  const listFilters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
  const { visible: safeRows, hasMore, nextCount } = splitVisibleRows(rows, listFilters);
  const emptyMsg = allRowsCount === 0
    ? 'אין פעילויות סגורות בארכיון'
    : 'לא נמצאו פעילויות התואמות לסינון';

  if (safeRows.length === 0) return dsEmptyState(emptyMsg);

  return dsTableWrap(`
      <table class="ds-table ds-table--interactive ds-table--activities-list ds-table--archive" dir="rtl">
        <colgroup>
          <col class="ds-activities-col--program">
          <col class="ds-activities-col--authority">
          <col class="ds-activities-col--school">
          <col class="ds-activities-col--instructor">
          <col class="ds-activities-col--manager">
          <col class="ds-activities-col--date">
          <col class="ds-activities-col--date">
        </colgroup>
        <thead>
          <tr>
            <th>תוכנית / סוג</th>
            <th>רשות</th>
            <th>בית ספר</th>
            <th>מדריך</th>
            <th class="ds-archive-col-manager">מנהל פעילות</th>
            <th>תאריך התחלה</th>
            <th>תאריך סיום</th>
          </tr>
        </thead>
        <tbody>${archiveTableRowsHtml(safeRows)}</tbody>
      </table>`) +
    (hasMore
      ? `<div style="display:flex;justify-content:center;padding:12px 0">
           <button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${ARCHIVE_SCOPE}" data-next-count="${nextCount}">הצג עוד</button>
         </div>`
      : '');
}

export const archiveScreen = {
  async load({ api }) {
    return api.archiveActivities();
  },

  render(data, { state }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    prepareRowsForSearch(allRows, ARCHIVE_SEARCH_FIELDS);
    const filteredRows = applyArchiveFilters(allRows, state);
    const listFilters = ensureActivityListFilters(state, ARCHIVE_SCOPE);

    const selectedYear = String(state.archiveYear || '').trim();
    const yearScopedRows = applyArchiveYearFilter(allRows, state);

    const yearBtns = [
      `<button type="button" class="ds-chip--tab${!selectedYear ? ' is-active' : ''}" data-archive-year="">הכל</button>`,
      ...ARCHIVE_FIXED_YEARS.map((y) =>
        `<button type="button" class="ds-chip--tab${selectedYear === y ? ' is-active' : ''}" data-archive-year="${escapeHtml(y)}">${escapeHtml(y)}</button>`
      )
    ].join('');

    const toolbar = `
      <div class="ds-activities-main-toolbar" dir="rtl" data-local-filters="${ARCHIVE_SCOPE}">
        <input type="search" class="ds-input ds-input--sm ds-activities-search-sm"
          data-filter-search="${ARCHIVE_SCOPE}"
          value="${escapeHtml(listFilters.q || '')}"
          placeholder="חיפוש"
          aria-label="חיפוש בארכיון" />
        <div class="ds-activities-main-toolbar__actions">
          <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost ds-btn--icon-only"
            data-filter-clear="${ARCHIVE_SCOPE}" aria-label="ניקוי סינון" title="ניקוי סינון">↻</button>
        </div>
      </div>`;

    const yearNav = `
      <div class="ds-toolbar ds-archive-year-nav" dir="rtl" data-archive-year-nav>
        ${yearBtns}
      </div>`;

    const titleRow = `
      <div class="ds-activities-title-row" dir="rtl">
        <h2 class="ds-activities-page-title">ארכיון פעילויות · ${filteredRows.length} פעילויות סגורות</h2>
      </div>`;

    const tableSection = `<div data-archive-table-section>${renderArchiveTableSection(filteredRows, state, allRows.length)}</div>`;

    return dsScreenStack(`
      <section class="ds-activities-screen ds-activities-screen--archive">
        ${titleRow}
        ${archiveTypeKpiHtml(yearScopedRows, String(state.archiveTypeFilter || '').trim())}
        ${yearNav}
        ${toolbar}
        ${dsCard({ body: tableSection, padded: false })}
      </section>`);
  },

  bind({ root, data, state, rerender, ui, api }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const canSeePrivateNotes = ['operation_manager', 'admin'].includes(state?.user?.display_role);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const settings = state?.clientSettings || {};
    const rosterUsers = getRosterUsers(settings);
    const instructorByEmpId = rosterUsers.reduce((acc, user) => {
      const empId = String(user?.emp_id || '').trim();
      const fullName = String(user?.name || '').trim();
      if (empId && fullName && !acc[empId]) acc[empId] = fullName;
      return acc;
    }, {});

    prepareRowsForSearch(allRows, ARCHIVE_SEARCH_FIELDS);

    const rerenderLocal = () => rerender();
    const tableContainer = root.querySelector('[data-archive-table-section]');
    let searchTimer;
    let searchFrame;

    const replaceArchiveView = () => {
      const filteredRows = applyArchiveFilters(allRows, state);
      const yearScopedRows = applyArchiveYearFilter(allRows, state);
      if (tableContainer) {
        tableContainer.innerHTML = renderArchiveTableSection(filteredRows, state, allRows.length);
      }
      const kpiRow = root.querySelector('.ds-archive-kpi-row');
      if (kpiRow) {
        kpiRow.outerHTML = archiveTypeKpiHtml(yearScopedRows, String(state.archiveTypeFilter || '').trim());
      }
      const titleEl = root.querySelector('.ds-activities-page-title');
      if (titleEl) {
        titleEl.textContent = `ארכיון פעילויות · ${filteredRows.length} פעילויות סגורות`;
      }
    };

    const scheduleTableFilter = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        if (searchFrame && typeof globalThis.cancelAnimationFrame === 'function') {
          globalThis.cancelAnimationFrame(searchFrame);
        }
        const run = () => {
          searchFrame = null;
          replaceArchiveView();
        };
        searchFrame = typeof globalThis.requestAnimationFrame === 'function'
          ? globalThis.requestAnimationFrame(run)
          : setTimeout(run, 0);
      }, ARCHIVE_SEARCH_DEBOUNCE_MS);
    };

    const searchInput = root.querySelector(`[data-filter-search="${ARCHIVE_SCOPE}"]`);
    searchInput?.addEventListener('input', (ev) => {
      const filters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
      const nextValue = ev.target?.value || '';
      const nextSearch = normalizeText(nextValue);
      const prevAppliedSearch = normalizeText(filters.appliedQ || '');
      filters.q = nextValue;

      if (nextSearch.length >= ARCHIVE_MIN_SEARCH_CHARS) {
        filters.appliedQ = nextValue;
        filters.visibleCount = ARCHIVE_DEFAULT_VISIBLE_LIMIT;
        scheduleTableFilter();
        return;
      }

      filters.appliedQ = '';
      if (prevAppliedSearch) {
        filters.visibleCount = ARCHIVE_DEFAULT_VISIBLE_LIMIT;
        scheduleTableFilter();
      }
    });

    root.querySelector(`[data-filter-clear="${ARCHIVE_SCOPE}"]`)?.addEventListener('click', () => {
      const filters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
      filters.q = '';
      filters.appliedQ = '';
      filters.visibleCount = ARCHIVE_DEFAULT_VISIBLE_LIMIT;
      state.archiveYear = '';
      rerenderLocal();
    });

    root.addEventListener('click', (ev) => {
      const showMoreBtn = ev.target.closest(`[data-list-show-more="${ARCHIVE_SCOPE}"]`);
      if (!showMoreBtn) return;
      const next = Number(showMoreBtn.dataset?.nextCount || ARCHIVE_DEFAULT_VISIBLE_LIMIT);
      ensureActivityListFilters(state, ARCHIVE_SCOPE).visibleCount = next;
      replaceArchiveView();
    });

    root.addEventListener('click', (ev) => {
      const yearBtn = ev.target.closest('[data-archive-year]');
      if (yearBtn) {
        state.archiveYear = String(yearBtn.dataset.archiveYear || '').trim();
        ensureActivityListFilters(state, ARCHIVE_SCOPE).visibleCount = ARCHIVE_DEFAULT_VISIBLE_LIMIT;
        rerenderLocal();
        return;
      }
      const kpiBtn = ev.target.closest('[data-archive-kpi]');
      if (kpiBtn) {
        const value = kpiBtn.dataset.archiveKpi || '';
        state.archiveTypeFilter = state.archiveTypeFilter === value ? '' : value;
        ensureActivityListFilters(state, ARCHIVE_SCOPE).visibleCount = ARCHIVE_DEFAULT_VISIBLE_LIMIT;
        replaceArchiveView();
      }
    });

    const canReopen = ['admin', 'operation_manager'].includes(state?.user?.display_role);

    async function openDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cachedDetail = state?.screenDataCache?.[detailCacheKey(summaryRow)]?.data;
      const cachedDates = state?.screenDataCache?.[datesCacheKey(summaryRow)]?.data;

      const drawerContent = (row, datesLoading) => {
        const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
        const reopenBtn = canReopen
          ? `<div style="padding:12px 16px 0;text-align:right">
               <button type="button" class="ds-btn ds-btn--sm ds-archive-reopen-btn" data-archive-reopen="${escapeHtml(String(row.RowID || ''))}">
                 🔓 פתח מחדש
               </button>
             </div>`
          : '';
        return reopenBtn + activityWorkDrawerHtml(row, {
          privateNote,
          canEdit: false,
          canDirectEdit: false,
          canRequestEdit: false,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          settings,
          showFinance: false,
          showFinanceFields: false,
          datesLoading
        });
      };

      if (cachedDetail) {
        ui.openDrawer({ title: '', content: drawerContent(cachedDetail, false), onOpen: (contentRoot) => { hideShellHeader(contentRoot); bindReopenBtn(contentRoot, cachedDetail); } });
        return;
      }

      const needDates = !cachedDates;
      ui.openDrawer({
        title: '',
        content: drawerContent(summaryRow, needDates),
        onOpen: (contentRoot) => { hideShellHeader(contentRoot); bindReopenBtn(contentRoot, summaryRow); },
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });

      if (cachedDates && !needDates) {
        const sectionEl = document.querySelector('[data-dates-section]');
        if (sectionEl) patchDrawerDatesSection(sectionEl, cachedDates);
      }

      if (needDates) {
        const srcRowId = summaryRow.source_row_id || summaryRow.RowID;
        const srcSheet = summaryRow.source_sheet || '';
        api.activityDates(srcRowId, srcSheet)
          .then((datesData) => {
            if (state?.screenDataCache) state.screenDataCache[datesCacheKey(summaryRow)] = { data: datesData, t: Date.now() };
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) patchDrawerDatesSection(sectionEl, datesData);
          })
          .catch(() => {
            const sectionEl = document.querySelector('[data-dates-section]');
            if (sectionEl) sectionEl.removeAttribute('data-dates-loading');
          });
      }

      const key = detailCacheKey(summaryRow);
      let request = inflightDetailRequests.get(key);
      if (!request) {
        request = api.activityDetail(summaryRow.RowID, summaryRow.source_sheet)
          .finally(() => inflightDetailRequests.delete(key));
        inflightDetailRequests.set(key, request);
      }
      request
        .then((rsp) => {
          const row = rsp?.row || summaryRow;
          if (state?.screenDataCache) state.screenDataCache[key] = { data: row, t: Date.now() };
        })
        .catch(() => {});
    }

    function hideShellHeader(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
    }

    function bindReopenBtn(contentRoot, row) {
      if (!canReopen) return;
      const btn = contentRoot.querySelector('[data-archive-reopen]');
      if (!btn) return;
      btn.addEventListener('click', () => {
        const today = todayIso();
        ui.openModal({
          title: 'פתיחה מחדש של פעילות',
          content: reopenModalHtml(today),
          actions: `
            <button type="button" class="ds-btn ds-btn--ghost" data-ui-close-modal>ביטול</button>
            <button type="button" class="ds-btn ds-btn--primary" data-archive-reopen-confirm>אישור פתיחה מחדש</button>
          `
        });

        const modal = document.querySelector('.ds-modal');
        const startInput = modal?.querySelector('[data-reopen-start]');
        const endInput = modal?.querySelector('[data-reopen-end]');
        const errorEl = modal?.querySelector('[data-reopen-error]');
        const confirmBtn = modal?.querySelector('[data-archive-reopen-confirm]');
        const setError = (msg) => { if (errorEl) errorEl.textContent = msg || ''; };

        startInput?.addEventListener('input', () => {
          const start = String(startInput.value || '').trim();
          if (endInput) endInput.min = start || today;
          setError('');
        });
        endInput?.addEventListener('input', () => setError(''));

        confirmBtn?.addEventListener('click', async () => {
          const selectedStartDate = String(startInput?.value || '').trim();
          const selectedEndDate = String(endInput?.value || '').trim();
          if (!selectedStartDate) {
            setError('יש לבחור תאריך התחלה חדש.');
            startInput?.focus();
            return;
          }
          if (selectedStartDate < today) {
            setError('תאריך ההתחלה חייב להיות מהיום והלאה.');
            startInput?.focus();
            return;
          }
          if (selectedEndDate && selectedEndDate < selectedStartDate) {
            setError('תאריך הסיום לא יכול להיות לפני תאריך ההתחלה.');
            endInput?.focus();
            return;
          }

          const finalEndDate = selectedEndDate || selectedStartDate;
          confirmBtn.disabled = true;
          confirmBtn.textContent = 'שומר…';
          try {
            await api.saveActivity({
              source_sheet: row.source_sheet || 'activities',
              source_row_id: row.RowID || row.row_id,
              changes: {
                status: 'פעיל',
                start_date: selectedStartDate,
                end_date: finalEndDate,
                date_1: selectedStartDate
              }
            });
            ui.closeModal?.();
            ui.closeDrawer?.();
            clearArchiveReopenCaches(state);
            state.activitiesMonthYm = selectedStartDate.slice(0, 7);
            state.route = 'activities';
            rerender();
          } catch (_e) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'אישור פתיחה מחדש';
            setError('שמירת הפתיחה מחדש נכשלה. נסו שוב.');
          }
        });
      });
    }

    root.addEventListener('click', (ev) => {
      const row = ev.target.closest('[data-row-id]');
      if (!row) return;
      const rowId = String(row.dataset.rowId || '').trim();
      const summaryRow = allRows.find((r) => String(r?.RowID || '') === rowId);
      if (summaryRow) openDetail(summaryRow);
    });
  }
};

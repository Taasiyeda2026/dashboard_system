import { escapeHtml } from './shared/html.js';
import { formatDateHe, formatActivityDateColumnsHe } from './shared/format-date.js';
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
  bindLocalFilters,
  splitVisibleRows
} from './shared/activity-list-filters.js';
import { getRosterUsers } from './shared/activity-options.js';

const ARCHIVE_SCOPE = 'archive';

const ARCHIVE_TYPE_KPIS = [
  { label: 'קורסים',      keys: ['course', 'קורס', 'קורסים'],                                              color: 'blue'   },
  { label: 'סדנאות',      keys: ['workshop', 'סדנה', 'סדנאות'],                                           color: 'purple' },
  { label: 'סיורים',      keys: ['tour', 'סיור', 'סיורים'],                                               color: 'green'  },
  { label: 'אפטרסקול',   keys: ['after_school', 'after school', 'afterschool', 'חוג אפטרסקול', 'אפטרסקול'], color: 'orange' },
];

function archiveTypeKpiHtml(rows) {
  const cells = ARCHIVE_TYPE_KPIS.map(({ label, keys, color }) => {
    const count = rows.filter((r) => keys.includes(String(r.activity_type || '').trim())).length;
    return `<div class="ds-archive-kpi ds-archive-kpi--${color}">
      <span class="ds-archive-kpi__value">${count}</span>
      <span class="ds-archive-kpi__label">${escapeHtml(label)}</span>
    </div>`;
  }).join('');
  return `<div class="ds-archive-kpi-row" dir="rtl">${cells}</div>`;
}

const ARCHIVE_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות' },
  { key: 'activity_type', label: 'סוג הפעילות', getOptionLabel: (value) => visibleActivityCategoryLabel(value) },
  { key: 'authority', label: 'רשות' }
];

const ARCHIVE_SEARCH_FIELDS = [
  'RowID',
  'activity_name',
  'activity_manager',
  'instructor_name',
  'instructor_name_2',
  'authority',
  'school',
  'activity_type',
  'meeting_dates',
  'date_cols'
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

function yearOptions(rows) {
  const years = new Set();
  rows.forEach((row) => {
    const y = endYear(row);
    if (y !== '—') years.add(y);
  });
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

function applyArchiveFilters(rows, state) {
  const filters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
  let out = Array.isArray(rows) ? rows.slice() : [];
  const year = String(state.archiveYear || '').trim();
  if (year) {
    out = out.filter((row) => endYear(row) === year);
  }
  prepareRowsForSearch(out, ARCHIVE_SEARCH_FIELDS);
  return applyLocalFilters(out, filters, { filterFields: ARCHIVE_FILTER_FIELDS });
}

export const archiveScreen = {
  async load({ api }) {
    return api.archiveActivities();
  },

  render(data, { state }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const filteredRows = applyArchiveFilters(allRows, state);
    const listFilters = ensureActivityListFilters(state, ARCHIVE_SCOPE);
    const { visible: safeRows, hasMore, total, nextCount } = splitVisibleRows(filteredRows, listFilters);
    const canSeePrivateNotes = ['operation_manager', 'admin'].includes(state?.user?.display_role);

    const years = yearOptions(allRows);
    const selectedYear = String(state.archiveYear || '').trim();

    const yearBtns = [
      `<button type="button" class="ds-chip--tab${!selectedYear ? ' is-active' : ''}" data-archive-year="">הכל</button>`,
      ...years.map((y) =>
        `<button type="button" class="ds-chip--tab${selectedYear === y ? ' is-active' : ''}" data-archive-year="${escapeHtml(y)}">${escapeHtml(y)}</button>`
      )
    ].join('');

    const tableRows = safeRows.map((row) => {
      const name = escapeHtml(row.activity_name || '—');
      const typeLabel = escapeHtml(visibleActivityCategoryLabel(row.activity_type));
      const authority = escapeHtml(row.authority || '—');
      const school = escapeHtml(row.school || '—');
      const instructor = escapeHtml(instructorText(row));
      const manager = escapeHtml(row.activity_manager || '—');
      const endRaw = String(row?.end_date || row?.start_date || '').trim();
      const endHe = endRaw ? (formatDateHe(endRaw) || endRaw) : '—';
      const startRaw = String(row?.start_date || '').trim();
      const startHe = startRaw ? (formatDateHe(startRaw) || startRaw) : '—';
      const meetingDatesHe = formatActivityDateColumnsHe(row);

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
          <td>${escapeHtml(manager)}</td>
          <td class="ds-archive-meeting-dates"><span class="ds-activities-cell-ellipsis" title="${escapeHtml(meetingDatesHe)}">${escapeHtml(meetingDatesHe)}</span></td>
          <td class="ds-archive-date-col"><time class="ds-activities-date">${escapeHtml(startHe)}</time></td>
          <td class="ds-archive-date-col"><time class="ds-activities-date ds-archive-end-date">${escapeHtml(endHe)}</time></td>
        </tr>`;
    }).join('');

    const emptyMsg = allRows.length === 0
      ? 'אין פעילויות סגורות בארכיון'
      : 'לא נמצאו פעילויות התואמות לסינון';

    const tableSection = safeRows.length === 0
      ? dsEmptyState(emptyMsg)
      : dsTableWrap(`
          <table class="ds-table ds-table--interactive ds-table--activities-list ds-table--archive" dir="rtl">
            <colgroup>
              <col><col><col><col><col><col><col><col>
            </colgroup>
            <thead>
              <tr>
                <th>תוכנית / סוג</th>
                <th>רשות</th>
                <th>בית ספר</th>
                <th>מדריך</th>
                <th>מנהל פעילות</th>
                <th>תאריכי מפגשים</th>
                <th>תאריך התחלה</th>
                <th>תאריך סיום</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>`) +
        (hasMore
          ? `<div style="display:flex;justify-content:center;padding:12px 0">
               <button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${ARCHIVE_SCOPE}" data-next-count="${nextCount}">הצג עוד</button>
             </div>`
          : '');

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
        <h2 class="ds-activities-page-title">ארכיון פעילויות · ${total} פעילויות סגורות</h2>
      </div>`;

    return dsScreenStack(`
      <section class="ds-activities-screen">
        ${titleRow}
        ${archiveTypeKpiHtml(filteredRows)}
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

    const rerenderLocal = () => rerender();

    bindLocalFilters(root, state, ARCHIVE_SCOPE, rerenderLocal, {
      debounceMs: 300,
      onClear: () => { state.archiveYear = ''; }
    });

    root.querySelector(`[data-list-show-more="${ARCHIVE_SCOPE}"]`)?.addEventListener('click', (ev) => {
      const next = Number(ev.currentTarget?.dataset?.nextCount || 200);
      ensureActivityListFilters(state, ARCHIVE_SCOPE).visibleCount = next;
      rerenderLocal();
    });

    root.querySelectorAll('[data-archive-year]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.archiveYear = String(btn.dataset.archiveYear || '').trim();
        rerenderLocal();
      });
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
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'שומר…';
        try {
          await api.saveActivity({
            source_sheet: row.source_sheet || 'activities',
            source_row_id: row.RowID || row.row_id,
            changes: { status: 'פעיל' }
          });
          btn.textContent = '✓ נפתח';
          ui.closeDrawer?.();
          rerender();
        } catch (_e) {
          btn.disabled = false;
          btn.textContent = '🔓 פתח מחדש';
        }
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

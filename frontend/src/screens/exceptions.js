import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsScreenStack,
  dsEmptyState,
  dsStatusChip
} from './shared/layout.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters
} from './shared/activity-list-filters.js';
import { activityManagerDisplayName, getFilterOptionOverrides } from './shared/activity-options.js';
import { isEmptyValue } from '../utils/empty-value.js';
import { EXCEPTION_TYPE_ORDER, exceptionActivityKey, normalizedExceptionTypes, uniqueExceptionActivityCount } from './shared/exceptions-metrics.js';
import { isSummerActivity } from './shared/summer-activity.js';
import { showToast } from './shared/toast.js';

const EXCEPTIONS_SCOPE = 'exceptions';
const EXCEPTIONS_TAB_GENERAL = 'general';
const EXCEPTIONS_TAB_SUMMER_DATES = 'summer_dates';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
function hebrewMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return String(ym || '');
  const idx = Number(m[2]) - 1;
  return `${HEBREW_MONTHS[idx] || m[2]} ${m[1]}`;
}

const EXCEPTION_FILTER_FIELDS = [
  { key: 'district', label: 'מחוז/אזור', getValues: (row) => [exceptionDistrictKey(row)] },
  { key: 'activity_manager', label: 'מנהל פעילות', getValues: (row) => [activityManagerDisplayName(row?.activity_manager)] },
  { key: 'authority', label: 'רשות' },
  { key: 'funding', label: 'מימון' },
  { key: 'school', label: 'בית ספר' },
  { key: 'exception_type', label: 'סוג חריגה', getValues: (row) => [row?.exception_type], getOptionLabel: (value) => hebrewExceptionType(value) }
];

function fieldRow(label, value) {
  const display = !isEmptyValue(value)
    ? escapeHtml(String(value).trim())
    : '<em style="color:var(--ds-text-muted)">—</em>';
  return `<p><strong>${escapeHtml(label)}:</strong> ${display}</p>`;
}

function exceptionCardTone(row, fallbackTone = 'other') {
  const type = normalizedExceptionTypes(row)[0] || fallbackTone;
  if (type === 'missing_start_date') return 'waiting-date';
  if (type === 'missing_end_date') return 'date-range';
  if (type === 'end_date_passed') return 'ended-open';
  if (type === 'end_date_after_cutoff') return 'end-date-sync';
  if (type === 'missing_instructor') return 'missing-instructor';
  if (type === 'missing_district') return 'missing-assignment';
  return 'other';
}

function exceptionGroupKey(type) {
  if (type === 'missing_start_date') return 'waiting-date';
  if (type === 'missing_end_date') return 'date-range';
  if (type === 'end_date_passed') return 'ended-open';
  if (type === 'end_date_after_cutoff') return 'end-date-sync';
  if (type === 'missing_instructor') return 'missing-instructor';
  if (type === 'missing_district') return 'missing-assignment';
  return 'other';
}

function exceptionDistrictKey(row = {}) {
  return String(row?.district || '').trim() || 'ללא מחוז / לא משויך';
}

function exceptionInstanceRows(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  return list.flatMap((row) => {
    const types = normalizedExceptionTypes(row);
    return types.map((type) => ({
      ...row,
      exception_type: type,
      exception_types: types.length ? types : [type],
      exception_instance_key: `${String(row?.RowID || row?.row_id || '').trim() || row?.activity_name || 'row'}:${type}`
    }));
  });
}

function splitRowsByExceptionTab(rows = []) {
  const general = [];
  const summerDates = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isSummerActivity(row)) {
      summerDates.push(row);
    } else {
      general.push(row);
    }
  }
  return { general, summerDates };
}

function exceptionTabsHtml(activeTab, counts) {
  const tabs = [
    [EXCEPTIONS_TAB_GENERAL, 'חריגות כלליות', counts.general || 0],
    [EXCEPTIONS_TAB_SUMMER_DATES, 'חריגות קיץ 2026', counts.summerDates || 0]
  ];
  return `<nav class="ds-exceptions-tabs" aria-label="חלוקת חריגות">
    ${tabs.map(([key, label, count]) => `<button
      type="button"
      class="ds-exceptions-tab ${activeTab === key ? 'is-active' : ''}"
      data-exceptions-tab="${escapeHtml(key)}"
      aria-pressed="${activeTab === key ? 'true' : 'false'}"
    >${escapeHtml(label)} <span>${escapeHtml(String(count))}</span></button>`).join('')}
  </nav>`;
}

function approvedExceptionRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const types = normalizedExceptionTypes(row);
      if (!types.length) return null;
      return {
        ...row,
        exception_type: types[0],
        exception_types: types
      };
    })
    .filter(Boolean);
}

function exceptionCardHtml(row, groupKey) {
  const activityName = String(row?.activity_name || '').trim() || '—';
  const school = String(row?.school || '').trim() || 'ללא בית ספר';
  const authority = String(row?.authority || '').trim() || 'ללא רשות';
  const tone = groupKey || exceptionCardTone(row);
  return `<div data-list-item class="ds-exception-list-item">
    <button
      type="button"
      class="ds-interactive-card ds-interactive-card--session ds-exception-card"
      data-exception-tone="${escapeHtml(tone)}"
      data-exception-type="${escapeHtml(String(row?.exception_type || ''))}"
      data-card-action="${escapeHtml(`exception:${row.RowID}`)}"
      aria-label="פתיחת פרטי חריגה עבור ${escapeHtml(activityName)}"
    >
      <span class="ds-exception-card__accent" aria-hidden="true"></span>
      <span class="ds-exception-card__content">
        <span class="ds-exception-card__activity">${escapeHtml(activityName)}</span>
        <span class="ds-exception-card__school">${escapeHtml(school)}</span>
        <span class="ds-exception-card__authority">${escapeHtml(authority)}</span>
      </span>
    </button>
  </div>`;
}

function exceptionGroupCard({ title, rows, key }) {
  const uniqueCount = uniqueExceptionActivityCount(rows);
  const groupTitle = `${title} · ${uniqueCount}`;
  const rowCount = Array.isArray(rows) ? rows.length : 0;
  const countMeta = rowCount !== uniqueCount
    ? `<span class="ds-exception-group__meta">${escapeHtml(String(uniqueCount))} פעילויות (${escapeHtml(String(rowCount))} רשומות)</span>`
    : '';
  const body = `<div class="ds-exceptions-grid">${rows.map((row) => exceptionCardHtml(row, key)).join('')}</div>`;
  return `<section class="ds-exception-group" data-exception-group="${escapeHtml(key || 'other')}">
    <header class="ds-exception-group__head">
      <button type="button" class="ds-exception-group__title" data-exception-type-filter="${escapeHtml(String(rows[0]?.exception_type || ''))}">${escapeHtml(groupTitle)}</button>
      ${countMeta}
    </header>
    <div class="ds-exception-group__body">${body}</div>
  </section>`;
}

function exceptionsSummaryHtml(rows = []) {
  const uniqueActivities = uniqueExceptionActivityCount(rows);
  const byDistrict = new Map();
  rows.forEach((row) => {
    const key = exceptionDistrictKey(row);
    if (!byDistrict.has(key)) byDistrict.set(key, new Set());
    byDistrict.get(key).add(exceptionActivityKey(row));
  });
  const districtsHtml = [...byDistrict.entries()]
    .map(([district, activities]) => [district, activities.size])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'he'))
    .map(([district, count]) => `<button type="button" class="ds-exception-district-chip" data-exception-district-filter="${escapeHtml(district)}"><span>${escapeHtml(district)}</span><strong>${escapeHtml(String(count))}</strong></button>`)
    .join('');
  return `<section class="ds-exceptions-summary" aria-label="סיכום חריגות">
    <div class="ds-exceptions-summary__card"><span>פעילויות עם חריגות</span><strong data-exceptions-unique-activities>${escapeHtml(String(uniqueActivities))}</strong></div>
    <div class="ds-exceptions-summary__districts">${districtsHtml}</div>
  </section>`;
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, canDirectEdit, canRequestEdit, canDeleteActivity, hideEmpIds, hideRowId, hideActivityNo, settings) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    canDirectEdit,
    canRequestEdit,
    canDeleteActivity,
    hideEmpIds: !!hideEmpIds,
    hideRowId,
    hideActivityNo,
    settings,
    showFinance: false,
    showFinanceFields: false
  });
}

function exceptionDrawerHtml(row, hideRowId) {
  const exceptionTypes = normalizedExceptionTypes(row);
  const chips = exceptionTypes.map((et) => dsStatusChip(hebrewExceptionType(String(et || '').trim()), 'neutral')).join(' ');

  const instructor  = isEmptyValue(row.instructor_name) ? '' : String(row.instructor_name).trim();
  const instructor2 = isEmptyValue(row.instructor_name_2) ? '' : String(row.instructor_name_2).trim();
  const startDate   = isEmptyValue(row.start_date) ? '' : (formatDateHe(row.start_date) || String(row.start_date).trim());
  const endDate     = isEmptyValue(row.end_date)   ? '' : (formatDateHe(row.end_date)   || String(row.end_date).trim());
  const grade = String(row.grade || '').trim();
  const classGroup = String(row.class_group || '').trim();
  const classDisplay = [grade, classGroup].filter(Boolean).join(' ');
  const calculatedEndDate = String(row?._calculated_end_date || '').trim();

  return `<div class="ds-details-grid" dir="rtl">
    ${hideRowId ? '' : `<p><strong>${escapeHtml(hebrewColumn('RowID'))}:</strong> ${escapeHtml(String(row.RowID || '—'))}</p>`}
    <p><strong>סוגי חריגה:</strong> ${chips || "—"}</p>
    ${fieldRow(hebrewColumn('activity_name'),    row.activity_name)}
    ${fieldRow(hebrewColumn('activity_type'),    row.activity_type)}
    ${fieldRow(hebrewColumn('authority'),        row.authority)}
    ${fieldRow(hebrewColumn('school'),           row.school)}
    ${classDisplay ? fieldRow('שכבה/כיתה', classDisplay) : ''}
    ${fieldRow(hebrewColumn('activity_manager'), activityManagerDisplayName(row.activity_manager))}
    ${fieldRow('מדריך',
        instructor  ? (row.emp_id  ? `${instructor} (${row.emp_id})`  : instructor)  : '')}
    ${instructor2 ? fieldRow('מדריך 2',
        row.emp_id_2 ? `${instructor2} (${row.emp_id_2})` : instructor2) : ''}
    ${fieldRow(hebrewColumn('start_date'),  startDate)}
    ${fieldRow(hebrewColumn('end_date'),    endDate)}
    ${fieldRow(hebrewColumn('sessions'),    row.sessions)}
    ${fieldRow(hebrewColumn('status'),      row.status)}
    ${calculatedEndDate ? fieldRow('תאריך סיום מחושב', formatDateHe(calculatedEndDate) || calculatedEndDate) : ''}
    ${row.notes ? fieldRow('הערות', row.notes) : ''}
  </div>`;
}

export const exceptionsScreen = {
  load: ({ api, state }) => {
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = state?.exceptionsMonthYm || state?.dashboardMonthYm || currentYm;
    return api.exceptions({ month });
  },
  render(data, { state } = {}) {
    const rawRows   = Array.isArray(data?.exceptionInstances) ? approvedExceptionRows(data.exceptionInstances) : exceptionInstanceRows(data?.rows || []);
    const allRows   = rawRows;
    const filterState = ensureActivityListFilters(state, EXCEPTIONS_SCOPE);
    prepareRowsForSearch(allRows, ['RowID', 'activity_name', 'activity_manager', 'authority', 'school', 'funding', 'exception_type', 'exception_types']);
    const filteredRows = applyLocalFilters(allRows, filterState, { filterFields: EXCEPTION_FILTER_FIELDS });
    const tabRows = splitRowsByExceptionTab(filteredRows);
    const activeTab = state?.exceptionsTab === EXCEPTIONS_TAB_SUMMER_DATES ? EXCEPTIONS_TAB_SUMMER_DATES : EXCEPTIONS_TAB_GENERAL;
    const visibleRows = activeTab === EXCEPTIONS_TAB_SUMMER_DATES ? tabRows.summerDates : tabRows.general;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const toolbarHtml = filtersToolbarHtml(EXCEPTIONS_SCOPE, allRows, state, {
      filterFields: EXCEPTION_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש חריגות…',
      optionsOverrides: getFilterOptionOverrides(state?.clientSettings || {})
    });
    const byType = new Map();
    visibleRows.forEach((row) => {
      const type = String(row?.exception_type || '').trim() || 'other';
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(row);
    });
    const orderedTypes = [
      ...EXCEPTION_TYPE_ORDER.filter((type) => byType.has(type)),
      ...[...byType.keys()].filter((type) => !EXCEPTION_TYPE_ORDER.includes(type)).sort((a, b) => a.localeCompare(b, 'he'))
    ];
    const hasAnyRows = visibleRows.length > 0;
    const groups = orderedTypes.map((type) => ({
      key: exceptionGroupKey(type),
      title: hebrewExceptionType(type),
      rows: byType.get(type) || []
    })).filter((group) => group.rows.length > 0);
    const emptyText = activeTab === EXCEPTIONS_TAB_SUMMER_DATES
      ? 'אין חריגות קיץ פעילות להצגה.'
      : 'אין חריגות כלליות פעילות להצגה.';

    return dsScreenStack(`
      <div class="ds-exceptions-screen">
      ${toolbarHtml}
      <section class="ds-exceptions-screen__section"><h2 class="ds-section-title ds-exceptions-screen__title">חריגות</h2></section>
      ${(() => { try { return sessionStorage.getItem('ds_exceptions_save_notice') === '1'; } catch { return false; } })() ? `<div class="ds-exceptions-save-notice" role="status" dir="rtl"><strong>הפעילות נשמרה בהצלחה.</strong> החריגה תוקנה ולכן הפעילות הוסרה ממסך החריגות. <button type="button" class="ds-btn ds-btn--sm" data-exception-go-activities>מעבר למסך פעילויות</button></div>` : ''}
      ${exceptionTabsHtml(activeTab, { general: uniqueExceptionActivityCount(tabRows.general), summerDates: uniqueExceptionActivityCount(tabRows.summerDates) })}
      ${activeTab === EXCEPTIONS_TAB_SUMMER_DATES ? '<p class="ds-exceptions-tab-note">כאן מוצגות פעילויות קיץ 2026 עם חריגות: חסר מדריך או חסר תאריך פעילות. פעילויות סגורות ונמחקות אינן נכללות.</p>' : ''}
      ${exceptionsSummaryHtml(visibleRows)}
      ${!hasAnyRows ? `<section class="ds-exceptions-screen__section">${dsEmptyState(emptyText)}</section>` : groups.map((group) => `<section class="ds-exceptions-screen__section">${exceptionGroupCard(group)}</section>`).join('')}
      </div>
    `);
  },
  bind({ root, data, ui, state, rerender, api, clearScreenDataCache }) {
    try { sessionStorage.removeItem('ds_exceptions_save_notice'); } catch { /* ignore */ }
    const allRows   = Array.isArray(data?.exceptionInstances) ? approvedExceptionRows(data.exceptionInstances) : exceptionInstanceRows(data?.rows || []);
    bindLocalFilters(root, state, EXCEPTIONS_SCOPE, rerender, { debounceMs: 150 });
    const canSeePrivateNotes = state?.user?.display_role === 'operation_manager';
    const canEditActivity = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const canDeleteActivity = ['admin', 'operation_manager'].includes(String(state?.user?.display_role || state?.user?.role || '').trim());
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;

    const detailCache = new Map();
    root.querySelectorAll('[data-exception-go-activities]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'activities' } }));
      });
    });


    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, {
        api,
        ui,
        clearScreenDataCache,
        rerender,
        onSaveSuccess: async ({ sourceSheet, sourceRowId, form }) => {
          detailCache.delete(`${sourceSheet || ''}|${sourceRowId || ''}`);
          clearScreenDataCache?.();
          const statusEl = form?.querySelector?.('.ds-activity-edit-status');
          if (statusEl) {
            statusEl.textContent = 'הפעילות נשמרה בהצלחה. החריגה תוקנה ולכן הפעילות הוסרה ממסך החריגות.';
            statusEl.classList.remove('is-pending', 'is-error', 'is-warning');
            statusEl.classList.add('is-success');
          }
          showToast('הפעילות נשמרה בהצלחה. החריגה תוקנה ולכן הפעילות הוסרה ממסך החריגות.', 'success', 4200);
          try { sessionStorage.setItem('ds_exceptions_save_notice', '1'); } catch { /* ignore */ }
          rerender();
        }
      });

    async function loadDetailRow(summaryRow) {
      const cacheKey = `${summaryRow.source_sheet || ''}|${summaryRow.RowID || ''}`;
      if (detailCache.has(cacheKey)) return detailCache.get(cacheKey);
      const rsp = await api.activityDetail(summaryRow.RowID, summaryRow.source_sheet);
      const row = rsp?.row || summaryRow;
      detailCache.set(cacheKey, row);
      return row;
    }

    function hideShellHeader(contentRoot) {
      const shellHdr = contentRoot.closest('.ds-drawer')?.querySelector(':scope > header');
      if (shellHdr) shellHdr.hidden = true;
    }

    function makeOnOpen(contentRoot) {
      hideShellHeader(contentRoot);
      bindActivityEditForm(contentRoot);
    }

    function exceptionTypeHeader(summaryRow) {
      const exTypes = normalizedExceptionTypes(summaryRow);
      if (!exTypes.length) return '';
      const chips = exTypes.map((et) => dsStatusChip(hebrewExceptionType(String(et || '').trim()), 'neutral')).join(' ');
      const multiBadge = exTypes.length > 1 ? `<span class="ds-badge" aria-label="${escapeHtml(String(exTypes.length))} חריגות">${escapeHtml(String(exTypes.length))}</span>` : '';
      return `<div style="margin-bottom:10px;direction:rtl">${chips} ${multiBadge}</div>`;
    }

    async function openActivityDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cacheKey = `${summaryRow.source_sheet || ''}|${summaryRow.RowID || ''}`;
      const cached = detailCache.get(cacheKey);
      const initialRow = cached || summaryRow;
      const typeHeader = exceptionTypeHeader(summaryRow);
      const onClose = () => {
        const shellHdr = document.querySelector('.ds-drawer > header');
        if (shellHdr) shellHdr.hidden = false;
      };
      ui.openDrawer({
        title: '',
        content: typeHeader + activityDrawerContent(
          initialRow,
          canSeePrivateNotes,
          canEditActivity,
          !!state?.user?.can_edit_direct,
          !!state?.user?.can_request_edit,
          canDeleteActivity,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          state?.clientSettings || {}
        ),
        onOpen: makeOnOpen,
        onClose
      });
      if (cached) return;
      try {
        const row = await loadDetailRow(summaryRow);
        ui.openDrawer({
          title: '',
          content: typeHeader + activityDrawerContent(
            row,
            canSeePrivateNotes,
            canEditActivity,
            !!state?.user?.can_edit_direct,
            !!state?.user?.can_request_edit,
            canDeleteActivity,
            hideEmpIds,
            hideRowId,
            hideActivityNo,
            state?.clientSettings || {}
          ),
          onOpen: makeOnOpen,
          onClose
        });
      } catch {}
    }

    const openAt = (idx) => {
      const list = allRows;
      const hit = list[idx];
      if (!hit || !ui) return;
      if (!api) {
        ui.openDrawer({
          title: hit.activity_name || (hideRowId ? 'חריגה' : `חריגה · ${hit.RowID}`),
          content: exceptionDrawerHtml(hit, hideRowId)
        });
        return;
      }
      void openActivityDetail(hit);
    };

    ui?.bindInteractiveCards(root, (action) => {
      if (action.startsWith('exception:')) {
        const rowId = action.slice('exception:'.length);
        const idx = allRows.findIndex((row) => String(row.RowID) === rowId);
        openAt(idx);
        return;
      }
    });

    root.querySelectorAll('[data-exception-district-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const district = btn.dataset.exceptionDistrictFilter || '';
        state.listFilters = state.listFilters || {};
        state.listFilters[EXCEPTIONS_SCOPE] = {
          ...ensureActivityListFilters(state, EXCEPTIONS_SCOPE),
          district,
          visibleCount: 200
        };
        rerender();
      });
    });

    root.querySelectorAll('[data-exception-type-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const exceptionType = btn.dataset.exceptionTypeFilter || '';
        if (!exceptionType) return;
        state.listFilters = state.listFilters || {};
        state.listFilters[EXCEPTIONS_SCOPE] = {
          ...ensureActivityListFilters(state, EXCEPTIONS_SCOPE),
          exception_type: exceptionType,
          visibleCount: 200
        };
        rerender();
      });
    });

    root.querySelectorAll('[data-exceptions-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.exceptionsTab || EXCEPTIONS_TAB_GENERAL;
        state.exceptionsTab = tab === EXCEPTIONS_TAB_SUMMER_DATES ? EXCEPTIONS_TAB_SUMMER_DATES : EXCEPTIONS_TAB_GENERAL;
        rerender();
      });
    });

  }
};

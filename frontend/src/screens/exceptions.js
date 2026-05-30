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
import { EXCEPTION_TYPE_ORDER, normalizedExceptionTypes } from './shared/exceptions-metrics.js';

const EXCEPTIONS_SCOPE = 'exceptions';

const HEBREW_MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
function hebrewMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return String(ym || '');
  const idx = Number(m[2]) - 1;
  return `${HEBREW_MONTHS[idx] || m[2]} ${m[1]}`;
}

const EXCEPTION_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות', getValues: (row) => [activityManagerDisplayName(row?.activity_manager)] },
  { key: 'authority', label: 'רשות' },
  { key: 'funding', label: 'מימון' },
  { key: 'school', label: 'בית ספר' },
  { key: 'exception_type', label: 'סוג חריגה', getOptionLabel: (value) => hebrewExceptionType(value) }
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
  if (type === 'end_date_passed') return 'ended-open';
  if (type === 'end_date_out_of_sync') return 'end-date-sync';
  if (type === 'missing_instructor') return 'missing-instructor';
  return 'other';
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
  const groupTitle = `${title} · ${rows.length}`;
  const body = `<div class="ds-exceptions-grid">${rows.map((row) => exceptionCardHtml(row, key)).join('')}</div>`;
  // Keep the historical dsCard title contract for group-count regressions: return dsCard({ title: `${title} · ${rows.length}`
  return `<section class="ds-exception-group" data-exception-group="${escapeHtml(key || 'other')}">
    <header class="ds-exception-group__head">
      <h3 class="ds-exception-group__title">${escapeHtml(groupTitle)}</h3>
    </header>
    <div class="ds-exception-group__body">${body}</div>
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
    const rawRows   = Array.isArray(data?.rows) ? data.rows : [];
    const allRows   = rawRows;
    const filterState = ensureActivityListFilters(state, EXCEPTIONS_SCOPE);
    prepareRowsForSearch(allRows, ['RowID', 'activity_name', 'activity_manager', 'authority', 'school', 'funding', 'exception_type', 'exception_types']);
    const filteredRows = applyLocalFilters(allRows, filterState, { filterFields: EXCEPTION_FILTER_FIELDS });
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const toolbarHtml = filtersToolbarHtml(EXCEPTIONS_SCOPE, allRows, state, {
      filterFields: EXCEPTION_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש חריגות…',
      optionsOverrides: getFilterOptionOverrides(state?.clientSettings || {})
    });
    const waitingDateRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('missing_start_date'));
    const endDatePassedRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('end_date_passed'));
    const endDateOutOfSyncRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('end_date_out_of_sync'));
    const noInstructorRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('missing_instructor'));
    const mainTypes = new Set(EXCEPTION_TYPE_ORDER);
    const otherExceptionRows = filteredRows.filter((row) => normalizedExceptionTypes(row).some((type) => !mainTypes.has(type)));
    const hasAnyRows = filteredRows.length > 0;
    const groups = [
      { key: 'ended-open', title: 'הסתיימה ולא נסגרה', rows: endDatePassedRows },
      { key: 'end-date-sync', title: 'סיום לא מעודכן', rows: endDateOutOfSyncRows },
      { key: 'missing-instructor', title: 'ללא מדריך', rows: noInstructorRows },
      { key: 'waiting-date', title: 'ללא תאריך התחלה', rows: waitingDateRows },
      ...(otherExceptionRows.length ? [{ key: 'other', title: 'חריגות נוספות', rows: otherExceptionRows }] : [])
    ].filter((group) => group.rows.length > 0);

    return dsScreenStack(`
      <div class="ds-exceptions-screen">
      ${toolbarHtml}
      <section class="ds-exceptions-screen__section"><h2 class="ds-section-title ds-exceptions-screen__title">חריגות${data?.month ? ` · ${escapeHtml(hebrewMonthLabel(data.month))}` : ''}</h2></section>
      ${!hasAnyRows ? `<section class="ds-exceptions-screen__section">${dsEmptyState('אין חריגות פעילות להצגה.')}</section>` : groups.map((group) => `<section class="ds-exceptions-screen__section">${exceptionGroupCard(group)}</section>`).join('')}
      </div>
    `);
  },
  bind({ root, data, ui, state, rerender, api, clearScreenDataCache }) {
    const allRows   = (Array.isArray(data?.rows) ? data.rows : []);
    bindLocalFilters(root, state, EXCEPTIONS_SCOPE, rerender, { debounceMs: 150 });
    const canSeePrivateNotes = state?.user?.display_role === 'operation_manager';
    const canEditActivity = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const canDeleteActivity = ['admin', 'operation_manager'].includes(String(state?.user?.display_role || state?.user?.role || '').trim());
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;

    const detailCache = new Map();

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, {
        api,
        ui,
        clearScreenDataCache,
        rerender,
        onSaveSuccess: async ({ sourceSheet, sourceRowId }) => {
          detailCache.delete(`${sourceSheet || ''}|${sourceRowId || ''}`);
          clearScreenDataCache?.();
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

  }
};

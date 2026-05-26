import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import { hebrewExceptionType, hebrewColumn } from './shared/ui-hebrew.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsCard,
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
import { normalizedExceptionTypes } from './shared/exceptions-metrics.js';

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

function exceptionCardSubtitle(row) {
  const meta = [String(row?.authority || '').trim(), String(row?.school || '').trim()].filter(Boolean);
  return meta.length ? meta.join(' · ') : 'ללא רשות / בית ספר';
}

function exceptionGroupCard(title, rows) {
  const body = `<div class="ds-compact-list ds-exceptions-grid">${rows.map((row) =>
    `<div data-list-item class="ds-exception-list-item"><button type="button" class="ds-interactive-card ds-interactive-card--session ds-exception-card" data-card-action="${escapeHtml(`exception:${row.RowID}`)}"><p class="ds-interactive-card__title">${escapeHtml(row.activity_name || '—')}</p><p class="ds-interactive-card__subtitle">${escapeHtml(exceptionCardSubtitle(row))}</p></button></div>`
  ).join('')}</div>`;
  return dsCard({ title: `${title} · ${rows.length}`, body, padded: false });
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
  const lateThreshold = String(row?._late_end_date_threshold || '').trim();
  const lateHits = Array.isArray(row?._late_end_date_hits) ? row._late_end_date_hits : [];
  const lateHitsHe = lateHits.map((date) => formatDateHe(date) || String(date || '').trim()).filter(Boolean).join(', ');

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
    ${lateThreshold ? fieldRow('סף חריגת תאריך סיום מאוחר', formatDateHe(lateThreshold) || lateThreshold) : ''}
    ${lateHitsHe ? fieldRow('מפגשים אחרי הסף', lateHitsHe) : ''}
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
      searchPlaceholder: 'חיפוש חריגות קורסים…',
      optionsOverrides: getFilterOptionOverrides(state?.clientSettings || {})
    });
    const waitingDateRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('missing_start_date'));
    const endDatePassedRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('end_date_passed'));
    const lateEndDateRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('late_end_date'));
    const noInstructorRows = filteredRows.filter((row) => normalizedExceptionTypes(row).includes('missing_instructor'));
    const mainTypes = new Set(['missing_start_date', 'late_end_date', 'end_date_passed', 'missing_instructor']);
    const otherExceptionRows = filteredRows.filter((row) => normalizedExceptionTypes(row).some((type) => !mainTypes.has(type)));
    const hasAnyRows = filteredRows.length > 0;
    const groups = [
      { title: 'פעילויות ממתינות לתיאום תאריך', rows: waitingDateRows },
      { title: 'פעילויות פעילות שתאריך הסיום שלהן חלף', rows: endDatePassedRows },
      { title: 'פעילויות עם מפגש לאחר תאריך הסיום', rows: lateEndDateRows },
      { title: 'פעילויות ללא מדריך', rows: noInstructorRows },
      ...(otherExceptionRows.length ? [{ title: 'חריגות נוספות', rows: otherExceptionRows }] : [])
    ].filter((group) => group.rows.length > 0);

    return dsScreenStack(`
      <div class="ds-exceptions-screen">
      ${toolbarHtml}
      <section class="ds-exceptions-screen__section"><h2 class="ds-section-title ds-exceptions-screen__title">חריגות${data?.month ? ` · ${escapeHtml(hebrewMonthLabel(data.month))}` : ''}</h2></section>
      ${!hasAnyRows ? `<section class="ds-exceptions-screen__section">${dsEmptyState('אין חריגות פעילות להצגה.')}</section>` : groups.map((group) => `<section class="ds-exceptions-screen__section">${exceptionGroupCard(group.title, group.rows)}</section>`).join('')}
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

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
  bindLocalFilters,
  splitVisibleRows
} from './shared/activity-list-filters.js';
import { activityManagerDisplayName, getFilterOptionOverrides } from './shared/activity-options.js';
import { isEmptyValue } from '../utils/empty-value.js';

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

function normalizedExceptionTypes(row) {
  if (Array.isArray(row?.exception_types)) return row.exception_types.map((type) => String(type || '').trim()).filter(Boolean);
  return [row?.exception_type].map((type) => String(type || '').trim()).filter(Boolean);
}

function numericCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function exceptionCountFromRows(rows, type) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (sum, row) => sum + (normalizedExceptionTypes(row).includes(type) ? 1 : 0),
    0
  );
}

function exceptionsOperationalSummaryHtml(data, rows) {
  const counts = data?.counts && typeof data.counts === 'object' ? data.counts : {};
  const missingInstructor = counts.missing_instructor !== undefined
    ? numericCount(counts.missing_instructor)
    : exceptionCountFromRows(rows, 'missing_instructor');
  const missingStartDate = counts.missing_start_date !== undefined
    ? numericCount(counts.missing_start_date)
    : exceptionCountFromRows(rows, 'missing_start_date');
  const lateEndDate = counts.late_end_date !== undefined
    ? numericCount(counts.late_end_date)
    : exceptionCountFromRows(rows, 'late_end_date');
  const operationalTotal = missingInstructor + missingStartDate;
  const endDateTotal = lateEndDate;
  const allExceptionsTotal = operationalTotal + endDateTotal;

  return dsCard({
    title: `סה״כ חריגות: ${escapeHtml(String(allExceptionsTotal))}`,
    body: `<div class="ds-summary-panel__structured" dir="rtl">
      <p class="ds-summary-panel__text">חריגות תפעוליות: <strong>${escapeHtml(String(operationalTotal))}</strong></p>
      <p class="ds-summary-panel__text">חסר מדריך: <strong>${escapeHtml(String(missingInstructor))}</strong></p>
      <p class="ds-summary-panel__text">חסר תאריך התחלה: <strong>${escapeHtml(String(missingStartDate))}</strong></p>
      <p class="ds-summary-panel__text">חריגות תאריך סיום: <strong>${escapeHtml(String(endDateTotal))}</strong></p>
      <p class="ds-summary-panel__text">תאריך סיום מאוחר: <strong>${escapeHtml(String(lateEndDate))}</strong></p>
    </div>`
  });
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, canDirectEdit, canRequestEdit, hideEmpIds, hideRowId, hideActivityNo, settings) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    canDirectEdit,
    canRequestEdit,
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
    const { visible: visibleRows, hasMore, nextCount, total } = splitVisibleRows(filteredRows, filterState);
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const toolbarHtml = filtersToolbarHtml(EXCEPTIONS_SCOPE, allRows, state, {
      filterFields: EXCEPTION_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש חריגות קורסים…',
      optionsOverrides: getFilterOptionOverrides(state?.clientSettings || {})
    });
    const loadMoreHtml = hasMore
      ? `<div style="display:flex;justify-content:center;padding:12px 0"><button type="button" class="ds-btn ds-btn--sm" data-list-show-more="${EXCEPTIONS_SCOPE}" data-next-count="${nextCount}">הצג עוד</button></div>`
      : '';

    const compact =
      visibleRows.length === 0
        ? dsEmptyState('לא נמצאו חריגות')
        : `<div class="ds-compact-list">${visibleRows
            .map((row, idx) => {
              const subtitleParts = [row.authority, row.school].filter(Boolean);
              const subtitleHtml  = subtitleParts.length
                ? `<p class="ds-interactive-card__subtitle">${escapeHtml(subtitleParts.join(' · '))}</p>`
                : '';
              const exTypes = normalizedExceptionTypes(row);
              const chips = exTypes.map((type) => dsStatusChip(hebrewExceptionType(type), 'neutral')).join(' ');
              const multiBadge = exTypes.length > 1 ? `<span class="ds-badge" aria-label="${escapeHtml(String(exTypes.length))} חריגות">${escapeHtml(String(exTypes.length))}</span>` : '';
              const chipHtml = `<p class="ds-interactive-card__meta">${chips} ${multiBadge}</p>`;

              return `<div data-list-item>
                <button type="button"
                  class="ds-interactive-card ds-interactive-card--session"
                  data-card-action="${escapeHtml(`exception:${row.RowID}`)}">
                  <p class="ds-interactive-card__title">${escapeHtml(row.activity_name || '—')}</p>
                  ${subtitleHtml}
                  ${chipHtml}
                </button>
              </div>`;
            })
            .join('')}</div>${loadMoreHtml}`;

    return dsScreenStack(`
      ${toolbarHtml}
      <section class="ds-screen-compact-90">${exceptionsOperationalSummaryHtml(data, allRows)}</section>
      <section class="ds-screen-compact-90">${dsCard({
        title: `חריגות קורסים${data?.month ? ` · ${escapeHtml(hebrewMonthLabel(data.month))}` : ''} · סה״כ חריגות: ${escapeHtml(String(data?.totalExceptionRows ?? total))}`,
        body: compact,
        padded: visibleRows.length === 0
      })}</section>
    `);
  },
  bind({ root, data, ui, state, rerender, api, clearScreenDataCache }) {
    const allRows   = (Array.isArray(data?.rows) ? data.rows : []);
    bindLocalFilters(root, state, EXCEPTIONS_SCOPE, rerender, { debounceMs: 150 });
    root.querySelector(`[data-list-show-more="${EXCEPTIONS_SCOPE}"]`)?.addEventListener('click', (ev) => {
      ensureActivityListFilters(state, EXCEPTIONS_SCOPE).visibleCount = Number(ev.currentTarget?.dataset?.nextCount || 200);
      rerender();
    });
    const canSeePrivateNotes = state?.user?.display_role === 'operation_manager';
    const canEditActivity = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
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
      const hit = allRows[idx];
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
      if (!action.startsWith('exception:')) return;
      const rowId = action.slice('exception:'.length);
      const idx = allRows.findIndex((row) => String(row.RowID) === rowId);
      openAt(idx);
    });
  }
};

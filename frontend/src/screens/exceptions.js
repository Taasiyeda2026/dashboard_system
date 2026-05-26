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
import { normalizedExceptionTypes, uniqueExceptionActivityCount } from './shared/exceptions-metrics.js';

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

function numericCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function optionalNumericCount(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function exceptionCountFromRows(rows, type) {
  return uniqueExceptionActivityCount(rows, (types) => types.includes(type));
}

function exceptionsOperationalSummaryHtml(data, rows) {
  const counts = data?.counts && typeof data.counts === 'object' ? data.counts : {};
  const hasRows = Array.isArray(rows) && rows.length > 0;
  const missingInstructor = hasRows
    ? exceptionCountFromRows(rows, 'missing_instructor')
    : numericCount(counts.missing_instructor);
  const missingStartDate = hasRows
    ? exceptionCountFromRows(rows, 'missing_start_date')
    : numericCount(counts.missing_start_date);
  const lateEndDate = hasRows
    ? exceptionCountFromRows(rows, 'late_end_date')
    : numericCount(counts.late_end_date);
  const endDatePassed = hasRows
    ? exceptionCountFromRows(rows, 'end_date_passed')
    : numericCount(counts.end_date_passed);
  const totalExceptionRows = optionalNumericCount(data?.totalExceptionRows);
  const allExceptionsTotal = totalExceptionRows ?? uniqueExceptionActivityCount(rows);

  return dsCard({
    title: `סה״כ פעילויות חריגות: ${escapeHtml(String(allExceptionsTotal))}`,
    body: `<div class="ds-summary-panel__structured" dir="rtl">
      <p class="ds-summary-panel__text">חסר מדריך: <strong>${escapeHtml(String(missingInstructor))}</strong></p>
      <p class="ds-summary-panel__text">חסר תאריך התחלה: <strong>${escapeHtml(String(missingStartDate))}</strong></p>
      <p class="ds-summary-panel__text">תאריך סיום מאוחר: <strong>${escapeHtml(String(lateEndDate))}</strong></p>
      <p class="ds-summary-panel__text">תאריך סיום חלף: <strong>${escapeHtml(String(endDatePassed))}</strong></p>
      <p class="ds-summary-panel__text"><small>פעילות עם כמה סוגי חריגה נספרת פעם אחת בסה״כ.</small></p>
    </div>`
  });
}

function exceptionGroupCard(title, rows, keyPrefix, { canDelete = false } = {}) {
  const body = rows.length === 0
    ? dsEmptyState('אין פריטים בקבוצה זו')
    : `<div class="ds-compact-list">${rows.map((row) => `<div data-list-item class="ds-exception-list-item"><button type="button" class="ds-interactive-card ds-interactive-card--session" data-card-action="${escapeHtml(`exception:${row.RowID}`)}"><p class="ds-interactive-card__title">${escapeHtml(row.activity_name || '—')}</p><p class="ds-interactive-card__subtitle">${escapeHtml([row.activity_type, row.authority, row.school].filter(Boolean).join(' · '))}</p></button>${canDelete ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-exception-delete="${escapeHtml(String(row.RowID || ''))}" title="מחיקה רכה">מחיקה</button>` : ''}</div>`).join('')}</div>`;
  return dsCard({ title: `${title} · ${rows.length}`, body, padded: rows.length === 0 });
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

    const undatedRows = Array.isArray(data?.undatedRows) ? data.undatedRows : [];
    const waitingDateRows = allRows.filter((row) => normalizedExceptionTypes(row).includes('missing_start_date'));
    const lateEndRows = allRows.filter((row) => normalizedExceptionTypes(row).includes('end_date_passed'));
    const noInstructorRows = allRows.filter((row) => normalizedExceptionTypes(row).includes('missing_instructor'));
    const compact = visibleRows.length === 0 ? dsEmptyState('לא נמצאו חריגות') : '';

    return dsScreenStack(`
      ${toolbarHtml}
      <section>${exceptionsOperationalSummaryHtml(data, allRows)}</section>
      <section>${dsCard({ title: `חריגות קורסים${data?.month ? ` · ${escapeHtml(hebrewMonthLabel(data.month))}` : ''} · סה״כ פעילויות חריגות: ${escapeHtml(String(data?.totalExceptionRows ?? total))}`, body: compact || loadMoreHtml, padded: visibleRows.length === 0 })}</section>
      <section>${exceptionGroupCard('פעילויות ממתינות לתיאום תאריך', waitingDateRows, 'exception', { canDelete: canDeleteActivity })}</section>
      <section>${exceptionGroupCard('פעילויות פעילות שתאריך הסיום שלהן חלף', lateEndRows, 'exception', { canDelete: canDeleteActivity })}</section>
      <section>${exceptionGroupCard('פעילויות ללא מדריך', noInstructorRows, 'exception', { canDelete: canDeleteActivity })}</section>
      <section>${dsCard({
        title: `פעילויות ללא תאריך · ${escapeHtml(String(data?.undatedCount ?? undatedRows.length))}`,
        body: undatedRows.length === 0 ? dsEmptyState('אין פעילויות ללא תאריך') : `<div class="ds-compact-list">${undatedRows.map((row) => `<div data-list-item><button type="button" class="ds-interactive-card ds-interactive-card--session" data-card-action="${escapeHtml(`undated:${row.RowID}`)}"><p class="ds-interactive-card__title">${escapeHtml(row.activity_name || '—')}</p><p class="ds-interactive-card__subtitle">${escapeHtml([row.activity_type, row.authority, row.school].filter(Boolean).join(' · '))}</p></button></div>`).join('')}</div>`
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
    const canDeleteActivity = ['admin', 'operation_manager'].includes(String(state?.user?.display_role || '').trim());
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

    const allUndatedRows = (Array.isArray(data?.undatedRows) ? data.undatedRows : []);
    const openAt = (idx, group = 'exception') => {
      const list = group === 'undated' ? allUndatedRows : allRows;
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
      if (action.startsWith('undated:')) {
        const undatedId = action.slice('undated:'.length);
        const undatedIdx = allUndatedRows.findIndex((row) => String(row.RowID) === undatedId);
        openAt(undatedIdx, 'undated');
      }
    });

    root.querySelectorAll('[data-exception-delete]').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const rowId = String(btn.getAttribute('data-exception-delete') || '').trim();
        if (!rowId) return;
        const ok = window.confirm('האם למחוק את הפעילות? הפעילות תוסתר מהמסכים ולא תימחק פיזית מהמערכת.');
        if (!ok) return;
        btn.disabled = true;
        try {
          await api.deleteActivity(rowId);
          clearScreenDataCache?.();
          rerender();
        } catch (_err) {
          window.alert('הפעילות לא נמחקה. ייתכן שאין הרשאה או שהפעילות לא נמצאה.');
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
};

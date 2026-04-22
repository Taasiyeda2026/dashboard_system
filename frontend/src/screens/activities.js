import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import {
  hebrewColumn,
  visibleActivityCategoryLabel,
  ACTIVITY_TAB_ORDER
} from './shared/ui-hebrew.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';

const ACTIVITY_VIEW_LS = 'dashboard_activity_view_v2';

function hasRowException(row) {
  const noInstructor = !String(row.emp_id || '').trim() && !String(row.emp_id_2 || '').trim();
  const noStartDate  = !String(row.start_date || '').trim();
  return noInstructor || noStartDate;
}

const DEFAULT_ONE_DAY_TYPES = ['workshop', 'tour', 'escape_room'];
const DEFAULT_PROGRAM_TYPES = ['course', 'after_school'];

const FAMILY_LABEL_SHORT = 'חד-יומיות';
const FAMILY_LABEL_LONG  = 'תוכניות';

function resolveOneDayTypes(settings) {
  return Array.isArray(settings?.one_day_activity_types) && settings.one_day_activity_types.length
    ? settings.one_day_activity_types
    : DEFAULT_ONE_DAY_TYPES;
}

function isShortFamily(row, oneDayTypes) {
  return oneDayTypes.includes(String(row?.activity_type || '').trim());
}

function applyClientFilters(rows, state, settings) {
  let out = Array.isArray(rows) ? rows.slice() : [];
  const oneDayTypes = resolveOneDayTypes(settings);
  if (state.activityQuickFamily === 'short') {
    out = out.filter((row) => isShortFamily(row, oneDayTypes));
  } else if (state.activityQuickFamily === 'long') {
    out = out.filter((row) => !isShortFamily(row, oneDayTypes));
  }
  return out;
}

function activityDrawerContent(row, canSeePrivateNotes, canEdit, hideEmpIds, hideRowId, hideActivityNo, settings) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, {
    privateNote,
    canEdit,
    hideEmpIds: !!hideEmpIds,
    hideRowId,
    hideActivityNo,
    settings,
    showFinance: false,
    showFinanceFields: false
  });
}

export const activitiesScreen = {
  async load({ api, state }) {
    try {
      const v = typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVITY_VIEW_LS) : null;
      if (v === 'table' || v === 'compact') state.activityView = v;
    } catch (_e) {
      /* ignore */
    }
    return api.activities({ activity_type: 'all' });
  },

  render(data, { state }) {
    const allRows       = Array.isArray(data?.rows) ? data.rows : [];
    const safeRows      = applyClientFilters(allRows, state, state?.clientSettings);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const hideEmpIds    = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId     = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const forceCompact  = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const compactView   = forceCompact || state?.activityView === 'compact';

    const tableRows = safeRows
      .map((row) => {
        const emp1 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id || '—')}</td>`;
        const emp2 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id_2 || '—')}</td>`;
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          row.activity_name,
          row.start_date,
          row.end_date,
          row.school,
          row.authority,
          row.activity_manager,
          visibleActivityCategoryLabel(row.activity_type),
          hideEmpIds ? '' : row.emp_id,
          hideEmpIds ? '' : row.emp_id_2,
          canSeePrivateNotes ? row.private_note : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="" data-row-id="${escapeHtml(row.RowID)}">
        <td>${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.authority || '—')}</td>
        <td>${escapeHtml(formatDateHe(row.start_date) || '—')}</td>
        <td>${escapeHtml(formatDateHe(row.end_date) || '—')}</td>
        ${emp1}${emp2}
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `;
      })
      .join('');

    const compactRows = safeRows
      .map((row) => {
        const rowSearch = [
          hideRowId ? '' : row.RowID,
          row.activity_name,
          row.school,
          row.authority,
          row.start_date,
          row.end_date
        ]
          .filter(Boolean)
          .join(' ');
        const excBadge = hasRowException(row) ? '<span class="ds-exc-dot" title="חריגה">⚠️</span>' : '';
        return `<div data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="">
        ${excBadge}${dsInteractiveCard({
          action: `activity:${row.RowID}`,
          title: row.activity_name || 'פעילות ללא שם',
          subtitle: row.school || 'ללא בית ספר',
          meta: row.authority || 'ללא רשות',
          variant: 'session'
        })}
      </div>`;
      })
      .join('');

    const thPrivate = canSeePrivateNotes ? `<th>${hebrewColumn('private_note')}</th>` : '';
    const thEmp     = hideEmpIds ? '' : '<th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th>';

    const familyChips = [
      { key: '',      label: 'הכל' },
      { key: 'short', label: FAMILY_LABEL_SHORT },
      { key: 'long',  label: FAMILY_LABEL_LONG }
    ]
      .map(
        (f) =>
          `<button type="button" class="ds-chip--tab ${f.key === (state.activityQuickFamily || '') ? 'is-active' : ''}" data-family="${f.key}">${escapeHtml(f.label)}</button>`
      )
      .join('');

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--equal-cols">
                <thead><tr><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>בית ספר</th><th>רשות</th><th>התחלה</th><th>סיום</th>${thEmp}${thPrivate}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`);

    const compactSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות')
        : `<div class="ds-compact-list">${compactRows}</div>`;

    return dsScreenStack(`
      ${actNavGridHtml(state)}
      ${dsToolbar(`
        <div class="ds-view-toggle" dir="rtl" role="group" aria-label="בחירת תצוגת רשימה">
          <button type="button" class="ds-view-toggle__btn ${!compactView ? 'is-active' : ''}" data-activity-view="table" ${
            forceCompact ? 'disabled title="במסך צר מוצגות תיבות קומפקטיות"' : ''
          }>☰ טבלה</button>
          <button type="button" class="ds-view-toggle__btn ${compactView ? 'is-active' : ''}" data-activity-view="compact">⊞ תיבות</button>
        </div>
        <div class="ds-chip-group" dir="rtl">${familyChips}</div>
      `)}
      ${compactView
        ? dsCard({ title: 'רשימת פעילויות', body: compactSection, padded: true })
        : dsCard({ title: 'רשימת פעילויות', body: tableSection,   padded: false })}
    `);
  },

  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api, clearScreenDataCache }) {
    bindActNavGrid(root, { state, rerender });

    const filteredRows      = applyClientFilters(Array.isArray(data?.rows) ? data.rows : [], state, state?.clientSettings);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const canEditActivity   = state?.user?.display_role !== 'instructor';
    const hideEmpIds        = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId         = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo    = !!state?.clientSettings?.hide_activity_no_on_screens;

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender });
    const detailCache = new Map();

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

    async function openActivityDetail(summaryRow) {
      if (!summaryRow || !ui) return;
      const cacheKey = `${summaryRow.source_sheet || ''}|${summaryRow.RowID || ''}`;
      const cached = detailCache.get(cacheKey);
      const initialRow = cached || summaryRow;
      ui.openDrawer({
        title: '',
        content: activityDrawerContent(
          initialRow,
          canSeePrivateNotes,
          canEditActivity,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          state?.clientSettings || {}
        ),
        onOpen: makeOnOpen,
        onClose: () => {
          const shellHdr = document.querySelector('.ds-drawer > header');
          if (shellHdr) shellHdr.hidden = false;
        }
      });
      if (cached) return;
      try {
        const row = await loadDetailRow(summaryRow);
        ui.openDrawer({
          title: '',
          content: activityDrawerContent(
            row,
            canSeePrivateNotes,
            canEditActivity,
            hideEmpIds,
            hideRowId,
            hideActivityNo,
            state?.clientSettings || {}
          ),
          onOpen: makeOnOpen,
          onClose: () => {
            const shellHdr = document.querySelector('.ds-drawer > header');
            if (shellHdr) shellHdr.hidden = false;
          }
        });
      } catch {}
    }

    root.querySelectorAll('[data-family]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityQuickFamily = node.dataset.family || '';
        rerender();
      });
    });

    root.querySelectorAll('[data-activity-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const next = btn.getAttribute('data-activity-view');
        if (next !== 'table' && next !== 'compact') return;
        state.activityView = next;
        try {
          localStorage.setItem(ACTIVITY_VIEW_LS, state.activityView);
        } catch (_e) {
          /* ignore */
        }
        if (typeof rerenderActivitiesView === 'function') rerenderActivitiesView();
        else rerender();
      });
    });

    root.querySelectorAll('.ds-data-row').forEach((n) => {
      n.tabIndex = 0;
      n.setAttribute('role', 'button');
    });
    if (root._rowAbort) root._rowAbort.abort();
    root._rowAbort = new AbortController();
    const rowSig = { signal: root._rowAbort.signal };
    root.addEventListener('click', (ev) => {
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.stopPropagation();
      const rowId = rowNode.dataset.rowId;
      const hit = filteredRows.find((row) => row.RowID === rowId);
      if (!hit || !ui) return;
      openActivityDetail(hit).catch(() => {});
    }, rowSig);
    root.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const rowNode = ev.target.closest('.ds-data-row');
      if (!rowNode) return;
      ev.preventDefault();
      rowNode.click();
    }, rowSig);

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('activity:')) return;
      const rowId = action.replace('activity:', '');
      const row = filteredRows.find((r) => r.RowID === rowId);
      if (!row) return;
      openActivityDetail(row).catch(() => {});
    });
  }
};

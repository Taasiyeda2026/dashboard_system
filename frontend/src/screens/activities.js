import { escapeHtml } from './shared/html.js';
import { formatDateHe } from './shared/format-date.js';
import {
  hebrewColumn,
  visibleActivityCategoryLabel,
  ACTIVITY_TAB_ORDER
} from './shared/ui-hebrew.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import {
  dsPageHeader,
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';

const ACTIVITY_VIEW_LS = 'dashboard_activity_view';

const ACT_SUBNAV = [
  { route: 'week',        label: 'תצוגת שבוע' },
  { route: 'month',       label: 'תצוגת חודש' },
  { route: 'instructors', label: 'מדריכים' },
  { route: 'end-dates',   label: 'דרכי סיום' },
  { route: 'exceptions',  label: 'חריגות' },
];

function hasRowException(row) {
  const noInstructor = !String(row.emp_id || '').trim() && !String(row.emp_id_2 || '').trim();
  const noStartDate  = !String(row.start_date || '').trim();
  return noInstructor || noStartDate;
}

const SHORT_TYPES = new Set(['workshop', 'tour', 'after_school', 'escape_room']);

const FAMILY_LABEL_SHORT = 'חד-יומיות';
const FAMILY_LABEL_LONG = 'תוכניות';

function visibleTabsFromCounts(counts) {
  const c = counts || {};
  const withData = ACTIVITY_TAB_ORDER.filter((t) => (c[t] || 0) > 0);
  return ['all'].concat(withData);
}

function isShortFamily(row) {
  return SHORT_TYPES.has(String(row?.activity_type || '').trim());
}

function currentMonthYm() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function weekBounds() {
  const d = new Date();
  const sun = new Date(d); sun.setDate(d.getDate() - d.getDay());
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  return {
    from: sun.toISOString().slice(0, 10),
    to:   sat.toISOString().slice(0, 10)
  };
}

function applyClientFilters(rows, state) {
  let out = Array.isArray(rows) ? rows.slice() : [];

  if (state.activityQuickFamily === 'short') {
    out = out.filter((row) => isShortFamily(row));
  } else if (state.activityQuickFamily === 'long') {
    out = out.filter((row) => !isShortFamily(row));
  }

  if (state.activityQuickManager) {
    out = out.filter((row) => String(row.activity_manager || 'unassigned') === state.activityQuickManager);
  }

  if (state.activityEndingCurrentMonth) {
    const ym = currentMonthYm();
    out = out.filter(
      (row) =>
        String(row.activity_type || '').trim() === 'course' &&
        String(row.end_date || '').slice(0, 7) === ym
    );
  }

  const qf = state.activityQuickFilter || '';
  if (qf === 'today') {
    const t = todayIso();
    out = out.filter((r) => {
      const s = r.start_date || ''; const e = r.end_date || '9999';
      return s <= t && e >= t;
    });
  } else if (qf === 'this_week') {
    const { from, to } = weekBounds();
    out = out.filter((r) => {
      const s = r.start_date || ''; const e = r.end_date || '9999';
      return s <= to && e >= from;
    });
  } else if (qf === 'this_month') {
    const ym = currentMonthYm();
    out = out.filter((r) => {
      const sYm = (r.start_date || '').slice(0, 7);
      const eYm = (r.end_date   || '9999-12').slice(0, 7);
      return sYm <= ym && eYm >= ym;
    });
  } else if (qf === 'ending_soon') {
    const t = todayIso();
    const soon = new Date(); soon.setDate(soon.getDate() + 21);
    const soonStr = soon.toISOString().slice(0, 10);
    out = out.filter((r) => r.end_date && r.end_date >= t && r.end_date <= soonStr);
  } else if (qf === 'no_instructor') {
    out = out.filter((r) => !String(r.emp_id || '').trim() && !String(r.emp_id_2 || '').trim());
  }

  if (state.activitySearch) {
    const q = state.activitySearch.toLowerCase();
    out = out.filter(
      (row) =>
        String(row.activity_name || '').toLowerCase().includes(q) ||
        String(row.RowID || '').toLowerCase().includes(q) ||
        visibleActivityCategoryLabel(row.activity_type).toLowerCase().includes(q)
    );
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
    const requested = state.activityTab || 'all';
    let data = await api.activities({ activity_type: requested });
    const allowed = visibleTabsFromCounts(data.activity_type_counts);
    if (allowed.indexOf(requested) < 0) {
      state.activityTab = 'all';
      data = await api.activities({ activity_type: 'all' });
    }
    return data;
  },
  render(data, { state }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const safeRows = applyClientFilters(allRows, state);
    const counts = data?.activity_type_counts || {};
    const visibleTabs = visibleTabsFromCounts(counts);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const forceCompact = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const compactView = forceCompact || state?.activityView === 'compact';
    const searchVal = escapeHtml(state.activitySearch || '');

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
    const thEmp = hideEmpIds ? '' : '<th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th>';

    const QUICK_FILTER_DEFS = [
      { key: 'today',         label: 'היום' },
      { key: 'this_week',     label: 'השבוע' },
      { key: 'this_month',    label: 'החודש' },
      { key: 'ending_soon',   label: 'מסיימים בקרוב' },
      { key: 'no_instructor', label: 'ללא מדריך' },
    ];
    const QF_LABELS = Object.fromEntries(QUICK_FILTER_DEFS.map((f) => [f.key, f.label]));
    const activeQf = state.activityQuickFilter || '';
    const quickFilterChips = QUICK_FILTER_DEFS
      .map((f) => `<button type="button" class="ds-chip ${f.key === activeQf ? 'is-active' : ''}" data-qf="${escapeHtml(f.key)}">${escapeHtml(f.label)}</button>`)
      .join('');

    const familyChips = [
      { key: '', label: 'הכל' },
      { key: 'short', label: FAMILY_LABEL_SHORT },
      { key: 'long', label: FAMILY_LABEL_LONG }
    ]
      .map(
        (f) =>
          `<button type="button" class="ds-chip--tab ${f.key === (state.activityQuickFamily || '') ? 'is-active' : ''}" data-family="${f.key}">${escapeHtml(f.label)}</button>`
      )
      .join('');

    const filterButtons = visibleTabs
      .map(
        (tab) =>
          `<button type="button" class="ds-chip--tab ${tab === (state.activityTab || 'all') ? 'is-active' : ''}" data-tab="${tab}">${escapeHtml(visibleActivityCategoryLabel(tab))}</button>`
      )
      .join('');

    const hasAnyFilter = Boolean(
      (state.activityTab && state.activityTab !== 'all') ||
        state.activityQuickFamily ||
        state.activityQuickManager ||
        state.activityEndingCurrentMonth ||
        state.activitySearch ||
        state.activityQuickFilter
    );

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות למסנן זה')
        : dsTableWrap(`<table class="ds-table ds-table--interactive ds-table--equal-cols">
                <thead><tr><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>בית ספר</th><th>רשות</th><th>התחלה</th><th>סיום</th>${thEmp}${thPrivate}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`);

    const compactSection = safeRows.length === 0 ? dsEmptyState('לא נמצאו פעילויות למסנן זה') : `<div class="ds-compact-list">${compactRows}</div>`;

    const availableRoutes = new Set(Array.isArray(state.routes) ? state.routes : []);
    const subNavHtml = ACT_SUBNAV
      .filter((item) => availableRoutes.has(item.route))
      .map((item) => `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-act-subnav="${escapeHtml(item.route)}">${escapeHtml(item.label)}</button>`)
      .join('');

    return dsScreenStack(`
      ${dsPageHeader('פעילויות', '')}
      ${subNavHtml ? `<div class="ds-act-subnav" dir="rtl">${subNavHtml}</div>` : ''}
      <div class="ds-screen-top-row">
        <input
          id="activity-search"
          type="search"
          class="ds-search-input"
          placeholder="חיפוש פעילות..."
          value="${searchVal}"
          dir="rtl"
        />
      </div>
      <div class="ds-filter-row ds-filter-row--quick" dir="rtl">${quickFilterChips}</div>
      <div class="ds-filter-row" dir="rtl">
        ${filterButtons}
        <span class="ds-filter-row__sep" aria-hidden="true"></span>
        ${familyChips}
      </div>
      ${dsToolbar(`
        <div class="ds-view-toggle" dir="rtl" role="group" aria-label="בחירת תצוגת רשימה">
          <button type="button" class="ds-view-toggle__btn ${!compactView ? 'is-active' : ''}" data-activity-view="table" ${
            forceCompact ? 'disabled title="במסך צר מוצגות תיבות קומפקטיות"' : ''
          }>☰ טבלה</button>
          <button type="button" class="ds-view-toggle__btn ${compactView ? 'is-active' : ''}" data-activity-view="compact">⊞ תיבות</button>
        </div>
        ${hasAnyFilter ? '<button type="button" class="ds-btn ds-btn--sm" data-clear-filters>ניקוי מסננים</button>' : ''}
        ${state.activityQuickManager ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">מנהל פעילויות: ${escapeHtml(state.activityQuickManager)}</span>` : ''}
        ${state.activityEndingCurrentMonth ? '<span class="ds-chip ds-chip--status ds-chip--status-neutral">מסיימי קורס החודש</span>' : ''}
        ${state.activityQuickFamily === 'short' ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">משפחה: ${FAMILY_LABEL_SHORT}</span>` : ''}
        ${state.activityQuickFamily === 'long' ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">משפחה: ${FAMILY_LABEL_LONG}</span>` : ''}
        ${state.activityQuickFilter ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">${escapeHtml(QF_LABELS[state.activityQuickFilter] || state.activityQuickFilter)}</span>` : ''}
        ${forceCompact ? '<span class="ds-muted">במובייל צר מופעלת תצוגה קומפקטית אוטומטית</span>' : ''}
      `)}
      ${compactView
        ? dsCard({
            title: 'רשימת פעילויות',
            body: compactSection,
            padded: true
          })
        : dsCard({
            title: 'רשימת פעילויות',
            body: tableSection,
            padded: false
          })}
    `);
  },
  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api, clearScreenDataCache }) {
    bindPageListTools(root);

    root.querySelectorAll('[data-act-subnav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const route = btn.dataset.actSubnav;
        if (route) {
          state.route = route;
          rerender?.();
        }
      });
    });

    const filteredRows = applyClientFilters(Array.isArray(data?.rows) ? data.rows : [], state);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const canEditActivity = state?.user?.display_role !== 'instructor';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender });

    let _searchTimer;
    root.querySelector('#activity-search')?.addEventListener('input', (ev) => {
      state.activitySearch = ev.target.value || '';
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        if (typeof rerenderActivitiesView === 'function') {
          rerenderActivitiesView();
        } else {
          rerender();
        }
      }, 220);
    });

    root.querySelectorAll('[data-tab]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityTab = node.dataset.tab;
        rerender();
      });
    });

    root.querySelectorAll('[data-family]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityQuickFamily = node.dataset.family || '';
        rerender();
      });
    });

    root.querySelectorAll('[data-qf]').forEach((node) => {
      node.addEventListener('click', () => {
        const next = node.dataset.qf || '';
        state.activityQuickFilter = state.activityQuickFilter === next ? '' : next;
        rerender();
      });
    });

    root.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
      state.activityTab = 'all';
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
      state.activityEndingCurrentMonth = false;
      state.activitySearch = '';
      state.activityQuickFilter = '';
      rerender();
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
      ui.openDrawer({
        title: hideRowId ? 'פירוט פעילות' : `פירוט פעילות ${hit.RowID}`,
        content: activityDrawerContent(
          hit,
          canSeePrivateNotes,
          canEditActivity,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          state?.clientSettings || {}
        ),
        onOpen: bindActivityEditForm
      });
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
      ui.openDrawer({
        title: hideRowId ? 'פירוט פעילות' : `פירוט פעילות ${row.RowID}`,
        content: activityDrawerContent(
          row,
          canSeePrivateNotes,
          canEditActivity,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          state?.clientSettings || {}
        ),
        onOpen: bindActivityEditForm
      });
    });
  }
};

import { escapeHtml } from './shared/html.js';
import {
  hebrewFinanceStatus,
  hebrewColumn,
  visibleActivityCategoryLabel,
  ACTIVITY_TAB_ORDER,
  financeStatusVariant,
  translateApiErrorForUser
} from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard,
  dsStatusChip
} from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';

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

function activityDrawerContent(row, canSeePrivateNotes, canEdit, hideEmpIds) {
  const privateNote = canSeePrivateNotes ? row.private_note || '—' : null;
  return activityWorkDrawerHtml(row, { privateNote, canEdit, hideEmpIds: !!hideEmpIds });
}

export const activitiesScreen = {
  async load({ api, state }) {
    const requested = state.activityTab || 'all';
    const financeStatus = state.activityFinanceStatus || '';

    let data = await api.activities({ activity_type: requested, finance_status: financeStatus });
    const allowed = visibleTabsFromCounts(data.activity_type_counts);
    if (allowed.indexOf(requested) < 0) {
      state.activityTab = 'all';
      data = await api.activities({ activity_type: 'all', finance_status: financeStatus });
    }
    return data;
  },
  render(data, { state }) {
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    const safeRows = applyClientFilters(allRows, state);
    const counts = data?.activity_type_counts || {};
    const visibleTabs = visibleTabsFromCounts(counts);
    const financeStatuses = Array.isArray(data?.filters?.finance_statuses) ? data.filters.finance_statuses : [];
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const forceCompact = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const compactView = forceCompact || state?.activityView === 'compact';
    const searchVal = escapeHtml(state.activitySearch || '');

    const financeOpts = [
      ...new Set(allRows.map((r) => String(r.finance_status || '').trim()).filter(Boolean))
    ].map((st) => ({ value: st, label: hebrewFinanceStatus(st) }));

    const tableRows = safeRows
      .map((row) => {
        const emp1 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id || '—')}</td>`;
        const emp2 = hideEmpIds ? '' : `<td>${escapeHtml(row.emp_id_2 || '—')}</td>`;
        const rowSearch = [
          row.RowID,
          row.activity_name,
          row.start_date,
          row.end_date,
          row.activity_manager,
          visibleActivityCategoryLabel(row.activity_type),
          hebrewFinanceStatus(row.finance_status),
          row.emp_id,
          row.emp_id_2,
          canSeePrivateNotes ? row.private_note : ''
        ]
          .filter(Boolean)
          .join(' ');
        return `
      <tr class="ds-data-row" data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="${escapeHtml(
        row.finance_status || ''
      )}" data-row-id="${escapeHtml(row.RowID)}">
        <td>${escapeHtml(row.RowID)}</td>
        <td>${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.start_date || '—')}</td>
        <td>${escapeHtml(row.end_date || '—')}</td>
        ${emp1}${emp2}
        <td>${dsStatusChip(hebrewFinanceStatus(row.finance_status || 'open'), financeStatusVariant(row.finance_status))}</td>
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `;
      })
      .join('');

    const compactRows = safeRows
      .map((row) => {
        const rowSearch = [
          row.RowID,
          row.activity_name,
          row.start_date,
          row.end_date,
          visibleActivityCategoryLabel(row.activity_type),
          hebrewFinanceStatus(row.finance_status)
        ]
          .filter(Boolean)
          .join(' ');
        return `<div data-list-item data-search="${escapeHtml(rowSearch)}" data-filter="${escapeHtml(row.finance_status || '')}">
        ${dsInteractiveCard({
          action: `activity:${row.RowID}`,
          title: `${row.RowID} · ${visibleActivityCategoryLabel(row.activity_type)}`,
          subtitle: row.activity_name || 'פעילות ללא שם',
          meta: `${hebrewFinanceStatus(row.finance_status || 'open')} · ${row.start_date || '—'} עד ${row.end_date || '—'}`,
          variant: 'session'
        })}
      </div>`;
      })
      .join('');

    const thPrivate = canSeePrivateNotes ? `<th>${hebrewColumn('private_note')}</th>` : '';
    const thEmp = hideEmpIds ? '' : '<th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th>';

    const familyChips = [
      { key: '', label: 'כל המשפחות' },
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

    const financeChips = financeStatuses
      .map(
        (status) =>
          `<button type="button" class="ds-chip--tab ${status === (state.activityFinanceStatus || '') ? 'is-active' : ''}" data-finance="${status}">${escapeHtml(hebrewFinanceStatus(status))}</button>`
      )
      .join('');

    const hasAnyFilter = Boolean(
      (state.activityTab && state.activityTab !== 'all') ||
        state.activityFinanceStatus ||
        state.activityQuickFamily ||
        state.activityQuickManager ||
        state.activityEndingCurrentMonth ||
        state.activitySearch
    );

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות למסנן זה')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
                <thead><tr><th>${hebrewColumn('RowID')}</th><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>התחלה</th><th>סיום</th>${thEmp}<th>${hebrewColumn('finance_status')}</th>${thPrivate}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`);

    const compactSection = safeRows.length === 0 ? dsEmptyState('לא נמצאו פעילויות למסנן זה') : `<div class="ds-compact-list">${compactRows}</div>`;

    const userRoutes = Array.isArray(state?.routes) ? state.routes : [];
    const shortcutDefs = [
      { route: 'week',        label: 'שבוע',       icon: '📅' },
      { route: 'month',       label: 'חודש',       icon: '📆' },
      { route: 'exceptions',  label: 'חריגות',     icon: '⚠️' },
      { route: 'instructors', label: 'מדריכים',    icon: '👥' },
      { route: 'contacts',    label: 'אנשי קשר',  icon: '🏫' },
    ];
    const shortcutsHtml = shortcutDefs
      .filter((d) => userRoutes.includes(d.route))
      .map((d) => `<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-goto-route="${d.route}"><span aria-hidden="true">${d.icon}</span> ${escapeHtml(d.label)}</button>`)
      .join('');

    return dsScreenStack(`
      ${dsPageHeader('פעילויות', 'סינון, בחירה ופתיחת פירוט פעילות')}
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
      ${shortcutsHtml ? `<div class="ds-screen-shortcuts" dir="rtl">${shortcutsHtml}</div>` : ''}
      <div class="ds-filter-row" dir="rtl">
        ${filterButtons}
        ${financeChips ? `<span class="ds-filter-row__sep" aria-hidden="true"></span>${financeChips}` : ''}
        <span class="ds-filter-row__sep" aria-hidden="true"></span>
        ${familyChips}
      </div>
      ${dsToolbar(`
        <label class="compact-toggle"><input id="toggle-view" type="checkbox" ${compactView ? 'checked' : ''} ${forceCompact ? 'disabled' : ''} /> תצוגה קומפקטית</label>
        ${hasAnyFilter ? '<button type="button" class="ds-btn ds-btn--sm" data-clear-filters>ניקוי מסננים</button>' : ''}
        ${state.activityQuickManager ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">מנהל פעילויות: ${escapeHtml(state.activityQuickManager)}</span>` : ''}
        ${state.activityEndingCurrentMonth ? '<span class="ds-chip ds-chip--status ds-chip--status-neutral">מסיימי קורס החודש</span>' : ''}
        ${state.activityQuickFamily === 'short' ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">משפחה: ${FAMILY_LABEL_SHORT}</span>` : ''}
        ${state.activityQuickFamily === 'long' ? `<span class="ds-chip ds-chip--status ds-chip--status-neutral">משפחה: ${FAMILY_LABEL_LONG}</span>` : ''}
        ${forceCompact ? '<span class="ds-muted">במובייל צר מופעלת תצוגה קומפקטית אוטומטית</span>' : ''}
      `)}
      ${compactView
        ? dsCard({
            title: 'רשימת פעילויות',
            badge: `${safeRows.length} שורות`,
            body: compactSection,
            padded: true
          })
        : dsCard({
            title: 'רשימת פעילויות',
            badge: `${safeRows.length} שורות`,
            body: tableSection,
            padded: false
          })}
    `);
  },
  bind({ root, data, state, rerender, rerenderActivitiesView, ui, api }) {
    bindPageListTools(root);
    root.querySelectorAll('[data-goto-route]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.gotoRoute;
        if (target) { state.route = target; rerender?.(); }
      });
    });

    const filteredRows = applyClientFilters(Array.isArray(data?.rows) ? data.rows : [], state);
    const canSeePrivateNotes = state?.user?.display_role === 'operations_reviewer';
    const canEditActivity = state?.user?.display_role !== 'instructor';
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;

    function bindActivityEditForm(contentRoot) {
      const form = contentRoot.querySelector('[data-edit-activity]');
      if (!form || !api) return;
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const statusEl = form.querySelector('.ds-activity-edit-status');
        const sourceSheet = form.getAttribute('data-source-sheet') || '';
        const sourceRowId = form.getAttribute('data-row-id') || '';
        const fd = new FormData(form);
        const changes = {
          status: String(fd.get('status') ?? '').trim(),
          notes: String(fd.get('notes') ?? '').trim(),
          finance_status: String(fd.get('finance_status') ?? '').trim(),
          finance_notes: String(fd.get('finance_notes') ?? '').trim(),
          start_date: String(fd.get('start_date') ?? '').trim(),
          end_date: String(fd.get('end_date') ?? '').trim()
        };
        try {
          await api.saveActivity({ source_sheet: sourceSheet, source_row_id: sourceRowId, changes });
          if (statusEl) statusEl.textContent = 'נשמר';
          ui?.closeAll();
          if (typeof rerender === 'function') await rerender();
        } catch (err) {
          if (statusEl) statusEl.textContent = translateApiErrorForUser(err?.message);
        }
      });
    }

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

    root.querySelectorAll('[data-finance]').forEach((node) => {
      node.addEventListener('click', () => {
        const next = node.dataset.finance || '';
        state.activityFinanceStatus = state.activityFinanceStatus === next ? '' : next;
        rerender();
      });
    });

    root.querySelectorAll('[data-family]').forEach((node) => {
      node.addEventListener('click', () => {
        state.activityQuickFamily = node.dataset.family || '';
        rerender();
      });
    });

    root.querySelector('[data-clear-filters]')?.addEventListener('click', () => {
      state.activityTab = 'all';
      state.activityFinanceStatus = '';
      state.activityQuickFamily = '';
      state.activityQuickManager = '';
      state.activityEndingCurrentMonth = false;
      state.activitySearch = '';
      rerender();
    });

    root.querySelector('#toggle-view')?.addEventListener('change', (event) => {
      state.activityView = event.target.checked ? 'compact' : 'table';
      if (typeof rerenderActivitiesView === 'function') {
        rerenderActivitiesView();
      } else {
        rerender();
      }
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
        title: `פירוט פעילות ${hit.RowID}`,
        content: activityDrawerContent(hit, canSeePrivateNotes, canEditActivity, hideEmpIds),
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
        title: `פירוט פעילות ${row.RowID}`,
        content: activityDrawerContent(row, canSeePrivateNotes, canEditActivity, hideEmpIds),
        onOpen: bindActivityEditForm
      });
    });
  }
};

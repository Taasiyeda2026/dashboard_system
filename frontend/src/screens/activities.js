import { escapeHtml } from './shared/html.js';
import { hebrewFinanceStatus, hebrewColumn, visibleActivityCategoryLabel, ACTIVITY_TAB_ORDER } from './shared/ui-hebrew.js';
import {
  dsPageHeader,
  dsFilterBar,
  dsToolbar,
  dsCard,
  dsScreenStack,
  dsTableWrap,
  dsEmptyState,
  dsInteractiveCard
} from './shared/layout.js';

const SHORT_TYPES = new Set(['workshop', 'tour', 'after_school', 'escape_room']);

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

  return out;
}

function activityDetailsHtml(row, canSeePrivateNotes) {
  const note = canSeePrivateNotes ? row.private_note || '—' : 'אין הרשאה';
  const instNames = [row.instructor_name, row.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  const instLine = instNames || `${row.emp_id || '—'} · ${row.emp_id_2 || '—'}`;
  return `
    <div class="ds-details-grid" dir="rtl">
      <p><strong>שם פעילות:</strong> ${escapeHtml(row.activity_name || '—')}</p>
      <p><strong>RowID:</strong> ${escapeHtml(row.RowID || '—')}</p>
      <p><strong>סוג פעילות:</strong> ${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</p>
      <p><strong>אחראי פעילות:</strong> ${escapeHtml(row.activity_manager || '—')}</p>
      <p><strong>תאריכים:</strong> ${escapeHtml(row.start_date || '—')} עד ${escapeHtml(row.end_date || '—')}</p>
      <p><strong>מדריכים:</strong> ${escapeHtml(instLine)}</p>
      <p><strong>סטטוס כספי:</strong> ${escapeHtml(hebrewFinanceStatus(row.finance_status || 'open'))}</p>
      <p><strong>הערות:</strong> ${escapeHtml(note)}</p>
    </div>
  `;
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
    const forceCompact = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;
    const compactView = forceCompact || state?.activityView === 'compact';

    const tableRows = safeRows
      .map(
        (row) => `
      <tr class="ds-data-row" data-row-id="${escapeHtml(row.RowID)}">
        <td>${escapeHtml(row.RowID)}</td>
        <td>${escapeHtml(visibleActivityCategoryLabel(row.activity_type))}</td>
        <td>${escapeHtml(row.activity_name || '—')}</td>
        <td>${escapeHtml(row.start_date || '—')}</td>
        <td>${escapeHtml(row.end_date || '—')}</td>
        <td>${escapeHtml(row.emp_id || '—')}</td>
        <td>${escapeHtml(row.emp_id_2 || '—')}</td>
        <td>${escapeHtml(hebrewFinanceStatus(row.finance_status || 'open'))}</td>
        ${canSeePrivateNotes ? `<td>${escapeHtml(row.private_note || '')}</td>` : ''}
      </tr>
    `
      )
      .join('');

    const compactRows = safeRows
      .map((row) =>
        dsInteractiveCard({
          action: `activity:${row.RowID}`,
          title: `${row.RowID} · ${visibleActivityCategoryLabel(row.activity_type)}`,
          subtitle: row.activity_name || 'פעילות ללא שם',
          meta: `${row.start_date || '—'} עד ${row.end_date || '—'}`,
          variant: 'session'
        })
      )
      .join('');

    const thPrivate = canSeePrivateNotes ? `<th>${hebrewColumn('private_note')}</th>` : '';

    const familyChips = [
      {
        key: '',
        label: 'כל המשפחות'
      },
      {
        key: 'short',
        label: 'קצרות בלבד'
      },
      {
        key: 'long',
        label: 'ארוכות בלבד'
      }
    ]
      .map(
        (f) =>
          `<button type="button" class="ds-chip ${f.key === (state.activityQuickFamily || '') ? 'is-active' : ''}" data-family="${f.key}">${escapeHtml(f.label)}</button>`
      )
      .join('');

    const filterButtons = visibleTabs
      .map(
        (tab) =>
          `<button type="button" class="ds-chip ${tab === (state.activityTab || 'all') ? 'is-active' : ''}" data-tab="${tab}">${escapeHtml(visibleActivityCategoryLabel(tab))}</button>`
      )
      .join('');

    const financeChips = financeStatuses
      .map(
        (status) =>
          `<button type="button" class="ds-chip ${status === (state.activityFinanceStatus || '') ? 'is-active' : ''}" data-finance="${status}">${escapeHtml(hebrewFinanceStatus(status))}</button>`
      )
      .join('');

    const hasAnyFilter = Boolean(
      (state.activityTab && state.activityTab !== 'all') ||
        state.activityFinanceStatus ||
        state.activityQuickFamily ||
        state.activityQuickManager ||
        state.activityEndingCurrentMonth
    );

    const tableSection =
      safeRows.length === 0
        ? dsEmptyState('לא נמצאו פעילויות למסנן זה')
        : dsTableWrap(`<table class="ds-table ds-table--interactive">
                <thead><tr><th>${hebrewColumn('RowID')}</th><th>${hebrewColumn('activity_type')}</th><th>שם</th><th>התחלה</th><th>סיום</th><th>מדריך/ה 1 (מזהה)</th><th>מדריך/ה 2 (מזהה)</th><th>${hebrewColumn('finance_status')}</th>${thPrivate}</tr></thead>
                <tbody>${tableRows}</tbody>
              </table>`);

    const compactSection = safeRows.length === 0 ? dsEmptyState('לא נמצאו פעילויות למסנן זה') : `<div class="ds-compact-list">${compactRows}</div>`;

    return dsScreenStack(`
      ${dsPageHeader('פעילויות', 'סינון, בחירה ופתיחת פירוט פעילות')}
      <div class="ds-filter-stack" dir="rtl">
        <div class="ds-filter-group">
          <span class="ds-filter-label">סוג לפי גיליון</span>
          ${dsFilterBar(filterButtons)}
        </div>
        <div class="ds-filter-group">
          <span class="ds-filter-label">סטטוס כספים</span>
          ${dsFilterBar(financeChips || '<span class="ds-muted">אין סטטוסי כספים זמינים</span>')}
        </div>
        <div class="ds-filter-group">
          <span class="ds-filter-label">משפחת פעילות (מקומי)</span>
          ${dsFilterBar(familyChips)}
        </div>
      </div>
      ${dsToolbar(`
        <label class="compact-toggle"><input id="toggle-view" type="checkbox" ${compactView ? 'checked' : ''} ${forceCompact ? 'disabled' : ''} /> תצוגה קומפקטית</label>
        ${hasAnyFilter ? '<button type="button" class="ds-btn ds-btn--sm" data-clear-filters>ניקוי מסננים</button>' : ''}
        ${state.activityQuickManager ? `<span class="ds-chip ds-chip--neutral">אחראי: ${escapeHtml(state.activityQuickManager)}</span>` : ''}
        ${state.activityEndingCurrentMonth ? '<span class="ds-chip ds-chip--neutral">מסיימי קורס החודש</span>' : ''}
        ${state.activityQuickFamily ? `<span class="ds-chip ds-chip--neutral">משפחה: ${state.activityQuickFamily === 'short' ? 'קצרות' : 'ארוכות'}</span>` : ''}
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
  bind({ root, data, state, rerender, rerenderActivitiesView, ui }) {
    const filteredRows = applyClientFilters(Array.isArray(data?.rows) ? data.rows : [], state);

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

    root.querySelectorAll('.ds-data-row').forEach((rowNode) => {
      rowNode.tabIndex = 0;
      rowNode.setAttribute('role', 'button');
      rowNode.addEventListener('click', () => {
        const rowId = rowNode.dataset.rowId;
        const hit = filteredRows.find((row) => row.RowID === rowId);
        if (!hit || !ui) return;
        ui.openDrawer({
          title: `פירוט פעילות ${hit.RowID}`,
          content: activityDetailsHtml(hit, state?.user?.display_role === 'operations_reviewer')
        });
      });
      rowNode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          rowNode.click();
        }
      });
    });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('activity:')) return;
      const rowId = action.replace('activity:', '');
      const row = filteredRows.find((r) => r.RowID === rowId);
      if (!row) return;
      ui.openDrawer({
        title: `פירוט פעילות ${row.RowID}`,
        content: activityDetailsHtml(row, state?.user?.display_role === 'operations_reviewer')
      });
    });
  }
};

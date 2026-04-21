import { escapeHtml } from './shared/html.js';
import { persistCacheEntry } from '../cache-persist.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { dsPageListToolsBar, bindPageListTools } from './shared/page-list-tools.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import { formatDateHe } from './shared/format-date.js';
import { actNavGridHtml, bindActNavGrid } from './shared/act-nav-grid.js';

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekItemMeta(item) {
  const names = [item.instructor_name, item.instructor_name_2].filter((x) => x && String(x).trim()).join(' · ');
  return names || 'ללא מדריך';
}

function weekDrawerHtml(item, date, hideEmpIds, hideRowId, hideActivityNo, canEdit, showPrivateNote, settings) {
  const privateNote = showPrivateNote ? item.private_note || '—' : null;
  const full = activityWorkDrawerHtml(item, {
    privateNote,
    canEdit: !!canEdit,
    hideEmpIds: !!hideEmpIds,
    hideRowId: !!hideRowId,
    hideActivityNo: !!hideActivityNo,
    settings: settings || {}
  });
  return `${full}<p dir="rtl" style="margin-top:6px"><strong>יום בלוח:</strong> ${escapeHtml(formatDateHe(date))}</p>`;
}

function weekRangeLabel(days) {
  if (!days || days.length === 0) return '';
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';
  if (!first) return '';
  const fmtFirst = formatDateHe(first);
  const fmtLast = formatDateHe(last);
  return first === last ? fmtFirst : `${fmtFirst} — ${fmtLast}`;
}

function weekDayItems(day, itemsById) {
  if (Array.isArray(day?.items)) return day.items;
  const ids = Array.isArray(day?.item_ids) ? day.item_ids : [];
  return ids.map((id) => itemsById?.[id]).filter(Boolean);
}

/**
 * Group items by primary instructor key so multiple activities by the same
 * instructor on the same day can be collapsed into an accordion.
 */
function groupItemsByInstructor(items) {
  const groups = new Map();
  const order = [];
  items.forEach((item) => {
    const key =
      String(item.emp_id || '').trim() ||
      String(item.instructor_name || '').trim() ||
      `__nokey__${item.RowID}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(item);
  });
  return order.map((k) => groups.get(k));
}

function renderWeekGroup(group, date, dow) {
  const main = group[0];
  const extras = group.slice(1);

  const hayParts = group
    .flatMap((item) => [
      item.activity_name,
      item.RowID,
      item.instructor_name,
      item.instructor_name_2,
      item.emp_id,
      item.emp_id_2,
      date,
      dow
    ])
    .filter(Boolean);
  const hay = escapeHtml(hayParts.join(' '));

  const mainCard = dsInteractiveCard({
    variant: 'session',
    action: `weeksession|${encodeURIComponent(date)}|${encodeURIComponent(main.RowID)}`,
    title: main.activity_name || 'ללא שם',
    meta: weekItemMeta(main)
  });

  if (extras.length === 0) {
    return `<div class="ds-week-session-wrap" data-list-item data-search="${hay}" data-filter="">${mainCard}</div>`;
  }

  const totalCount = group.length;
  const extraCards = extras
    .map((item) =>
      dsInteractiveCard({
        variant: 'session',
        action: `weeksession|${encodeURIComponent(date)}|${encodeURIComponent(item.RowID)}`,
        title: item.activity_name || 'ללא שם',
        meta: weekItemMeta(item)
      })
    )
    .join('');

  return `<div class="ds-week-session-wrap ds-week-session-group" data-list-item data-search="${hay}" data-filter="">
    <div class="ds-week-group__main-wrap">
      ${mainCard}
      <button type="button" class="ds-week-group__badge" data-group-toggle data-group-count="${totalCount}" aria-expanded="false">${totalCount}</button>
    </div>
    <div class="ds-week-group__extra" hidden>
      ${extraCards}
    </div>
  </div>`;
}

export const weekScreen = {
  load: ({ api, state }) => api.week({ week_offset: state.weekOffset || 0 }),
  render(data, { state }) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
    const todayIso = localYmd();
    const weekOffset = state.weekOffset || 0;

    const columns = safeDays
      .map((d, idx) => {
        const items = weekDayItems(d, itemsById);
        const isToday = d.date === todayIso;
        const dow = d.weekday_label || '';
        const groups = groupItemsByInstructor(items);
        const sessionBlocks = items.length
          ? groups.map((group) => renderWeekGroup(group, d.date, dow)).join('')
          : '<p class="ds-muted ds-week-empty">אין פריטים</p>';
        return `
      <section class="ds-week-col${isToday ? ' is-today' : ''}" aria-label="${escapeHtml(d.date)}">
        <header class="ds-week-col__head">
          <span class="ds-week-col__dow">${escapeHtml(dow || `יום ${idx + 1}`)}</span>
          <span class="ds-week-col__date">${escapeHtml(formatDateHe(d.date))}</span>
          <span class="ds-week-col__count">${escapeHtml(`${items.length} פעילויות`)}</span>
        </header>
        <div class="ds-week-col__body">${sessionBlocks}</div>
      </section>`;
      })
      .join('');

    const body =
      columns ||
      `<div class="ds-empty"><p class="ds-empty__msg">אין נתוני שבוע זמינים</p></div>`;

    const rangeLabel = weekRangeLabel(safeDays);
    const isCurrentWeek = weekOffset === 0;
    const navLabel = isCurrentWeek
      ? `שבוע נוכחי${rangeLabel ? ` · ${rangeLabel}` : ''}`
      : weekOffset < 0
        ? `${Math.abs(weekOffset)} שבועות אחורה${rangeLabel ? ` · ${rangeLabel}` : ''}`
        : `${rangeLabel || 'שבוע'}`;

    const uniqueActivities = new Set(
      safeDays.flatMap((d) => weekDayItems(d, itemsById).map((it) => it.RowID))
    ).size;
    const activeDays = safeDays.filter((d) => weekDayItems(d, itemsById).length > 0).length;
    const totalSessions = safeDays.reduce((sum, d) => sum + weekDayItems(d, itemsById).length, 0);
    const kpiRow = `<div class="ds-mini-kpi-row">
      <span class="ds-mini-kpi"><strong>${uniqueActivities}</strong> פעילויות</span>
      <span class="ds-mini-kpi"><strong>${activeDays}</strong> ימים פעילים</span>
      <span class="ds-mini-kpi"><strong>${totalSessions}</strong> מפגשים</span>
    </div>`;

    return dsScreenStack(`
      ${dsPageHeader('שבוע', '')}
      ${actNavGridHtml(state)}
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט שבועי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-week-prev aria-label="שבוע קודם">שבוע קודם ▶</button>
        <span class="ds-cal-nav__label">${escapeHtml(navLabel)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-week-next aria-label="שבוע הבא">◀ שבוע הבא</button>
      </nav>
      ${kpiRow}
      ${dsPageListToolsBar({ searchPlaceholder: 'חיפוש בפריטי השבוע…', filters: [] })}
      <div class="ds-week-board" style="--week-cols:${safeDays.length || 7}" role="region" aria-label="לוח שבוע">${body}</div>
    `);
  },
  bind({ root, ui, data, state, rerender, clearScreenDataCache, api }) {
    bindActNavGrid(root, { state, rerender });
    bindPageListTools(root);
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const canEditActivity = state?.user?.display_role !== 'instructor';
    const showPrivateNote = state?.user?.display_role === 'operations_reviewer';

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender });

    root.querySelector('[data-week-prev]')?.addEventListener('click', () => {
      state.weekOffset = (state.weekOffset || 0) - 1;
      rerender?.();
    });
    root.querySelector('[data-week-next]')?.addEventListener('click', () => {
      state.weekOffset = (state.weekOffset || 0) + 1;
      rerender?.();
    });

    // Pre-fetch adjacent weeks silently into screenDataCache for instant navigation
    const WEEK_TTL_MS = 8 * 60 * 1000;
    const currentOffset = state.weekOffset || 0;
    [currentOffset - 1, currentOffset + 1].forEach((adjOffset) => {
      const adjKey = `week:${adjOffset}`;
      const hit = state.screenDataCache?.[adjKey];
      if (hit && Date.now() - hit.t < WEEK_TTL_MS) return;
      api.week({ week_offset: adjOffset }).then((d) => {
        if (!state.screenDataCache[adjKey] || Date.now() - state.screenDataCache[adjKey].t > WEEK_TTL_MS) {
          const entry = { data: d, t: Date.now() };
          state.screenDataCache[adjKey] = entry;
          persistCacheEntry(adjKey, entry);
        }
      }).catch(() => {});
    });

    root.addEventListener('click', (ev) => {
      const badge = ev.target.closest('[data-group-toggle]');
      if (!badge) return;
      ev.stopPropagation();
      ev.preventDefault();
      const groupEl = badge.closest('.ds-week-session-group');
      if (!groupEl) return;
      const extra = groupEl.querySelector('.ds-week-group__extra');
      if (!extra) return;
      const isOpen = !extra.hasAttribute('hidden');
      extra.toggleAttribute('hidden', isOpen);
      badge.setAttribute('aria-expanded', String(!isOpen));
      const count = badge.dataset.groupCount || '';
      badge.textContent = isOpen ? count : '▲';
    });

    ui.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('weeksession|')) return;
      const rest = action.slice('weeksession|'.length);
      const sep = rest.indexOf('|');
      if (sep < 0) return;
      const date = decodeURIComponent(rest.slice(0, sep));
      const rowId = decodeURIComponent(rest.slice(sep + 1));
      const days = Array.isArray(data?.days) ? data.days : [];
      const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
      const day = days.find((x) => x.date === date);
      const items = weekDayItems(day, itemsById);
      const item = items.find((x) => String(x.RowID) === String(rowId));
      if (!item) {
        ui.openDrawer({ title: 'פריט', content: '<p class="ds-muted">לא נמצאו נתונים</p>' });
        return;
      }
      ui.openDrawer({
        title: item.activity_name || 'פעילות',
        content: weekDrawerHtml(
          item,
          date,
          hideEmpIds,
          hideRowId,
          hideActivityNo,
          canEditActivity,
          showPrivateNote,
          state?.clientSettings || {}
        ),
        onOpen: canEditActivity ? bindActivityEditForm : undefined
      });
    });
  }
};

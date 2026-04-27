import { escapeHtml } from './shared/html.js';
import { dsScreenStack, dsInteractiveCard } from './shared/layout.js';
import { activityWorkDrawerHtml } from './shared/activity-detail-html.js';
import { bindActivityEditForm as bindActivityEditFormShared } from './shared/bind-activity-edit-form.js';
import { formatDateHe } from './shared/format-date.js';
import { getHolidayLabel } from './shared/holidays.js';
import {
  ensureActivityListFilters,
  prepareRowsForSearch,
  applyLocalFilters,
  filtersToolbarHtml,
  bindLocalFilters
} from './shared/activity-list-filters.js';
import { getFilterOptionOverrides } from './shared/activity-options.js';

const inflightActivityDetailRequests = new Map();
const WEEK_SCOPE = 'calendar';
const CALENDAR_FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות' },
  { key: 'instructor', label: 'מדריך', getValues: (row) => [row?.instructor_name, row?.instructor_name_2] },
  { key: 'activity_name', label: 'תוכנית' },
  { key: 'authority', label: 'רשות' },
  { key: 'funding', label: 'מימון' },
  { key: 'school', label: 'בית ספר' }
];
const CALENDAR_SEARCH_FIELDS = [
  'RowID',
  'activity_name',
  'activity_manager',
  'instructor_name',
  'instructor_name_2',
  'authority',
  'school',
  'funding',
  'status'
];

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

function weekDrawerHtml(itemOrItems, date, hideEmpIds, hideRowId, hideActivityNo, canEdit, canDirectEdit, showPrivateNote, settings, mode = 'single') {
  if (mode === 'summary') {
    const rows = Array.isArray(itemOrItems) ? itemOrItems : [];
    return activityWorkDrawerHtml(rows, {
      mode: 'summary',
      summaryDate: date,
      privateNote: showPrivateNote ? '—' : null,
      canEdit: !!canEdit,
      canDirectEdit: !!canDirectEdit,
      hideEmpIds: !!hideEmpIds,
      hideRowId: !!hideRowId,
      hideActivityNo: !!hideActivityNo,
      settings: settings || {}
    });
  }
  const item = itemOrItems;
  const privateNote = showPrivateNote ? item.private_note || '—' : null;
  return activityWorkDrawerHtml(item, {
    mode: 'single',
    privateNote,
    canEdit: !!canEdit,
    canDirectEdit: !!canDirectEdit,
    hideEmpIds: !!hideEmpIds,
    hideRowId: !!hideRowId,
    hideActivityNo: !!hideActivityNo,
    settings: settings || {}
  });
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
      String(item.instructor_name || '').trim() ||
      String(item.emp_id || '').trim() ||
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

function activityDetailCacheKey(row) {
  return `activityDetail:${row.source_sheet || ''}:${row.RowID || ''}`;
}
function getCachedActivityDetail(row, s) {
  const entry = s?.screenDataCache?.[activityDetailCacheKey(row)];
  return entry ? entry.data : null;
}
function putCachedActivityDetail(row, fullRow, s) {
  if (s?.screenDataCache) {
    s.screenDataCache[activityDetailCacheKey(row)] = { data: fullRow, t: Date.now() };
  }
}
function patchCachedActivityDetail({ sourceSheet, sourceRowId, changes }, s) {
  const key = `activityDetail:${sourceSheet || ''}:${sourceRowId || ''}`;
  const entry = s?.screenDataCache?.[key];
  if (entry?.data && typeof entry.data === 'object') Object.assign(entry.data, changes || {});
}

export const weekScreen = {
  load: ({ api, state }) => {
    const offset = state.weekOffset || 0;
    return api.week({ week_offset: offset });
  },
  render(data, { state }) {
    const safeDays = Array.isArray(data?.days) ? data.days : [];
    const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
    const filterState = ensureActivityListFilters(state, WEEK_SCOPE);
    const allItems = Object.values(itemsById || {});
    prepareRowsForSearch(allItems, CALENDAR_SEARCH_FIELDS);
    const todayIso = localYmd();
    const weekOffset = state.weekOffset || 0;
    const toolbarHtml = filtersToolbarHtml(WEEK_SCOPE, allItems, state, {
      filterFields: CALENDAR_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש פעילויות בלוח השבוע…',
      optionsOverrides: getFilterOptionOverrides(state?.clientSettings || {})
    });

    const columns = safeDays
      .map((d, idx) => {
        const items = applyLocalFilters(weekDayItems(d, itemsById), filterState, { filterFields: CALENDAR_FILTER_FIELDS });
        const isToday = d.date === todayIso;
        const dow = d.weekday_label || '';
        const groups = groupItemsByInstructor(items);
        const sessionBlocks = items.length
          ? groups.map((group) => renderWeekGroup(group, d.date, dow)).join('')
          : '';
        const holiday = getHolidayLabel(d.date);
        return `
      <section class="ds-week-col${isToday ? ' is-today' : ''}" data-day-idx="${idx}" aria-label="${escapeHtml(d.date)}">
        <header class="ds-week-col__head">
          <div class="ds-week-col__head-top">
            <span class="ds-week-col__dow">${escapeHtml(dow || `יום ${idx + 1}`)}</span>
            ${isToday ? '<span class="ds-week-col__today-badge">היום</span>' : ''}
            <span class="ds-week-col__count">${items.length}</span>
          </div>
          <span class="ds-week-col__date">${escapeHtml(formatDateHe(d.date))}</span>
          ${holiday ? `<span class="ds-week-col__holiday">${escapeHtml(holiday)}</span>` : ''}
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

    const html = dsScreenStack(`
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט שבועי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-week-prev aria-label="שבוע קודם">▶</button>
        <span class="ds-cal-nav__label">${escapeHtml(navLabel)}</span>
        <button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-week-next aria-label="שבוע הבא">◀</button>
      </nav>
      ${toolbarHtml}
      <div class="ds-week-board" style="--week-cols:${safeDays.length || 7}" role="region" aria-label="לוח שבוע">${body}</div>
    `);
    return html;
  },
  bind({ root, ui, data, state, rerender, clearScreenDataCache, api }) {
    if (root._weekBindAbort) root._weekBindAbort.abort();
    root._weekBindAbort = new AbortController();
    const bindOpts = { signal: root._weekBindAbort.signal };

    bindActNavGrid(root, { state, rerender });
    root.classList.remove('is-week-loading');
    root.setAttribute('aria-busy', 'false');
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const canEditActivity = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const showPrivateNote = state?.user?.display_role === 'operation_manager';
    bindLocalFilters(root, state, WEEK_SCOPE, rerender, { debounceMs: 300 });

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender, onRowSaved: (p) => patchCachedActivityDetail(p, state) });

    const prevBtn = root.querySelector('[data-week-prev]');
    const nextBtn = root.querySelector('[data-week-next]');
    const doWeekShift = (delta) => {
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      root.classList.add('is-week-loading');
      root.setAttribute('aria-busy', 'true');
      state.weekOffset = (state.weekOffset || 0) + delta;
      rerender?.();
    };
    prevBtn?.addEventListener('click', () => doWeekShift(-1), bindOpts);
    nextBtn?.addEventListener('click', () => doWeekShift(1), bindOpts);

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
    }, bindOpts);

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
      const groups = groupItemsByInstructor(items);
      const summaryGroup = groups.find((group) =>
        group.some((entry) => String(entry.RowID) === String(rowId))
      ) || [item];
      const mode = summaryGroup.length > 1 ? 'summary' : 'single';
      const openDrawerWith = (payload, currMode) => {
        ui.openDrawer({
          title: '',
          content: weekDrawerHtml(
            currMode === 'summary' ? payload : payload[0],
            date,
            hideEmpIds,
            hideRowId,
            hideActivityNo,
              canEditActivity,
              !!state?.user?.can_edit_direct,
            showPrivateNote,
            state?.clientSettings || {},
            currMode
          ),
          onOpen: canEditActivity ? bindActivityEditForm : undefined
        });
      };
      const rows = mode === 'summary' ? summaryGroup : [item];
      const allCached = rows.every((row) => !!getCachedActivityDetail(row, state));
      if (allCached) {
        openDrawerWith(rows.map((row) => getCachedActivityDetail(row, state)), mode);
      } else {
        openDrawerWith(summaryGroup, mode);
        const loadDetails = async () => {
          const detailed = await Promise.all(rows.map(async (row) => {
            const cached = getCachedActivityDetail(row, state);
            if (cached) return cached;
            const cacheKey = activityDetailCacheKey(row);
            let request = inflightActivityDetailRequests.get(cacheKey);
            if (!request) {
              request = api.activityDetail(row.RowID, row.source_sheet)
                .finally(() => {
                  inflightActivityDetailRequests.delete(cacheKey);
                });
              inflightActivityDetailRequests.set(cacheKey, request);
            }
            const rsp = await request;
            const full = rsp?.row || row;
            putCachedActivityDetail(row, full, state);
            return full;
          }));
          openDrawerWith(detailed, mode);
        };
        loadDetails().catch(() => {});
      }
    });
  }
};

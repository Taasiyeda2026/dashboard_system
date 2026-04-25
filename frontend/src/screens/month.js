import { escapeHtml } from './shared/html.js';
import { dsScreenStack, dsCard, dsInteractiveCard } from './shared/layout.js';
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

const inflightActivityDetailRequests = new Map();
const MONTH_SCOPE = 'calendar';
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

const HEBREW_MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר'
];

/** כותרות ימים — עמודה ראשונה = יום ראשון (תואם ל־getDay()). */
const HEBREW_WEEKDAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function localYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYm(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || '').trim());
  if (!m) return null;
  return { y: Number(m[1]), mo: Number(m[2]) };
}

function inferMonthSpec(data) {
  const parsed = parseYm(data?.month);
  if (parsed) return parsed;
  const first = data?.cells?.[0]?.date;
  if (first && /^\d{4}-\d{2}-\d{2}$/.test(String(first))) {
    return { y: Number(first.slice(0, 4)), mo: Number(first.slice(5, 7)) };
  }
  const d = new Date();
  return { y: d.getFullYear(), mo: d.getMonth() + 1 };
}

function daysInMonth1Based(y, mo) {
  return new Date(y, mo, 0).getDate();
}

function monthTitleHebrew(spec) {
  if (!spec || spec.mo < 1 || spec.mo > 12) return 'חודש';
  return `${HEBREW_MONTHS[spec.mo - 1]} ${spec.y}`;
}

function cellMapFromCells(cells) {
  const map = {};
  for (const c of cells) {
    const d = Number(c?.day);
    if (!Number.isFinite(d)) continue;
    map[d] = c;
  }
  return map;
}

function monthCellItems(cell, itemsById) {
  if (Array.isArray(cell?.items)) return cell.items;
  const ids = Array.isArray(cell?.item_ids) ? cell.item_ids : [];
  return ids.map((id) => itemsById?.[id]).filter(Boolean);
}

function padDayKey(y, mo, dayNum) {
  return `${y}-${String(mo).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
}

function dayNeedsAttention(items) {
  const list = Array.isArray(items) ? items : [];
  return list.some((it) => {
    const id1 = String(it?.emp_id || '').trim();
    const id2 = String(it?.emp_id_2 || '').trim();
    return !id1 && !id2;
  });
}

function activityDotsMeta(n) {
  if (n <= 0) return '';
  if (n <= 5) return '●'.repeat(n);
  return `●●●●● +${n - 5}`;
}

function itemMeta(item) {
  const names = [item.instructor_name, item.instructor_name_2]
    .filter((x) => x && String(x).trim())
    .join(' · ');
  return names || 'ללא מדריך';
}

/** Group items by primary instructor so multiple activities by the same
 *  instructor on the same day are shown as an accordion. */
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

/** Render one instructor-group as a card (or accordion) for the day drawer. */
function renderDayGroup(group, date) {
  const main = group[0];
  const extras = group.slice(1);

  const mainCard = dsInteractiveCard({
    variant: 'session',
    action: `monthsession|${encodeURIComponent(date)}|${encodeURIComponent(main.RowID)}`,
    title: main.activity_name || 'ללא שם',
    meta: itemMeta(main)
  });

  if (extras.length === 0) {
    return `<div class="ds-week-session-wrap">${mainCard}</div>`;
  }

  const totalCount = group.length;
  const extraCards = extras
    .map((item) =>
      dsInteractiveCard({
        variant: 'session',
        action: `monthsession|${encodeURIComponent(date)}|${encodeURIComponent(item.RowID)}`,
        title: item.activity_name || 'ללא שם',
        meta: itemMeta(item)
      })
    )
    .join('');

  return `<div class="ds-week-session-wrap ds-week-session-group">
    <div class="ds-week-group__main-wrap">
      ${mainCard}
      <button type="button" class="ds-week-group__badge" data-group-toggle data-group-count="${totalCount}" aria-expanded="false">(${totalCount})</button>
    </div>
    <div class="ds-week-group__extra" hidden>
      ${extraCards}
    </div>
  </div>`;
}

/** Day drawer content: list of session cards (week-style). */
function monthDayCardsHtml(items, date) {
  if (!items.length) {
    return `<p class="ds-muted">אין פעילויות מתמשכות ביום זה.</p><p class="ds-muted">תאריך: ${escapeHtml(formatDateHe(date) || '')}</p>`;
  }
  const groups = groupItemsByInstructor(items);
  return `<div class="ds-month-day-cards" dir="rtl">
    ${groups.map((g) => renderDayGroup(g, date)).join('')}
  </div>`;
}

function shiftMonthYm(ym, delta) {
  const d = ym && /^\d{4}-\d{2}$/.test(ym) ? new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1) : new Date();
  d.setMonth(d.getMonth() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthCacheKey(ym) {
  return `month:${ym && /^\d{4}-\d{2}$/.test(String(ym)) ? ym : 'current'}`;
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

export const monthScreen = {
  load: ({ api, state }) => {
    const ym = state.monthYm && /^\d{4}-\d{2}$/.test(state.monthYm) ? state.monthYm : '';
    return api.month(ym ? { ym } : {});
  },
  render(data, { state }) {
    const spec = inferMonthSpec(data || {});
    const y = spec.y;
    const mo = spec.mo;
    const dim = daysInMonth1Based(y, mo);
    const first = new Date(y, mo - 1, 1);
    const firstWeekday = first.getDay();
    const totalUsed = firstWeekday + dim;
    const rowCount = Math.ceil(totalUsed / 7);
    const slotCount = rowCount * 7;

    const safeCells = Array.isArray(data?.cells) ? data.cells : [];
    const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
    const filterState = ensureActivityListFilters(state, MONTH_SCOPE);
    const allItems = Object.values(itemsById || {});
    prepareRowsForSearch(allItems, CALENDAR_SEARCH_FIELDS);
    const toolbarHtml = filtersToolbarHtml(MONTH_SCOPE, allItems, state, {
      filterFields: CALENDAR_FILTER_FIELDS,
      searchPlaceholder: 'חיפוש פעילויות בלוח החודש…'
    });
    const byDay = cellMapFromCells(safeCells);
    const todayIso = localYmd();
    const hideSaturday = !!data?.hide_saturday;

    const weekdayRow = HEBREW_WEEKDAY_SHORT.map(
      (label) => `<div class="ds-cal-wd" role="columnheader">${escapeHtml(label)}</div>`
    ).join('');

    const slots = [];
    for (let i = 0; i < slotCount; i += 1) {
      if (i < firstWeekday || i >= firstWeekday + dim) {
        slots.push('<div class="ds-cal-slot ds-cal-slot--empty" aria-hidden="true"></div>');
        continue;
      }
      const dayNum = i - firstWeekday + 1;
      const cellDate = new Date(y, mo - 1, dayNum);
      if (hideSaturday && cellDate.getDay() === 6) {
        slots.push('<div class="ds-cal-slot ds-cal-slot--shabbat-off" aria-hidden="true"></div>');
        continue;
      }
      const cell = byDay[dayNum] || {
        day: dayNum,
        date: padDayKey(y, mo, dayNum),
        item_ids: []
      };
      const cellItems = applyLocalFilters(monthCellItems(cell, itemsById), filterState, { filterFields: CALENDAR_FILTER_FIELDS });
      const n = cellItems.length;
      const isToday = cell.date === todayIso;
      const isShabbat = cellDate.getDay() === 6;
      const warn = dayNeedsAttention(cell.items);
      const extra = [
        isToday ? 'is-cal-today' : '',
        warn ? 'is-month-warn' : '',
        isShabbat ? 'is-shabbat' : '',
        n > 0 ? 'has-activities' : 'is-no-activities'
      ].filter(Boolean).join(' ');
      const holiday = getHolidayLabel(cell.date);
      const subtitle = holiday || '';
      const meta = n > 0 ? `${n} פעילויות` : '';
      const hay = (Array.isArray(cell.items) ? cell.items : [])
        .map((it) =>
          [it.activity_name, it.RowID, it.emp_id, it.emp_id_2, it.instructor_name, it.instructor_name_2].filter(Boolean).join(' ')
        )
        .join(' ');
      slots.push(
        `<div class="ds-cal-slot-hit" data-list-item data-search="${escapeHtml(hay)}" data-filter="">
        ${dsInteractiveCard({
          variant: 'day-cell',
          action: `monthcell|${dayNum}`,
          title: String(dayNum),
          subtitle,
          meta,
          extraClass: extra.trim()
        })}
      </div>`
      );
    }

    const gridHtml = `
      <div class="ds-cal-wrap${hideSaturday ? ' ds-cal-wrap--hide-shabbat' : ''}" dir="rtl">
        <div class="ds-cal-weekdays" role="row">${weekdayRow}</div>
        <div class="ds-cal-grid" role="grid" aria-label="לוח חודש">${slots.join('')}</div>
      </div>`;

    const currentYm = data?.month || `${y}-${String(mo).padStart(2, '0')}`;
    const monthTitle = monthTitleHebrew(spec);

    const html = dsScreenStack(`
      <nav class="ds-cal-nav" role="navigation" aria-label="ניווט חודשי" dir="rtl">
        <button type="button" class="ds-btn ds-btn--sm" data-month-prev aria-label="חודש קודם">חודש קודם ▶</button>
        <span class="ds-cal-nav__label">${escapeHtml(monthTitle)}</span>
        <button type="button" class="ds-btn ds-btn--sm" data-month-next aria-label="חודש הבא">◀ חודש הבא</button>
      </nav>
      ${toolbarHtml}
      ${dsCard({
        body: gridHtml,
        padded: false
      })}
    `);
    return html;
  },
  bind({ root, ui, data, state, rerender, clearScreenDataCache, api }) {
    root.classList.remove('is-month-loading');
    root.setAttribute('aria-busy', 'false');
    const hideEmpIds = !!state?.clientSettings?.hide_emp_id_on_screens;
    const hideRowId = !!state?.clientSettings?.hide_row_id_in_ui;
    const hideActivityNo = !!state?.clientSettings?.hide_activity_no_on_screens;
    const canEditActivity = !!(state?.user?.can_edit_direct || state?.user?.can_request_edit);
    const showPrivateNote = state?.user?.display_role === 'operation_manager';
    bindLocalFilters(root, state, MONTH_SCOPE, rerender, { debounceMs: 300 });
    const cells = Array.isArray(data?.cells) ? data.cells : [];
    const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
    const allItemsByRowId = new Map();
    cells.forEach((cell) => {
      monthCellItems(cell, itemsById).forEach((item) => {
        allItemsByRowId.set(String(item?.RowID || ''), item);
      });
    });

    const bindActivityEditForm = (contentRoot) =>
      bindActivityEditFormShared(contentRoot, { api, ui, clearScreenDataCache, rerender, onRowSaved: (p) => patchCachedActivityDetail(p, state) });

    /** Bind the accordion toggles and activity card clicks inside a day drawer. */
    const bindDayDrawer = (contentRoot) => {
      contentRoot.addEventListener('click', (ev) => {
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
        badge.textContent = isOpen ? `(${count})` : '▲';
      });

      ui.bindInteractiveCards(contentRoot, (action) => {
        if (!action.startsWith('monthsession|')) return;
        const parts = action.split('|');
        const date = decodeURIComponent(parts[1] || '');
        const rowId = decodeURIComponent(parts[2] || '');
        const item = allItemsByRowId.get(String(rowId));
        if (!item) {
          ui.openDrawer({ title: 'פעילות', content: '<p class="ds-muted">לא נמצאו נתונים</p>' });
          return;
        }
        const openItem = (row) => {
          const privateNote = showPrivateNote ? row.private_note || '—' : null;
          ui.openDrawer({
            title: row.activity_name || 'פעילות',
            content: activityWorkDrawerHtml(row, {
              privateNote,
              canEdit: canEditActivity,
              canDirectEdit: !!state?.user?.can_edit_direct,
              hideEmpIds,
              hideRowId,
              hideActivityNo,
              settings: state?.clientSettings || {}
            }),
            onOpen: canEditActivity ? bindActivityEditForm : undefined
          });
        };
        const cached = getCachedActivityDetail(item, state);
        if (cached) {
          openItem(cached);
          return;
        }
        openItem(item);
        const detailKey = activityDetailCacheKey(item);
        let request = inflightActivityDetailRequests.get(detailKey);
        if (!request) {
          request = api.activityDetail(item.RowID, item.source_sheet)
            .finally(() => {
              inflightActivityDetailRequests.delete(detailKey);
            });
          inflightActivityDetailRequests.set(detailKey, request);
        }
        request.then((rsp) => {
          const full = rsp?.row || item;
          putCachedActivityDetail(item, full, state);
          openItem(full);
        }).catch(() => {});
      });
    };

    const currentYm = data?.month || '';
    const resolveBaseYm = () => {
      const spec = inferMonthSpec(data || {});
      if (/^\d{4}-\d{2}$/.test(String(state.monthYm || ''))) return state.monthYm;
      if (/^\d{4}-\d{2}$/.test(String(currentYm || ''))) return currentYm;
      return `${spec.y}-${String(spec.mo).padStart(2, '0')}`;
    };
    const prevBtn = root.querySelector('[data-month-prev]');
    const nextBtn = root.querySelector('[data-month-next]');
    const setMonthAreaLoading = (isLoading) => {
      root.classList.toggle('is-month-loading', !!isLoading);
      root.setAttribute('aria-busy', isLoading ? 'true' : 'false');
      if (prevBtn) prevBtn.disabled = !!isLoading;
      if (nextBtn) nextBtn.disabled = !!isLoading;
    };
    const doMonthShift = (delta) => {
      const targetYm = shiftMonthYm(resolveBaseYm(), delta);
      const targetKey = monthCacheKey(targetYm);
      const hasCachedTarget = !!state?.screenDataCache?.[targetKey];

      state.monthYm = targetYm;
      try { localStorage.setItem('dashboard_calendar_month_ym', state.monthYm); } catch { /* ignore */ }

      if (hasCachedTarget) {
        rerender?.();
        return;
      }

      setMonthAreaLoading(true);
      rerender?.();
    };
    prevBtn?.addEventListener('click', () => { doMonthShift(-1); });
    nextBtn?.addEventListener('click', () => { doMonthShift(1); });

    ui?.bindInteractiveCards(root, (action) => {
      if (!action.startsWith('monthcell|')) return;
      const dayNum = action.split('|')[1];
      const cells = Array.isArray(data?.cells) ? data.cells : [];
      const itemsById = data?.items_by_id && typeof data.items_by_id === 'object' ? data.items_by_id : {};
      const spec = inferMonthSpec(data || {});
      const dim = daysInMonth1Based(spec.y, spec.mo);
      const d = Number(dayNum);
      if (!Number.isFinite(d) || d < 1 || d > dim) return;

      const byDay = cellMapFromCells(cells);
      const cell = byDay[d] || {
        day: d,
        date: padDayKey(spec.y, spec.mo, d),
        item_ids: []
      };
      const filterState = ensureActivityListFilters(state, MONTH_SCOPE);
      const cellItems = applyLocalFilters(monthCellItems(cell, itemsById), filterState, { filterFields: CALENDAR_FILTER_FIELDS });
      if (!cellItems.length) return;

      ui.openDrawer({
        title: `${formatDateHe(cell.date) || `יום ${d}`} · ${cellItems.length} פעילויות`,
        content: monthDayCardsHtml(cellItems, cell.date),
        onOpen: bindDayDrawer
      });
    });
  }
};

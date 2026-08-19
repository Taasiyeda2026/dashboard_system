import { state } from './state.js';
import { ensureFeature } from './feature-loaders.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { activitySeasonQueryValues, normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import { activityWorkDrawerHtml } from './screens/shared/activity-detail-html.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
import { monthDayCardsHtml } from './screens/shared/day-session-cards.js';
import { formatDateHe } from './screens/shared/format-date.js';
import { escapeHtml } from './screens/shared/html.js';

const MANAGER_BOARD_INTERACTION_ROLES = new Set(['admin', 'operation_manager', 'activities_manager', 'finance']);
const CALENDAR_ACTIVITY_CACHE_TTL_MS = 90 * 1000;
const DATE_FIELDS = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`);
const ui = createSharedInteractionLayer();
const activityCache = new Map();

let observer = null;
let observerTimer = null;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function canUseManagerBoardInteractions() {
  return MANAGER_BOARD_INTERACTION_ROLES.has(text(state?.user?.role));
}

function managerName(boardRoot) {
  const select = boardRoot?.querySelector('[data-manager-board-manager]');
  if (select?.value) return text(select.value);
  return text(boardRoot?.querySelector('.manager-board-manager-fixed strong')?.textContent);
}

function boardMonth(boardRoot) {
  const label = text(boardRoot?.querySelector('.manager-board-month-nav strong')?.textContent);
  const months = {
    'ינואר':'01','פברואר':'02','מרץ':'03','אפריל':'04','מאי':'05','יוני':'06',
    'יולי':'07','אוגוסט':'08','ספטמבר':'09','אוקטובר':'10','נובמבר':'11','דצמבר':'12'
  };
  const match = label.match(/^([^\d]+?)\s+(20\d{2})$/);
  if (!match) return '';
  const month = months[text(match[1])];
  return month ? `${match[2]}-${month}` : '';
}

function boardContext(boardRoot) {
  return {
    manager: managerName(boardRoot),
    ym: boardMonth(boardRoot),
    period: normalizeGlobalActivityPeriod(state?.activityPeriodTab)
  };
}

function normalizeClock(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{1,2}):(\d{2})/);
  return match ? `${String(match[1]).padStart(2, '0')}:${match[2]}` : raw;
}

function normalizeDrawerRow(row = {}) {
  return {
    ...row,
    RowID: row.RowID || row.row_id || row.source_row_id || row.id || '',
    row_id: row.row_id || row.RowID || row.source_row_id || row.id || '',
    source_row_id: row.source_row_id || row.row_id || row.RowID || row.id || '',
    source_sheet: row.source_sheet || 'activities'
  };
}

async function loadManagerActivities(context) {
  if (!supabase || !context.manager) return [];
  const key = `${context.period}|${context.manager}`;
  const cached = activityCache.get(key);
  if (cached && Date.now() - cached.loadedAt < CALENDAR_ACTIVITY_CACHE_TTL_MS) return cached.rows;

  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
  const seasons = activitySeasonQueryValues(context.period);
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .in('activity_season', seasons)
    .eq('activity_manager', context.manager);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  activityCache.set(key, { rows, loadedAt: Date.now() });
  return rows;
}

/** Rows (raw `activities` table records) whose date_1..date_35 fields include the given ISO day. */
function activitiesOnDate(rows, iso) {
  return (rows || []).filter((row) => DATE_FIELDS.some((field) => text(row?.[field]).slice(0, 10) === iso));
}

function sortDayActivities(rows) {
  return [...rows].sort((a, b) => {
    const aStart = normalizeClock(a?.start_time);
    const bStart = normalizeClock(b?.start_time);
    if (aStart !== bStart) return aStart.localeCompare(bStart);
    return text(a?.school).localeCompare(text(b?.school), 'he');
  });
}

function daySessionSubtitle(row) {
  return text(row?.school || row?.single_school_name || row?.legacy_school);
}

function daySessionMeta(row) {
  const start = normalizeClock(row?.start_time);
  const end = normalizeClock(row?.end_time);
  const time = start && end ? `${start}–${end}` : start;
  const instructors = [row?.instructor_name, row?.instructor_name_2].map(text).filter(Boolean).join(' · ');
  return [time, instructors || 'ללא מדריך'].filter(Boolean).join(' · ');
}

function hideDrawerShellHeader(contentRoot) {
  const header = contentRoot?.closest('.ds-drawer')?.querySelector(':scope > header');
  if (header) header.hidden = true;
}

function restoreDrawerShellHeader() {
  const header = document.querySelector('.ds-drawer > header');
  if (header) header.hidden = false;
}

/** Level 3: open the full activity detail, reusing the same shared drawer/component the month screen uses. */
async function openActivityDetailDrawer(row) {
  ui.openDrawer({
    title: '',
    content: '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען פרטי פעילות…</p></div>'
  });

  try {
    await ensureFeature('activityDrawer');
  } catch (error) {
    console.error('[manager-board] failed to load activity drawer feature', error);
    ui.openDrawer({
      title: 'פרטי פעילות',
      content: '<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא ניתן לטעון את תצוגת הפעילות כרגע.</p></div>'
    });
    return;
  }

  ui.openDrawer({
    title: '',
    content: activityWorkDrawerHtml(row, {
      privateNote: null,
      canEdit: false,
      canDirectEdit: false,
      canRequestEdit: false,
      canDeleteActivity: false,
      canSchedule: false,
      hideEmpIds: !!state?.clientSettings?.hide_emp_id_on_screens,
      hideRowId: !!state?.clientSettings?.hide_row_id_in_ui,
      hideActivityNo: !!state?.clientSettings?.hide_activity_no_on_screens,
      settings: state?.clientSettings || {},
      showFinance: false,
      showFinanceFields: false,
      datesLoading: false
    }),
    onOpen: hideDrawerShellHeader,
    onClose: restoreDrawerShellHeader
  });
}

/** Level 2: bind the day drawer's session cards (same `monthsession|date|RowID` contract as screens/month.js). */
function bindDayDrawer(contentRoot, rowsByRowId) {
  ui.bindInteractiveCards(contentRoot, (action) => {
    if (!action.startsWith('monthsession|')) return;
    const rowId = decodeURIComponent(action.split('|')[2] || '');
    const row = rowsByRowId.get(rowId);
    if (row) void openActivityDetailDrawer(row);
  });
}

/** Level 1 → Level 2: day cell click opens the day's activities, same hierarchy as screens/month.js. */
async function openDayActivities(dayCell) {
  const boardRoot = dayCell.closest('[data-manager-board-root]');
  if (!boardRoot || !canUseManagerBoardInteractions()) return;
  const context = boardContext(boardRoot);
  const iso = dayCell.dataset.managerBoardDay || '';
  if (!context.manager || !iso) return;

  ui.openDrawer({
    title: 'פעילויות היום',
    content: '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען פעילויות…</p></div>'
  });

  const dateLabel = formatDateHe(iso) || iso;
  let dayRows;
  try {
    const rows = await loadManagerActivities(context);
    dayRows = sortDayActivities(activitiesOnDate(rows, iso)).map(normalizeDrawerRow);
  } catch (error) {
    ui.openDrawer({
      title: dateLabel,
      content: `<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא ניתן לטעון את פעילויות היום כרגע.</p><small>${escapeHtml(error?.message || '')}</small></div>`
    });
    return;
  }

  if (!dayRows.length) {
    ui.openDrawer({
      title: dateLabel,
      content: '<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא נמצאו פעילויות ליום זה.</p></div>'
    });
    return;
  }

  const rowsByRowId = new Map(dayRows.map((row) => [String(row.RowID || ''), row]));
  ui.openDrawer({
    title: `${dateLabel} · ${dayRows.length} פעילויות`,
    content: monthDayCardsHtml(dayRows, iso, { subtitleText: daySessionSubtitle, metaText: daySessionMeta }),
    onOpen: (contentRoot) => bindDayDrawer(contentRoot, rowsByRowId)
  });
}

function cleanupBoardPresentation(boardRoot) {
  if (!boardRoot) return;
  boardRoot.querySelector('.manager-board-hero > div:first-child > p')?.remove();
  const instructorsPanel = boardRoot.querySelector('.manager-board-panel--instructors');
  instructorsPanel?.querySelector('.manager-board-panel__head p')?.remove();

  boardRoot.querySelectorAll('[data-manager-board-day]').forEach((dayCell) => {
    if (dayCell.dataset.managerBoardDayBound === 'yes') return;
    dayCell.dataset.managerBoardDayBound = 'yes';
    dayCell.setAttribute('role', 'button');
    dayCell.setAttribute('tabindex', '0');
    const dayNumber = text(dayCell.querySelector('.manager-board-calendar-day__number')?.textContent);
    const count = text(dayCell.querySelector('.manager-board-calendar-day__count')?.textContent);
    dayCell.setAttribute('aria-label', `יום ${dayNumber}${count ? ` — ${count}` : ''} — לחיצה לפתיחת רשימת הפעילויות`);
  });
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const dayCell = target.closest('[data-manager-board-day]');
  if (!dayCell) return;
  event.preventDefault();
  event.stopPropagation();
  void openDayActivities(dayCell);
}

function handleKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof Element ? event.target : null;
  const dayCell = target?.closest('[data-manager-board-day]');
  if (!dayCell) return;
  event.preventDefault();
  void openDayActivities(dayCell);
}

function syncPresentation() {
  if (!canUseManagerBoardInteractions()) return;
  document.querySelectorAll('.manager-board-screen[data-manager-board-root]').forEach(cleanupBoardPresentation);
}

function scheduleSync() {
  clearTimeout(observerTimer);
  observerTimer = window.setTimeout(syncPresentation, 30);
}

function start() {
  if (observer) return;
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown, true);
  observer = new MutationObserver(scheduleSync);
  observer.observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  scheduleSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { activitySeasonQueryValues, normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import { activityWorkDrawerHtml } from './screens/shared/activity-detail-html.js';
import { createSharedInteractionLayer } from './screens/shared/interactions.js';
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

function eventDescriptor(eventNode, context) {
  const title = text(eventNode?.getAttribute('title'));
  const parts = title.split('|').map(text);
  const meetingPart = parts.find((part) => /^מפגש\s+\d+/.test(part)) || '';
  const meetingNo = Number(meetingPart.match(/^מפגש\s+(\d+)/)?.[1] || 0);
  const timePart = parts.find((part) => /^\d{1,2}:\d{2}/.test(part)) || '';
  const startTime = normalizeClock(timePart.split(/[–-]/)[0]);
  const day = Number(text(eventNode?.closest('.manager-board-calendar-day')?.querySelector('.manager-board-calendar-day__number')?.textContent));
  const iso = context.ym && day ? `${context.ym}-${String(day).padStart(2, '0')}` : '';
  return {
    activityName: parts[0] || '',
    school: parts[1] || '',
    startTime,
    meetingNo,
    iso
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

function rowName(row) {
  return text(row?.activity_name || row?.program_name || row?.name || row?.title);
}

function rowSchool(row) {
  return text(row?.school || row?.single_school_name || row?.legacy_school);
}

function rowHasMeeting(row, descriptor) {
  if (!descriptor.iso) return false;
  if (descriptor.meetingNo > 0) {
    return text(row?.[`date_${descriptor.meetingNo}`]).slice(0, 10) === descriptor.iso;
  }
  return DATE_FIELDS.some((field) => text(row?.[field]).slice(0, 10) === descriptor.iso);
}

function scoreActivityMatch(row, descriptor) {
  if (!rowHasMeeting(row, descriptor)) return -1;
  let score = 10;
  if (descriptor.activityName && rowName(row) === descriptor.activityName) score += 6;
  if (descriptor.school && rowSchool(row) === descriptor.school) score += 4;
  if (descriptor.startTime && normalizeClock(row?.start_time) === descriptor.startTime) score += 3;
  return score;
}

async function resolveCalendarActivity(eventNode, context) {
  const descriptor = eventDescriptor(eventNode, context);
  const rows = await loadManagerActivities(context);
  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    const score = scoreActivityMatch(row, descriptor);
    if (score > bestScore) {
      best = row;
      bestScore = score;
    }
  }
  return best ? normalizeDrawerRow(best) : null;
}

function hideDrawerShellHeader(contentRoot) {
  const header = contentRoot?.closest('.ds-drawer')?.querySelector(':scope > header');
  if (header) header.hidden = true;
}

function restoreDrawerShellHeader() {
  const header = document.querySelector('.ds-drawer > header');
  if (header) header.hidden = false;
}

async function openCalendarActivity(eventNode) {
  const boardRoot = eventNode.closest('[data-manager-board-root]');
  if (!boardRoot || !canUseManagerBoardInteractions()) return;
  const context = boardContext(boardRoot);
  if (!context.manager || !context.ym) return;

  ui.openDrawer({
    title: '',
    content: '<div class="ds-loading-card" dir="rtl" role="status"><div class="ds-spinner" aria-hidden="true"></div><p>טוען פרטי פעילות…</p></div>',
    onOpen: hideDrawerShellHeader,
    onClose: restoreDrawerShellHeader
  });

  try {
    const row = await resolveCalendarActivity(eventNode, context);
    const contentRoot = document.querySelector('.ds-drawer__content');
    if (!contentRoot) return;
    if (!row) {
      contentRoot.innerHTML = '<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא נמצאו פרטי הפעילות לפתיחה.</p></div>';
      hideDrawerShellHeader(contentRoot);
      return;
    }
    contentRoot.innerHTML = activityWorkDrawerHtml(row, {
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
    });
    hideDrawerShellHeader(contentRoot);
    contentRoot.scrollTop = 0;
  } catch (error) {
    const contentRoot = document.querySelector('.ds-drawer__content');
    if (contentRoot) {
      contentRoot.innerHTML = `<div class="ds-empty" dir="rtl"><p class="ds-empty__msg">לא ניתן לפתוח את הפעילות כרגע.</p><small>${escapeHtml(error?.message || '')}</small></div>`;
      hideDrawerShellHeader(contentRoot);
    }
  }
}

function cleanupBoardPresentation(boardRoot) {
  if (!boardRoot) return;
  boardRoot.querySelector('.manager-board-hero > div:first-child > p')?.remove();
  const instructorsPanel = boardRoot.querySelector('.manager-board-panel--instructors');
  instructorsPanel?.querySelector('.manager-board-panel__head p')?.remove();

  boardRoot.querySelectorAll('.manager-board-calendar-event').forEach((eventNode) => {
    eventNode.setAttribute('role', 'button');
    eventNode.setAttribute('tabindex', '0');
    eventNode.setAttribute('aria-label', `פתיחת פעילות: ${text(eventNode.getAttribute('title'))}`);
  });
}

function handleClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const calendarEvent = target.closest('.manager-board-calendar-event');
  if (!calendarEvent) return;
  event.preventDefault();
  event.stopPropagation();
  void openCalendarActivity(calendarEvent);
}

function handleKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const target = event.target instanceof Element ? event.target : null;
  const calendarEvent = target?.closest('.manager-board-calendar-event');
  if (!calendarEvent) return;
  event.preventDefault();
  void openCalendarActivity(calendarEvent);
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

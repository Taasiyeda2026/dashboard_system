import { state } from './state.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import {
  activitySeasonQueryValues,
  globalActivityPeriodLabel,
  normalizeGlobalActivityPeriod,
  SCHOOL_2026_START_DATE,
  SCHOOL_2026_END_DATE,
  SCHOOL_2027_START_DATE,
  SCHOOL_2027_END_DATE
} from './screens/shared/summer-activity.js';
import { escapeHtml } from './screens/shared/html.js';
import { loadActiveBirthdays } from './birthday-calendar.js';

const MANAGER_BOARD_ACCESS_ROLES = new Set([
  'admin',
  'operation_manager',
  'activities_manager',
  'finance'
]);
const MANAGER_BOARD_SELF_ROLE = 'activities_manager';
const CLOSED_STATUSES = new Set([
  'בוטל', 'מבוטל', 'נמחק', 'סגור',
  'cancelled', 'canceled', 'deleted', 'closed', 'inactive'
]);
const DATE_FIELDS = Array.from({ length: 35 }, (_, index) => `date_${index + 1}`);
const ACTIVITY_SELECT = [
  'id',
  'row_id',
  'activity_manager',
  'authority',
  'school',
  'school_id',
  'activity_type',
  'activity_name',
  'program_name',
  'sessions',
  'status',
  'start_time',
  'end_time',
  'emp_id',
  'instructor_name',
  'emp_id_2',
  'instructor_name_2',
  'activity_season',
  ...DATE_FIELDS
].join(',');
const BOARD_CACHE_TTL_MS = 90 * 1000;
const monthFormatter = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('he-IL', { day: '2-digit', month: '2-digit' });

let managerBoardOpen = false;
let autoOpenedSessionKey = '';
let selectedManager = '';
let selectedYm = '';
let boardRequestId = 0;
let observer = null;
let observerTimer = null;
let lastRenderedSignature = '';
const dataCache = new Map();

function normalizedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizedName(value) {
  return normalizedText(value)
    .replace(/[״"'׳']/g, '')
    .toLocaleLowerCase('he-IL');
}

function currentRole() {
  return normalizedText(state?.user?.role);
}

function canUseManagerBoard() {
  return MANAGER_BOARD_ACCESS_ROLES.has(currentRole());
}

function isSelfManager() {
  return currentRole() === MANAGER_BOARD_SELF_ROLE;
}

function currentUserName() {
  const user = state?.user || {};
  return [
    user.full_name,
    user.name,
    user.display_name,
    user.username,
    user.email
  ].map(normalizedText).find(Boolean) || '';
}

function currentSessionKey() {
  const user = state?.user || {};
  return normalizedText(user.auth_user_id || user.user_id || user.email || user.username);
}

function parseIso(value) {
  const text = normalizedText(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function isClosedActivity(activity) {
  const status = normalizedText(activity?.status).toLocaleLowerCase('he-IL');
  return CLOSED_STATUSES.has(status);
}

function activityDates(activity) {
  const dates = [];
  DATE_FIELDS.forEach((field, index) => {
    const iso = parseIso(activity?.[field]);
    if (!iso) return;
    dates.push({
      iso,
      meetingNo: index + 1
    });
  });
  return dates;
}

function minutesFromTime(value) {
  const text = normalizedText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return (hours * 60) + minutes;
}

function activityDurationHours(activity) {
  const start = minutesFromTime(activity?.start_time);
  const end = minutesFromTime(activity?.end_time);
  if (start == null || end == null || end <= start) return null;
  return (end - start) / 60;
}

function periodBounds(period) {
  const normalized = normalizeGlobalActivityPeriod(period);
  if (normalized === 'school_2027') {
    return { start: SCHOOL_2027_START_DATE, end: SCHOOL_2027_END_DATE };
  }
  return { start: SCHOOL_2026_START_DATE, end: SCHOOL_2026_END_DATE };
}

function defaultMonthForPeriod(period) {
  const normalized = normalizeGlobalActivityPeriod(period);
  if (normalized === 'school_2027') return SCHOOL_2027_START_DATE.slice(0, 7);
  const today = new Date();
  const currentYm = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const { start, end } = periodBounds(normalized);
  if (currentYm >= start.slice(0, 7) && currentYm <= end.slice(0, 7)) return currentYm;
  return end.slice(0, 7);
}

function monthBounds(ym) {
  if (!/^\d{4}-\d{2}$/.test(ym)) return null;
  const [year, month] = ym.split('-').map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const toIso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return {
    first,
    last,
    startIso: toIso(first),
    endIso: toIso(last)
  };
}

function shiftMonth(ym, delta) {
  const [year, month] = ym.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym) {
  const [year, month] = ym.split('-').map(Number);
  return monthFormatter.format(new Date(year, month - 1, 1));
}

function formatShortDate(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  if (!year || !month || !day) return iso;
  return shortDateFormatter.format(new Date(year, month - 1, day));
}

function escapeAttr(value) {
  return escapeHtml(normalizedText(value));
}

function instructorKey(empId, name) {
  const id = normalizedText(empId);
  if (id) return `id:${id}`;
  return `name:${normalizedName(name)}`;
}

function pickManagerForSelf(managerNames) {
  const ownName = currentUserName();
  if (!ownName) return '';
  const ownNormalized = normalizedName(ownName);
  const exact = managerNames.find((name) => normalizedName(name) === ownNormalized);
  if (exact) return exact;

  const ownTokens = new Set(ownNormalized.split(' ').filter((token) => token.length > 1));
  let best = '';
  let bestScore = 0;
  managerNames.forEach((name) => {
    const tokens = normalizedName(name).split(' ').filter((token) => token.length > 1);
    const score = tokens.reduce((sum, token) => sum + (ownTokens.has(token) ? 1 : 0), 0);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? best : ownName;
}

function managerNamesFromData(data) {
  const names = new Set();
  (data?.activities || []).forEach((activity) => {
    const name = normalizedText(activity?.activity_manager);
    if (name) names.add(name);
  });
  (data?.managerUsers || []).forEach((user) => {
    const name = normalizedText(user?.full_name || user?.name);
    if (name) names.add(name);
  });
  if (isSelfManager()) {
    const ownName = currentUserName();
    if (ownName) names.add(ownName);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'he'));
}

const INACTIVE_INSTRUCTOR_VALUES = new Set(['no', 'false', '0', 'לא', 'לא פעיל', 'inactive', 'n']);
export function isActiveInstructor(instructor) {
  const value = normalizedText(instructor?.active).toLocaleLowerCase('he-IL');
  return !INACTIVE_INSTRUCTOR_VALUES.has(value);
}

export function activeTeamForManager(data, manager) {
  const key = normalizedName(manager);
  if (!key) return [];
  const seen = new Set();
  const result = [];
  (data?.instructors || []).forEach((instructor) => {
    if (normalizedName(instructor?.direct_manager) !== key) return;
    if (!isActiveInstructor(instructor)) return;
    const name = normalizedText(instructor?.full_name);
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push({ name, mobile: normalizedText(instructor?.mobile) });
  });
  return result.sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

export function activeTeamNamesForManager(data, manager) {
  return activeTeamForManager(data, manager).map((item) => item.name);
}

function safeRows(result) {
  if (!result || result.error || !Array.isArray(result.data)) return [];
  return result.data;
}

async function loadBoardData(period) {
  if (!supabase) throw new Error('Supabase client is not configured.');
  const normalizedPeriod = normalizeGlobalActivityPeriod(period);
  const cached = dataCache.get(normalizedPeriod);
  if (cached && Date.now() - cached.loadedAt < BOARD_CACHE_TTL_MS) return cached.data;

  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);

  const seasons = activitySeasonQueryValues(normalizedPeriod);
  const activityQuery = supabase
    .from('activities')
    .select(ACTIVITY_SELECT)
    .in('activity_season', seasons)
    .order('activity_manager', { ascending: true, nullsFirst: false });

  const instructorsQuery = supabase
    .from('contacts_instructors')
    .select('emp_id,full_name,direct_manager,active,mobile');

  const profileQuery = supabase
    .from('instructor_scheduling_profiles')
    .select('emp_id,weekly_target_hours,weekly_max_hours,preferred_work_days,max_fixed_courses');

  const calendarQuery = supabase
    .from('school_calendar')
    .select('id,title,category,start_date,end_date,resume_date,day_status,blocks_scheduling,show_on_main_calendar,is_active')
    .eq('is_active', true)
    .eq('show_on_main_calendar', true);

  const managerUsersQuery = supabase
    .from('users')
    .select('user_id,name,full_name,role,is_active')
    .eq('role', 'activities_manager')
    .eq('is_active', true);

  const [activitiesResult, instructorsResult, profileResult, calendarResult, managerUsersResult, birthdayRows] = await Promise.all([
    activityQuery,
    instructorsQuery,
    profileQuery,
    calendarQuery,
    managerUsersQuery,
    loadActiveBirthdays().catch(() => [])
  ]);

  if (activitiesResult.error) {
    throw new Error(activitiesResult.error.message || 'לא ניתן לטעון פעילויות');
  }

  const data = {
    period: normalizedPeriod,
    activities: safeRows(activitiesResult).filter((activity) => !isClosedActivity(activity)),
    instructors: safeRows(instructorsResult),
    profiles: safeRows(profileResult),
    schoolCalendar: safeRows(calendarResult),
    managerUsers: safeRows(managerUsersResult),
    birthdays: Array.isArray(birthdayRows) ? birthdayRows : []
  };

  dataCache.set(normalizedPeriod, { data, loadedAt: Date.now() });
  return data;
}

function buildMeetingRows(activities, ym) {
  const bounds = monthBounds(ym);
  if (!bounds) return [];
  const meetings = [];
  activities.forEach((activity) => {
    const dates = activityDates(activity);
    const configuredMeetings = Number(activity?.sessions);
    const totalMeetings = Number.isFinite(configuredMeetings) && configuredMeetings > 0
      ? configuredMeetings
      : dates.length;
    const midpointNumbers = new Set();
    if (totalMeetings > 1) {
      if (totalMeetings % 2 === 0) {
        midpointNumbers.add(totalMeetings / 2);
        midpointNumbers.add((totalMeetings / 2) + 1);
      } else {
        midpointNumbers.add(Math.ceil(totalMeetings / 2));
      }
    }
    const durationHours = activityDurationHours(activity);

    dates.forEach(({ iso, meetingNo }) => {
      if (iso < bounds.startIso || iso > bounds.endIso) return;
      meetings.push({
        iso,
        meetingNo,
        totalMeetings,
        isMidpoint: midpointNumbers.has(meetingNo),
        isEnd: totalMeetings > 0 && meetingNo === totalMeetings,
        durationHours,
        activity
      });
    });
  });
  return meetings.sort((a, b) => {
    if (a.iso !== b.iso) return a.iso.localeCompare(b.iso);
    const aStart = normalizedText(a.activity?.start_time);
    const bStart = normalizedText(b.activity?.start_time);
    if (aStart !== bStart) return aStart.localeCompare(bStart);
    return normalizedText(a.activity?.school).localeCompare(normalizedText(b.activity?.school), 'he');
  });
}

function managerActivitiesFor(data, manager) {
  const selected = normalizedText(manager);
  if (!selected) return [];
  const key = normalizedName(selected);
  return (data?.activities || []).filter((activity) => normalizedName(activity?.activity_manager) === key);
}

function schoolCalendarEventsForMonth(events, ym) {
  const bounds = monthBounds(ym);
  if (!bounds) return [];
  const rows = [];
  (events || []).forEach((event) => {
    let start = parseIso(event?.start_date);
    let end = parseIso(event?.end_date) || start;
    if (!start) return;
    if (end < bounds.startIso || start > bounds.endIso) return;
    if (start < bounds.startIso) start = bounds.startIso;
    if (end > bounds.endIso) end = bounds.endIso;
    let cursor = new Date(`${start}T12:00:00`);
    const last = new Date(`${end}T12:00:00`);
    while (cursor <= last) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
      rows.push({
        iso,
        title: normalizedText(event?.title),
        category: normalizedText(event?.category),
        dayStatus: normalizedText(event?.day_status),
        blocksScheduling: !!event?.blocks_scheduling
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  });
  return rows;
}

function profileMap(data) {
  return new Map((data?.profiles || []).map((profile) => [normalizedText(profile?.emp_id), profile]));
}

function instructorMonthStats(meetings, data) {
  const stats = new Map();
  const profiles = profileMap(data);

  const addInstructor = (empId, name, meeting) => {
    const cleanName = normalizedText(name);
    if (!cleanName) return;
    const key = instructorKey(empId, cleanName);
    if (!stats.has(key)) {
      const profile = profiles.get(normalizedText(empId));
      stats.set(key, {
        key,
        empId: normalizedText(empId),
        name: cleanName,
        meetings: 0,
        hours: 0,
        knownHours: 0,
        courseKeys: new Set(),
        profile
      });
    }
    const item = stats.get(key);
    item.meetings += 1;
    if (meeting.durationHours != null) {
      item.hours += meeting.durationHours;
      item.knownHours += 1;
    }
    item.courseKeys.add(normalizedText(meeting.activity?.row_id || meeting.activity?.id));
  };

  meetings.forEach((meeting) => {
    addInstructor(meeting.activity?.emp_id, meeting.activity?.instructor_name, meeting);
    addInstructor(meeting.activity?.emp_id_2, meeting.activity?.instructor_name_2, meeting);
  });

  return [...stats.values()]
    .map((item) => ({
      ...item,
      courses: item.courseKeys.size,
      monthlyTargetHours: Number(item.profile?.weekly_target_hours) > 0
        ? Number(item.profile.weekly_target_hours) * 4.33
        : null
    }))
    .sort((a, b) => {
      if (b.meetings !== a.meetings) return b.meetings - a.meetings;
      return a.name.localeCompare(b.name, 'he');
    });
}

function ringPercent(item) {
  if (!item.monthlyTargetHours || item.knownHours === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((item.hours / item.monthlyTargetHours) * 100)));
}

function plannedHoursText(hours, knownCount) {
  if (!knownCount) return '—';
  const rounded = Math.round(hours * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function renderInstructorCards(stats) {
  if (!stats.length) {
    return '<div class="manager-board-empty manager-board-empty--compact">אין מדריכים משובצים בחודש הנבחר.</div>';
  }

  return stats.map((item) => {
    const pct = ringPercent(item);
    const hours = plannedHoursText(item.hours, item.knownHours);
    const target = item.monthlyTargetHours
      ? Math.round(item.monthlyTargetHours * 10) / 10
      : null;
    const targetLine = target
      ? `${hours} מתוך יעד ${target} ש׳`
      : item.knownHours
        ? `${hours} שעות מתוכננות`
        : 'שעות לא הוגדרו בפעילויות';

    return `
      <article class="manager-board-instructor-card">
        <div class="manager-board-ring" style="--manager-ring-pct:${pct}" aria-label="${escapeAttr(`${pct}% מהיעד החודשי`)}">
          <div class="manager-board-ring__inner">
            <strong>${escapeHtml(hours)}</strong>
            <span>שעות</span>
          </div>
        </div>
        <div class="manager-board-instructor-card__text">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${item.courses} פעילויות · ${item.meetings} מפגשים</span>
          <small>${escapeHtml(targetLine)}</small>
        </div>
      </article>`;
  }).join('');
}

function renderMilestones(meetings) {
  const milestoneRows = meetings
    .filter((meeting) => meeting.meetingNo === 1 || meeting.isMidpoint || meeting.isEnd)
    .slice(0, 12);

  if (!milestoneRows.length) {
    return '<div class="manager-board-empty manager-board-empty--compact">אין נקודות בקרה בחודש זה.</div>';
  }

  return milestoneRows.map((meeting) => {
    const activity = meeting.activity || {};
    const labels = [];
    if (meeting.meetingNo === 1) labels.push('תחילת קורס · מפגש 1');
    if (meeting.isMidpoint) labels.push('אמצע קורס');
    if (meeting.isEnd) labels.push('סיום קורס');
    return `
      <div class="manager-board-milestone">
        <time datetime="${escapeAttr(meeting.iso)}">${escapeHtml(formatShortDate(meeting.iso))}</time>
        <div class="manager-board-milestone__body">
          <strong>${escapeHtml(normalizedText(activity.activity_name || activity.program_name) || 'פעילות')}</strong>
          <span>${escapeHtml(normalizedText(activity.school) || 'ללא בית ספר')}</span>
        </div>
        <span class="manager-board-milestone__badge">${escapeHtml(labels.join(' · '))}</span>
      </div>`;
  }).join('');
}

export function birthdaysForMonth(rows, ym) {
  const [yearText, monthText] = String(ym || '').split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return [];
  const byDay = new Map();
  (rows || []).forEach((row) => {
    const day = Number(row?.birth_day);
    if (Number(row?.birth_month) !== month || !day || day < 1 || day > 31) return;
    const name = normalizedText(row?.employee_name);
    if (!name) return;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!byDay.has(iso)) byDay.set(iso, []);
    byDay.get(iso).push(name);
  });
  return [...byDay.entries()].map(([iso, names]) => ({
    iso,
    title: names.length === 1 ? `יום הולדת ל${names[0]}` : `ימי הולדת: ${names.join(' · ')}`,
    isBirthday: true
  }));
}

/** "תאריכים חשובים": the main calendar's non-activity layer (holidays/events) plus everyone's birthdays, month-only. */
export function importantDateEntries(schoolEvents, birthdayRows, ym) {
  const entries = [];
  const seen = new Set();
  schoolEvents.forEach((event) => {
    const key = `${event.iso}|${event.title}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({
      iso: event.iso,
      title: event.title || event.dayStatus || 'אירוע לוח',
      isBirthday: false,
      blocksScheduling: event.blocksScheduling
    });
  });
  entries.push(...birthdaysForMonth(birthdayRows, ym));
  return entries.sort((a, b) => a.iso.localeCompare(b.iso));
}

function renderImportantDates(entries) {
  if (!entries.length) {
    return '<div class="manager-board-empty manager-board-empty--compact">אין תאריכים חשובים להצגה בחודש זה.</div>';
  }
  return entries.slice(0, 20).map((entry) => `
    <div class="manager-board-school-event${entry.blocksScheduling ? ' is-blocking' : ''}${entry.isBirthday ? ' is-birthday' : ''}">
      <time datetime="${escapeAttr(entry.iso)}">${escapeHtml(formatShortDate(entry.iso))}</time>
      <span>${entry.isBirthday ? '🎂 ' : ''}${escapeHtml(entry.title)}</span>
    </div>`).join('');
}

const CALENDAR_DAY_PREVIEW_LIMIT = 2;

/** Non-interactive preview line inside a day cell — identity comes from the activity name, not the school. */
function meetingPreviewHtml(meeting) {
  const activity = meeting.activity || {};
  const school = normalizedText(activity.school) || 'ללא בית ספר';
  const activityName = normalizedText(activity.activity_name || activity.program_name) || 'פעילות';
  const start = normalizedText(activity.start_time).slice(0, 5);
  const end = normalizedText(activity.end_time).slice(0, 5);
  const time = start && end ? `${start}–${end}` : '';
  const milestoneClass = meeting.isEnd ? ' is-end' : meeting.isMidpoint ? ' is-mid' : '';
  const milestone = meeting.isEnd ? ' · סיום' : meeting.isMidpoint ? ' · אמצע' : '';
  const title = [
    activityName,
    school,
    time,
    `מפגש ${meeting.meetingNo}${meeting.totalMeetings ? `/${meeting.totalMeetings}` : ''}${milestone}`
  ].filter(Boolean).join(' | ');

  return `
    <div class="manager-board-calendar-event${milestoneClass}" title="${escapeAttr(title)}">
      ${start ? `<strong>${escapeHtml(start)}</strong>` : ''}
      <span>${escapeHtml(activityName)}</span>
      ${meeting.isMidpoint || meeting.isEnd ? `<em>${meeting.isEnd ? 'סיום' : 'אמצע'}</em>` : ''}
    </div>`;
}

function renderCalendar(ym, meetings, schoolEvents) {
  const bounds = monthBounds(ym);
  if (!bounds) return '';

  const meetingsByDate = new Map();
  meetings.forEach((meeting) => {
    if (!meetingsByDate.has(meeting.iso)) meetingsByDate.set(meeting.iso, []);
    meetingsByDate.get(meeting.iso).push(meeting);
  });

  const schoolByDate = new Map();
  schoolEvents.forEach((event) => {
    if (!schoolByDate.has(event.iso)) schoolByDate.set(event.iso, []);
    schoolByDate.get(event.iso).push(event);
  });

  const cells = [];
  for (let i = 0; i < bounds.first.getDay(); i += 1) {
    cells.push('<div class="manager-board-calendar-day is-empty" aria-hidden="true"></div>');
  }

  for (let day = 1; day <= bounds.last.getDate(); day += 1) {
    const iso = `${ym}-${String(day).padStart(2, '0')}`;
    const dayMeetings = meetingsByDate.get(iso) || [];
    const daySchoolEvents = schoolByDate.get(iso) || [];
    const visibleMeetings = dayMeetings.slice(0, CALENDAR_DAY_PREVIEW_LIMIT);
    const extra = dayMeetings.length - visibleMeetings.length;
    const blocking = daySchoolEvents.some((event) => event.blocksScheduling);
    const schoolLabel = daySchoolEvents[0]?.title || '';
    const isToday = iso === new Date().toLocaleDateString('en-CA');
    const hasMeetings = dayMeetings.length > 0;

    cells.push(`
      <div class="manager-board-calendar-day${blocking ? ' is-school-blocked' : ''}${isToday ? ' is-today' : ''}"${hasMeetings ? ` data-manager-board-day="${escapeAttr(iso)}"` : ''}>
        <div class="manager-board-calendar-day__head">
          <span class="manager-board-calendar-day__number">${day}</span>
          ${schoolLabel ? `<span class="manager-board-calendar-day__school" title="${escapeAttr(schoolLabel)}">${escapeHtml(schoolLabel)}</span>` : ''}
        </div>
        <div class="manager-board-calendar-day__events">
          ${hasMeetings ? `<span class="manager-board-calendar-day__count">${dayMeetings.length} פעילויות</span>` : ''}
          ${visibleMeetings.map(meetingPreviewHtml).join('')}
          ${extra > 0 ? `<span class="manager-board-calendar-more">+${extra} נוספות</span>` : ''}
        </div>
      </div>`);
  }

  while (cells.length % 7 !== 0) {
    cells.push('<div class="manager-board-calendar-day is-empty" aria-hidden="true"></div>');
  }

  return `
    <div class="manager-board-calendar">
      <div class="manager-board-calendar__weekdays" aria-hidden="true">
        ${['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].map((day) => `<span>${day}</span>`).join('')}
      </div>
      <div class="manager-board-calendar__grid">${cells.join('')}</div>
    </div>`;
}

function managerSelectorHtml(managerNames, selected) {
  if (isSelfManager()) {
    return `<div class="manager-board-manager-fixed"><span>מנהל פעילות</span><strong>${escapeHtml(selected || currentUserName() || '—')}</strong></div>`;
  }

  if (!managerNames.length) {
    return '<div class="manager-board-manager-fixed"><span>מנהל פעילות</span><strong>אין מנהלים להצגה</strong></div>';
  }

  return `
    <label class="manager-board-manager-select">
      <span>מנהל פעילות</span>
      <select data-manager-board-manager>
        ${managerNames.map((name) => `<option value="${escapeAttr(name)}"${name === selected ? ' selected' : ''}>${escapeHtml(name)}</option>`).join('')}
      </select>
    </label>`;
}

function monthNavigationHtml(ym, period) {
  const bounds = periodBounds(period);
  const previous = shiftMonth(ym, -1);
  const next = shiftMonth(ym, 1);
  const canPrevious = previous >= bounds.start.slice(0, 7);
  const canNext = next <= bounds.end.slice(0, 7);
  return `
    <div class="manager-board-month-nav" aria-label="בחירת חודש">
      <button type="button" data-manager-board-month="-1"${canPrevious ? '' : ' disabled'} aria-label="החודש הקודם">‹</button>
      <strong>${escapeHtml(monthLabel(ym))}</strong>
      <button type="button" data-manager-board-month="1"${canNext ? '' : ' disabled'} aria-label="החודש הבא">›</button>
    </div>`;
}

function activeTeamStripHtml(team, activityCount) {
  const activityChip = `<span class="manager-board-team-strip__chip manager-board-team-strip__chip--kpi"><span>פעילויות פעילות</span><strong>${activityCount}</strong></span>`;
  const body = team.length
    ? `<div class="manager-board-team-strip__grid">${activityChip}${team.map((item) => `<button type="button" class="manager-board-team-strip__chip" data-instructor-mobile="${escapeAttr(item.mobile || '')}">${escapeHtml(item.name)}</button>`).join('')}</div>`
    : `<div class="manager-board-team-strip__grid">${activityChip}</div>`;
  return `
    <section class="manager-board-team-strip" data-manager-board-team-strip>
      <h2 class="manager-board-team-strip__title">צוות המדריכים הפעיל</h2>
      ${body}
    </section>`;
}

function workspaceShellHtml(activeTeamHtml) {
  // Tab id `payroll-attendance` is kept for backward compatibility; the UI label is "בקרת נוכחות אדמין".
  const adminTab = currentRole() === 'admin'
    ? '<button type="button" class="manager-workspace-tab" data-manager-workspace-tab="payroll-attendance" aria-selected="false">בקרת נוכחות אדמין</button>'
    : '';
  return `<nav class="manager-workspace-tabs" data-manager-workspace-tabs aria-label="לשוניות לוח מנהל">
    <button type="button" class="manager-workspace-tab is-active" data-manager-workspace-tab="management" aria-selected="true">ניהול</button>
    <button type="button" class="manager-workspace-tab" data-manager-workspace-tab="attendance" aria-selected="false">בקרת נוכחות</button>
    <button type="button" class="manager-workspace-tab" data-manager-workspace-tab="tracking" aria-selected="false">מעקב</button>
    ${adminTab}
  </nav>
  ${activeTeamHtml}
  <section class="manager-workspace-management-alerts" data-manager-workspace-management-alerts></section>
  <section class="manager-workspace-view" data-manager-workspace-view hidden></section>`;
}

function renderBoardMarkup(data, manager, ym) {
  const period = data.period;
  const activities = managerActivitiesFor(data, manager);
  const meetings = buildMeetingRows(activities, ym);
  const nextYm = shiftMonth(ym, 1);
  const nextMonthMeetings = buildMeetingRows(activities, nextYm);
  const instructorStats = instructorMonthStats(meetings, data);
  const schoolEvents = schoolCalendarEventsForMonth(data.schoolCalendar, ym);
  const managerNames = managerNamesFromData(data);
  const configuredTeam = (data.instructors || []).filter((instructor) =>
    normalizedName(instructor?.direct_manager) === normalizedName(manager)
  );
  const uniqueActivityRows = new Set(activities.map((activity) => normalizedText(activity.row_id || activity.id)).filter(Boolean));
  const activeTeam = activeTeamForManager(data, manager);

  return `
    <section class="manager-board-screen" data-manager-board-root dir="rtl">
      <div class="manager-board-hero">
        <div>
          <h1>לוח מנהל פעילות</h1>
        </div>
        <div class="manager-board-hero__controls">
          ${managerSelectorHtml(managerNames, manager)}
          ${monthNavigationHtml(ym, period)}
        </div>
      </div>

      ${workspaceShellHtml(activeTeamStripHtml(activeTeam, uniqueActivityRows.size))}


      <div class="manager-board-layout">
        <section class="manager-board-panel manager-board-panel--calendar">
          <div class="manager-board-panel__head">
            <div>
              <h2>לוח חודשי</h2>
              <p>${escapeHtml(manager || '—')} · ${escapeHtml(monthLabel(ym))}</p>
            </div>
            <div class="manager-board-legend" aria-label="מקרא">
              <span><i class="is-mid"></i>אמצע קורס</span>
              <span><i class="is-end"></i>סיום קורס</span>
            </div>
          </div>
          ${renderCalendar(ym, meetings, schoolEvents)}
        </section>

        <aside class="manager-board-side">
          <section class="manager-board-panel">
            <div class="manager-board-panel__head">
              <div>
                <h2>נקודות בקרה</h2>
              </div>
            </div>
            <div class="manager-board-milestones-group">
              <div class="manager-board-milestones-group__part">
                <p class="manager-board-milestones-group__label">נקודות בקרה – החודש</p>
                <div class="manager-board-milestones">${renderMilestones(meetings)}</div>
              </div>
              <div class="manager-board-milestones-group__part">
                <p class="manager-board-milestones-group__label">נקודות בקרה – חודש הבא</p>
                <div class="manager-board-milestones">${renderMilestones(nextMonthMeetings)}</div>
              </div>
            </div>
          </section>

          <section class="manager-board-panel">
            <div class="manager-board-panel__head">
              <div>
                <h2>תאריכים חשובים</h2>
              </div>
            </div>
            <div class="manager-board-school-events">${renderImportantDates(importantDateEntries(schoolEvents, data.birthdays, ym))}</div>
          </section>
        </aside>
      </div>

      <section class="manager-board-panel manager-board-panel--instructors">
        <div class="manager-board-panel__head">
          <div>
            <h2>מדריכים החודש</h2>
            <p>מוצגים רק מדריכים שיש להם מפגש מתוכנן אצל המנהל בחודש הנבחר.</p>
          </div>
        </div>
        <div class="manager-board-instructors">${renderInstructorCards(instructorStats)}</div>
      </section>
    </section>`;
}

function renderLoading(root) {
  root.innerHTML = `
    <section class="manager-board-screen manager-board-screen--loading" data-manager-board-root dir="rtl">
      <div class="manager-board-loading-card">
        <span class="manager-board-spinner" aria-hidden="true"></span>
        <strong>טוען לוח מנהל…</strong>
        <small>מרכז פעילויות, תאריכים ומדריכים למסך אחד.</small>
      </div>
    </section>`;
}

function renderError(root, error) {
  root.innerHTML = `
    <section class="manager-board-screen" data-manager-board-root dir="rtl">
      <div class="manager-board-error">
        <strong>לא ניתן לטעון את לוח המנהל</strong>
        <p>${escapeHtml(error?.message || 'אירעה תקלה זמנית בטעינת הנתונים.')}</p>
        <button type="button" data-manager-board-retry>נסה שוב</button>
      </div>
    </section>`;
  root.querySelector('[data-manager-board-retry]')?.addEventListener('click', () => {
    dataCache.clear();
    void renderManagerBoard(true);
  });
}

function setBoardActiveNav() {
  const app = document.getElementById('app');
  if (!app) return;
  app.querySelectorAll('.manager-board-nav-button').forEach((button) => {
    button.classList.toggle('is-active', managerBoardOpen);
  });
  if (managerBoardOpen) {
    app.querySelectorAll('[data-route="dashboard"]').forEach((button) => button.classList.remove('is-active'));
    const mobileBrand = app.querySelector('.shell-top__mobile-brand');
    if (mobileBrand) mobileBrand.textContent = 'לוח מנהל';
  }
}

function bindBoardControls(root, data) {
  root.querySelector('[data-manager-board-manager]')?.addEventListener('change', (event) => {
    selectedManager = normalizedText(event.target.value);
    try {
      localStorage.setItem(`manager_board_manager:${data.period}`, selectedManager);
    } catch {
      // Ignore storage restrictions.
    }
    lastRenderedSignature = '';
    void renderManagerBoard(false);
  });

  root.querySelectorAll('[data-manager-board-month]').forEach((button) => {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.managerBoardMonth || 0);
      if (!delta) return;
      selectedYm = shiftMonth(selectedYm, delta);
      try {
        localStorage.setItem(`manager_board_month:${data.period}`, selectedYm);
      } catch {
        // Ignore storage restrictions.
      }
      lastRenderedSignature = '';
      void renderManagerBoard(false);
    });
  });
}

function restoreSelections(data) {
  const period = data.period;
  const managerNames = managerNamesFromData(data);
  if (isSelfManager()) {
    selectedManager = pickManagerForSelf(managerNames);
  } else {
    let stored = '';
    try {
      stored = normalizedText(localStorage.getItem(`manager_board_manager:${period}`));
    } catch {
      stored = '';
    }
    if (selectedManager && managerNames.includes(selectedManager)) {
      // Keep current selection.
    } else if (stored && managerNames.includes(stored)) {
      selectedManager = stored;
    } else {
      selectedManager = managerNames[0] || '';
    }
  }

  const bounds = periodBounds(period);
  let storedYm = '';
  try {
    storedYm = normalizedText(localStorage.getItem(`manager_board_month:${period}`));
  } catch {
    storedYm = '';
  }
  const minYm = bounds.start.slice(0, 7);
  const maxYm = bounds.end.slice(0, 7);
  if (selectedYm >= minYm && selectedYm <= maxYm) return;
  if (/^\d{4}-\d{2}$/.test(storedYm) && storedYm >= minYm && storedYm <= maxYm) {
    selectedYm = storedYm;
    return;
  }
  selectedYm = defaultMonthForPeriod(period);
}

async function renderManagerBoard(force = false) {
  if (!managerBoardOpen || !canUseManagerBoard()) return;
  const root = document.getElementById('screenRoot');
  if (!root) return;

  const period = normalizeGlobalActivityPeriod(state?.activityPeriodTab);
  const requestId = ++boardRequestId;
  const provisionalSignature = `${period}|${selectedManager}|${selectedYm}`;

  if (!force && root.querySelector('[data-manager-board-root]') && lastRenderedSignature === provisionalSignature) {
    setBoardActiveNav();
    return;
  }

  renderLoading(root);
  setBoardActiveNav();

  try {
    const data = await loadBoardData(period);
    if (requestId !== boardRequestId || !managerBoardOpen) return;
    restoreSelections(data);
    const signature = `${data.period}|${selectedManager}|${selectedYm}`;
    root.innerHTML = renderBoardMarkup(data, selectedManager, selectedYm);
    lastRenderedSignature = signature;
    bindBoardControls(root, data);
    setBoardActiveNav();
  } catch (error) {
    if (requestId !== boardRequestId || !managerBoardOpen) return;
    renderError(root, error);
    setBoardActiveNav();
  }
}

function ensureManagerBoardButtons() {
  document.querySelectorAll('.shell-header-nav .manager-board-nav-button').forEach((button) => button.remove());

  if (!canUseManagerBoard()) {
    document.querySelectorAll('.manager-board-nav-button').forEach((button) => button.remove());
    return;
  }

  const sidebarNav = document.querySelector('.shell-nav');
  if (sidebarNav && !sidebarNav.querySelector('.manager-board-nav-button')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shell-nav__btn manager-board-nav-button';
    button.dataset.managerBoardOpen = 'true';
    button.textContent = 'לוח מנהל';
    const dashboardButton = sidebarNav.querySelector('[data-route="dashboard"]');
    if (dashboardButton?.nextSibling) {
      sidebarNav.insertBefore(button, dashboardButton.nextSibling);
    } else if (dashboardButton) {
      dashboardButton.insertAdjacentElement('afterend', button);
    } else {
      sidebarNav.prepend(button);
    }
  }

  setBoardActiveNav();
}

function openManagerBoard() {
  if (!canUseManagerBoard()) return;
  managerBoardOpen = true;
  lastRenderedSignature = '';

  if (state.route !== 'dashboard') {
    document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
  }

  window.setTimeout(() => {
    ensureManagerBoardButtons();
    void renderManagerBoard(false);
  }, 0);
}

function closeManagerBoard() {
  if (!managerBoardOpen) return;
  managerBoardOpen = false;
  boardRequestId += 1;
  lastRenderedSignature = '';
  setBoardActiveNav();
}

function maybeAutoOpenForActivityManager() {
  if (!canUseManagerBoard() || !isSelfManager()) return;
  const sessionKey = currentSessionKey();
  if (!sessionKey || autoOpenedSessionKey === sessionKey) return;
  const shell = document.querySelector('.app-shell');
  if (!shell || !state?.token) return;
  autoOpenedSessionKey = sessionKey;
  openManagerBoard();
}

function handleDocumentClick(event) {
  const openButton = event.target.closest('[data-manager-board-open]');
  if (openButton) {
    event.preventDefault();
    event.stopPropagation();
    openManagerBoard();
    return;
  }

  const routeButton = event.target.closest('[data-route]');
  if (routeButton && managerBoardOpen) {
    closeManagerBoard();
    return;
  }

  if (event.target.closest('.shell-logout-btn, #logoutBtn')) {
    closeManagerBoard();
    autoOpenedSessionKey = '';
    selectedManager = '';
    selectedYm = '';
    dataCache.clear();
  }
}

function syncRuntime() {
  ensureManagerBoardButtons();
  maybeAutoOpenForActivityManager();

  if (!managerBoardOpen) return;
  if (!canUseManagerBoard()) {
    closeManagerBoard();
    return;
  }

  const root = document.getElementById('screenRoot');
  if (!root) return;
  const boardExists = !!root.querySelector('[data-manager-board-root]');
  const period = normalizeGlobalActivityPeriod(state?.activityPeriodTab);
  const expectedPrefix = `${period}|`;
  if (!boardExists || (lastRenderedSignature && !lastRenderedSignature.startsWith(expectedPrefix))) {
    lastRenderedSignature = '';
    void renderManagerBoard(false);
  } else {
    setBoardActiveNav();
  }
}

function scheduleRuntimeSync() {
  clearTimeout(observerTimer);
  observerTimer = window.setTimeout(syncRuntime, 30);
}

function startManagerBoardRuntime() {
  if (observer) return;
  document.addEventListener('click', handleDocumentClick, true);
  observer = new MutationObserver(scheduleRuntimeSync);
  observer.observe(document.getElementById('app') || document.body, {
    childList: true,
    subtree: true
  });
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith('manager_board_')) return;
    scheduleRuntimeSync();
  });
  scheduleRuntimeSync();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startManagerBoardRuntime, { once: true });
} else {
  startManagerBoardRuntime();
}

import { compactSchoolCalendarLabel, dedupeSchoolCalendarOccurrences, schoolCalendarEventsForDate } from '../shared/school-calendar-logic.js';
import { ACTIVE_ACTIVITY_SEASON, SCHOOL_2027_START_DATE, SCHOOL_2027_END_DATE } from '../shared/summer-activity.js';

const ACTIVE_CALENDAR_START_MONTH = SCHOOL_2027_START_DATE.slice(0, 7);
const ACTIVE_CALENDAR_END_MONTH = SCHOOL_2027_END_DATE.slice(0, 7);
export const INSTRUCTOR_CALENDAR_ACTIVE_PERIOD = ACTIVE_ACTIVITY_SEASON;

export function clampInstructorCalendarMonth(month) {
  const candidate = /^\d{4}-\d{2}$/.test(String(month || '')) ? String(month) : ACTIVE_CALENDAR_START_MONTH;
  if (candidate < ACTIVE_CALENDAR_START_MONTH) return ACTIVE_CALENDAR_START_MONTH;
  if (candidate > ACTIVE_CALENDAR_END_MONTH) return ACTIVE_CALENDAR_END_MONTH;
  return candidate;
}

export function moveInstructorCalendarMonth(month, offset) {
  const current = clampInstructorCalendarMonth(month);
  const [year, monthNumber] = current.split('-').map(Number);
  const next = new Date(year, monthNumber - 1 + offset, 1);
  const candidate = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  return candidate < ACTIVE_CALENDAR_START_MONTH || candidate > ACTIVE_CALENDAR_END_MONTH ? current : candidate;
}

function schoolOccurrenceKey(event) {
  return [event.title, event.start_date, event.end_date, event.category, event.day_status, event.blocks_scheduling, event.enforce_end_time, event.school_day_end_time]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .join('|');
}

function consolidateEquivalentSectorOccurrences(events) {
  const output = [];
  const byOccurrence = new Map();
  events.forEach((event) => {
    const key = schoolOccurrenceKey(event);
    const prior = byOccurrence.get(key);
    const sector = String(event.calendar_sector || '').trim();
    if (prior && String(prior.calendar_sector || '').trim() !== sector) return;
    if (!prior) byOccurrence.set(key, event);
    output.push(event);
  });
  return output;
}

export function organizationalEventsForDate(calendarRows, birthdays, isoDate) {
  const month = Number(String(isoDate).slice(5, 7));
  const day = Number(String(isoDate).slice(8, 10));
  const schoolEvents = dedupeSchoolCalendarOccurrences(consolidateEquivalentSectorOccurrences(schoolCalendarEventsForDate(Array.isArray(calendarRows) ? calendarRows : [], isoDate))).map((event) => ({
    ...event,
    kind: 'school-calendar',
    displayTitle: event.title
  }));
  const birthdayEvents = (Array.isArray(birthdays) ? birthdays : []).filter((row) => Number(row.birth_month) === month && Number(row.birth_day) === day).map((row) => ({ kind: 'birthday', title: `יום הולדת ל${row.employee_name}`, displayTitle: `🎂 יום הולדת ל${row.employee_name}` }));
  return [...schoolEvents, ...birthdayEvents];
}

export function instructorActivityEventsForDate(activities = [], isoDate) {
  const target = String(isoDate || '').slice(0, 10);
  const seen = new Set();
  const events = [];
  for (const activity of Array.isArray(activities) ? activities : []) {
    for (let index = 1; index <= 35; index += 1) {
      const date = String(activity?.[`date_${index}`] || (index === 1 ? activity?.start_date || activity?.activity_date : '') || '').slice(0, 10);
      if (date !== target) continue;
      const activityId = String(activity?.RowID || activity?.row_id || activity?.id || activity?.activity_name || '');
      const key = `${activityId}|${target}|${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({ ...activity, kind: 'instructor-activity', meetingNo: index, displayTitle: String(activity?.activity_name || activity?.program_name || 'פעילות') });
    }
  }
  return events;
}

export function organizationalCalendarDayLabel(events = []) {
  const birthdays = events.filter((event) => event.kind === 'birthday').map((event) => event.displayTitle);
  const schoolEvents = events.filter((event) => event.kind === 'school-calendar').map((event) => ({ ...event, title: event.displayTitle }));
  return [...birthdays, compactSchoolCalendarLabel(schoolEvents, { maxTitles: 1 })].filter(Boolean).join(' · ');
}

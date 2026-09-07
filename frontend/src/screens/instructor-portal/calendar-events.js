import { compactSchoolCalendarLabel, schoolCalendarEventsForDate } from '../shared/school-calendar-logic.js';

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
  const schoolEvents = consolidateEquivalentSectorOccurrences(schoolCalendarEventsForDate(Array.isArray(calendarRows) ? calendarRows : [], isoDate)).map((event) => ({
    ...event,
    kind: 'school-calendar',
    displayTitle: event.title
  }));
  const birthdayEvents = (Array.isArray(birthdays) ? birthdays : []).filter((row) => Number(row.birth_month) === month && Number(row.birth_day) === day).map((row) => ({ kind: 'birthday', title: `יום הולדת ל${row.employee_name}`, displayTitle: `🎂 יום הולדת ל${row.employee_name}` }));
  return [...schoolEvents, ...birthdayEvents];
}

export function organizationalCalendarDayLabel(events = []) {
  const birthdays = events.filter((event) => event.kind === 'birthday').map((event) => event.displayTitle);
  const schoolEvents = events.filter((event) => event.kind === 'school-calendar').map((event) => ({ ...event, title: event.displayTitle }));
  return [...birthdays, compactSchoolCalendarLabel(schoolEvents, { maxTitles: 1 })].filter(Boolean).join(' · ');
}

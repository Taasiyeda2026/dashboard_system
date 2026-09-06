import { calendarSectorLabel, compactSchoolCalendarLabel, schoolCalendarEventsForDate } from '../shared/school-calendar-logic.js';

export function organizationalEventsForDate(calendarRows, birthdays, isoDate) {
  const month = Number(String(isoDate).slice(5, 7));
  const day = Number(String(isoDate).slice(8, 10));
  const schoolEvents = schoolCalendarEventsForDate(Array.isArray(calendarRows) ? calendarRows : [], isoDate).map((event) => ({
    ...event,
    kind: 'school-calendar',
    displayTitle: `${event.title}${calendarSectorLabel(event.calendar_sector) ? ` · ${calendarSectorLabel(event.calendar_sector)}` : ''}`
  }));
  const birthdayEvents = (Array.isArray(birthdays) ? birthdays : []).filter((row) => Number(row.birth_month) === month && Number(row.birth_day) === day).map((row) => ({ kind: 'birthday', title: `יום הולדת ל${row.employee_name}`, displayTitle: `🎂 יום הולדת ל${row.employee_name}` }));
  return [...schoolEvents, ...birthdayEvents];
}

export function organizationalCalendarDayLabel(events = []) {
  const birthdays = events.filter((event) => event.kind === 'birthday').map((event) => event.displayTitle);
  const schoolEvents = events.filter((event) => event.kind === 'school-calendar').map((event) => ({ ...event, title: event.displayTitle }));
  return [...birthdays, compactSchoolCalendarLabel(schoolEvents, { maxTitles: 1 })].filter(Boolean).join(' · ');
}

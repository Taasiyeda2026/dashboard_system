import { escapeHtml } from '../shared/html.js';
import { formatDateHe } from '../shared/format-date.js';
import { dsEmptyState } from '../shared/layout.js';
import { instructorActivityId } from './activity-drawer.js';
import { instructorAttendanceCardsHtml, instructorAttendanceRecordsForDate } from './attendance-card.js';

export function instructorCalendarDayDrawerHtml(events = [], attendanceRows = [], date = '') {
  const attendance = instructorAttendanceRecordsForDate(attendanceRows, date);
  if (!events.length && !attendance.length) return dsEmptyState('אין אירועים בתאריך זה');
  const eventHtml = events.map((event) => event.kind === 'instructor-activity'
    ? `<button type="button" class="instr-activity-card instr-calendar-activity-open" data-calendar-activity="${escapeHtml(instructorActivityId(event))}"><strong>${escapeHtml(event.displayTitle)}</strong><small>מפגש ${event.meetingNo}${event.school ? ` · ${escapeHtml(event.school)}` : ''}</small></button>`
    : `<article class="instr-activity-card"><div><strong>${escapeHtml(event.displayTitle)}</strong></div></article>`).join('');
  return `<div class="instr-day-drawer"><h3>${escapeHtml(formatDateHe(date) || date)}</h3>${eventHtml}${instructorAttendanceCardsHtml(attendance, date)}</div>`;
}

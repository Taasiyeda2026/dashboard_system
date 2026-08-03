import { escapeHtml } from './shared/html.js';
import { activityMeetings } from './instructor-scheduling-load.js';
import { formatDateHe, formatTimeRangeShort } from './shared/format-date.js';

const text = (value) => String(value ?? '').trim();
const idOf = (row) => text(row?.row_id || row?.RowID || row?.id);

export const WEEKDAY_LABELS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(anchorDate) {
  const date = new Date(`${text(anchorDate) || toIsoDate(new Date())}T12:00:00`);
  date.setDate(date.getDate() - date.getDay());
  return toIsoDate(date);
}

// Sunday..Friday only: Saturday is an absolute scheduling block (spec section 12), so the
// grid never wastes a column on it.
export function weekRange(anchorDate) {
  const start = startOfWeek(anchorDate);
  const startDate = new Date(`${start}T12:00:00`);
  const days = Array.from({ length: 6 }, (_, index) => {
    const day = new Date(startDate);
    day.setDate(day.getDate() + index);
    return toIsoDate(day);
  });
  return { start, end: days[days.length - 1], days };
}

export function shiftWeek(anchorDate, deltaWeeks) {
  const date = new Date(`${startOfWeek(anchorDate)}T12:00:00`);
  date.setDate(date.getDate() + deltaWeeks * 7);
  return toIsoDate(date);
}

function courseInstructor(course) {
  if (text(course.emp_id)) return { empId: text(course.emp_id), name: course.instructor_name || text(course.emp_id), kind: 'assigned' };
  if (text(course.draft_emp_id)) return { empId: text(course.draft_emp_id), name: course.draft_instructor_name || text(course.draft_emp_id), kind: 'draft' };
  return null;
}

/**
 * Builds the weekly-grid row model: one row per instructor with a saved or draft
 * assignment whose meetings fall inside the given week, each holding the day-by-day
 * blocks to render. Courses without an instructor yet never appear here — they belong
 * only in the pending-courses list, never on the calendar.
 */
export function buildWeekRows(activities = [], days = []) {
  const daySet = new Set(days);
  const rows = new Map();
  for (const course of activities) {
    const instructor = courseInstructor(course);
    if (!instructor) continue;
    const meetings = activityMeetings(course).filter((meeting) => daySet.has(text(meeting.date)));
    if (!meetings.length) continue;
    if (!rows.has(instructor.empId)) rows.set(instructor.empId, { empId: instructor.empId, name: instructor.name, byDay: new Map(days.map((day) => [day, []])) });
    const row = rows.get(instructor.empId);
    if (instructor.name && instructor.name !== row.name && instructor.kind === 'assigned') row.name = instructor.name;
    for (const meeting of meetings) {
      row.byDay.get(text(meeting.date)).push({
        course,
        kind: instructor.kind,
        start: meeting.start_time || course.start_time,
        end: meeting.end_time || course.end_time
      });
    }
  }
  for (const row of rows.values()) {
    for (const blocks of row.byDay.values()) blocks.sort((a, b) => text(a.start).localeCompare(text(b.start)));
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
}

function blockHtml(block) {
  const course = block.course;
  const classes = ['course-scheduling-calendar-block', `course-scheduling-calendar-block--${block.kind}`];
  const title = block.kind === 'draft' ? `${course.activity_name || ''} (טיוטה)` : (course.activity_name || '');
  return `<button type="button" class="${classes.join(' ')}" data-calendar-course="${escapeHtml(idOf(course))}" title="${escapeHtml(course.school || '')}">
    <span class="course-scheduling-calendar-block-time"><bdi dir="ltr">${escapeHtml(formatTimeRangeShort(block.start, block.end))}</bdi></span>
    <span class="course-scheduling-calendar-block-name">${escapeHtml(title)}</span>
    <span class="course-scheduling-calendar-block-school">${escapeHtml(course.school || '')}</span>
  </button>`;
}

export function weekCalendarHtml({ days, rows, selectedCourseId } = {}) {
  if (!rows.length) return '<p class="course-scheduling-calendar-empty">אין מדריכים משובצים או בטיוטה בשבוע זה.</p>';
  const header = days.map((day, index) => `<th><span>${escapeHtml(WEEKDAY_LABELS[index])}</span><bdi dir="ltr">${escapeHtml(formatDateHe(day))}</bdi></th>`).join('');
  const bodyRows = rows.map((row) => {
    const cells = days.map((day) => {
      const blocks = row.byDay.get(day) || [];
      const highlighted = selectedCourseId && blocks.some((block) => idOf(block.course) === selectedCourseId);
      return `<td class="course-scheduling-calendar-cell${highlighted ? ' is-selected-day' : ''}">${blocks.map(blockHtml).join('')}</td>`;
    }).join('');
    return `<tr><th class="course-scheduling-calendar-instructor" scope="row">${escapeHtml(row.name)}</th>${cells}</tr>`;
  }).join('');
  return `<div class="course-scheduling-calendar-scroll"><table class="course-scheduling-calendar-table"><thead><tr><th></th>${header}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}

/**
 * "מערכת קבועה" (fixed schedule): one block per course per instructor, independent of
 * any specific week, showing weekday + hours + full date range instead of every meeting.
 */
export function fixedScheduleHtml(activities = [], selectedCourseId) {
  const rows = new Map();
  for (const course of activities) {
    const instructor = courseInstructor(course);
    if (!instructor) continue;
    const meetings = activityMeetings(course);
    if (!meetings.length) continue;
    const weekday = new Intl.DateTimeFormat('he-IL', { weekday: 'long' }).format(new Date(`${meetings[0].date}T12:00:00`));
    const dates = meetings.map((meeting) => text(meeting.date)).sort();
    if (!rows.has(instructor.empId)) rows.set(instructor.empId, { empId: instructor.empId, name: instructor.name, items: [] });
    rows.get(instructor.empId).items.push({ course, kind: instructor.kind, weekday, start: course.start_time, end: course.end_time, from: dates[0], to: dates.at(-1) });
  }
  const sortedRows = [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'));
  if (!sortedRows.length) return '<p class="course-scheduling-calendar-empty">אין מדריכים משובצים או בטיוטה עדיין.</p>';
  return `<div class="course-scheduling-calendar-scroll"><table class="ds-table course-scheduling-calendar-fixed-table"><thead><tr><th>מדריך</th><th>יום ושעה</th><th>קורס</th><th>בית ספר</th><th>טווח תאריכים</th></tr></thead><tbody>${sortedRows.map((row) => row.items.map((item, index) => `<tr class="${[item.kind === 'draft' ? 'course-scheduling-calendar-fixed-row--draft' : '', idOf(item.course) === selectedCourseId ? 'is-selected-day' : ''].filter(Boolean).join(' ')}"><td>${index === 0 ? escapeHtml(row.name) : ''}</td><td>${escapeHtml(item.weekday)} <bdi dir="ltr">${escapeHtml(formatTimeRangeShort(item.start, item.end))}</bdi></td><td><button type="button" class="ds-link-btn" data-calendar-course="${escapeHtml(idOf(item.course))}">${escapeHtml(item.course.activity_name || '—')}</button>${item.kind === 'draft' ? ' <span class="ds-status-chip">טיוטה</span>' : ''}</td><td>${escapeHtml(item.course.school || '—')}</td><td><bdi dir="ltr">${escapeHtml(formatDateHe(item.from))}–${escapeHtml(formatDateHe(item.to))}</bdi></td></tr>`).join('')).join('')}</tbody></table></div>`;
}

export function weekNavLabel({ start, end } = {}) {
  return `<bdi dir="ltr">${escapeHtml(formatDateHe(start))} – ${escapeHtml(formatDateHe(end))}</bdi>`;
}

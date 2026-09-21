/**
 * mini-calendar.js — compact month calendar for My Reports.
 * Uses the same event model as the instructor calendar while keeping fixed,
 * compact day-cell dimensions.
 */

import { attendanceCalendarEventsForDate } from '../services/calendar.service.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

function compactLabel(dayEvents = {}) {
  const school = dayEvents.schoolEvents || [];
  const birthdays = dayEvents.birthdays || [];
  if (school.length) {
    return {
      text: String(school[0]?.title || '').trim(),
      tone: school.some((event) => event?.blocks_scheduling) ? 'holiday' : 'event',
      extra: Math.max(0, school.length + birthdays.length - 1),
    };
  }
  if (birthdays.length) {
    return {
      text: `🎂 ${String(birthdays[0]?.employee_name || '').trim()}`,
      tone: 'birthday',
      extra: Math.max(0, birthdays.length - 1),
    };
  }
  return null;
}

/**
 * @param {number}   year
 * @param {number}   month             1-based
 * @param {Array}    records           attendance records for this month
 * @param {object}   calendarContext   activities, school calendar, birthdays
 * @param {Function} [onDayClick]      (dateStr, dayEvents) => void
 * @param {Function} [onEmptyDayClick] legacy fallback when onDayClick is absent
 * @param {string}   [variant]         extra modifier class
 * @returns {{ wrap: HTMLElement, clearSelection: () => void }}
 */
export function createMiniCalendar({
  year,
  month,
  records = [],
  calendarContext = {},
  onDayClick,
  onEmptyDayClick,
  variant = '',
} = {}) {
  const pad = (n) => String(n).padStart(2, '0');

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

  const recordsByDate = new Map();
  for (const record of records) {
    const date = String(record?.report_date || '').slice(0, 10);
    if (!date) continue;
    if (!recordsByDate.has(date)) recordsByDate.set(date, []);
    recordsByDate.get(date).push(record);
  }

  const wrap = document.createElement('div');
  wrap.className = 'av2-cal' + (variant ? ` av2-cal--${variant}` : '');

  const header = document.createElement('div');
  header.className = 'av2-cal__header';
  for (const dayName of DAY_NAMES) {
    const cell = document.createElement('div');
    cell.className = 'av2-cal__day-name';
    if (dayName === 'שבת') cell.classList.add('av2-cal__day-name--saturday');
    cell.textContent = dayName;
    header.append(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'av2-cal__grid';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const startDow = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  let selectedCell = null;
  let gridIndex = 0;

  const appendBlankCell = () => {
    const empty = document.createElement('div');
    empty.className = 'av2-cal__cell av2-cal__cell--empty';
    if (gridIndex % 7 === 6) empty.classList.add('av2-cal__cell--saturday');
    grid.append(empty);
    gridIndex += 1;
  };

  for (let i = 0; i < startDow; i += 1) appendBlankCell();

  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const dayRecords = recordsByDate.get(dateStr) || [];
    const dayEvents = attendanceCalendarEventsForDate(calendarContext, dateStr);
    const hasAttendance = dayRecords.length > 0;
    const hasActivity = dayEvents.activities.length > 0;
    const label = compactLabel(dayEvents);
    const isToday = dateStr === todayStr;
    const isSaturday = new Date(year, month - 1, day).getDay() === 6;

    const cell = document.createElement('div');
    cell.dataset.calendarDate = dateStr;
    cell.className = 'av2-cal__cell' +
      (isToday ? ' av2-cal__cell--today' : '') +
      (hasAttendance ? ' av2-cal__cell--has-record' : '') +
      (hasActivity ? ' av2-cal__cell--has-activity' : '') +
      (label ? ` av2-cal__cell--has-${label.tone}` : '') +
      (isSaturday ? ' av2-cal__cell--saturday' : '');

    if (isToday) cell.setAttribute('aria-current', 'date');

    const num = document.createElement('span');
    num.className = 'av2-cal__day-num';
    num.textContent = String(day);
    cell.append(num);

    if (label?.text) {
      const chip = document.createElement('span');
      chip.className = `av2-cal__event-label av2-cal__event-label--${label.tone}`;
      chip.textContent = label.text;
      chip.title = [
        ...(dayEvents.schoolEvents || []).map((event) => String(event?.title || '').trim()),
        ...(dayEvents.birthdays || []).map((birthday) => `יום הולדת ל${String(birthday?.employee_name || '').trim()}`),
      ].filter(Boolean).join('\n');
      cell.append(chip);

      if (label.extra > 0) {
        const more = document.createElement('span');
        more.className = 'av2-cal__event-more';
        more.textContent = `+${label.extra}`;
        cell.append(more);
      }
    }

    if (hasActivity || hasAttendance) {
      const indicators = document.createElement('span');
      indicators.className = 'av2-cal__indicators';
      indicators.setAttribute('aria-hidden', 'true');
      if (hasActivity) {
        const activityDot = document.createElement('span');
        activityDot.className = 'av2-cal__activity-dot';
        indicators.append(activityDot);
      }
      if (hasAttendance) {
        const attendanceDot = document.createElement('span');
        attendanceDot.className = 'av2-cal__attendance-dot';
        indicators.append(attendanceDot);
      }
      cell.append(indicators);
    }

    const allEventCount =
      dayEvents.activities.length + dayEvents.schoolEvents.length +
      dayEvents.birthdays.length + dayRecords.length;
    const ariaParts = [`${day} בחודש`];
    if (dayEvents.activities.length) ariaParts.push(`${dayEvents.activities.length} פעילויות`);
    if (dayRecords.length) ariaParts.push(`${dayRecords.length} דיווחי נוכחות`);
    if (dayEvents.schoolEvents.length) ariaParts.push(`${dayEvents.schoolEvents.length} אירועי לוח`);
    if (dayEvents.birthdays.length) ariaParts.push(`${dayEvents.birthdays.length} ימי הולדת`);
    if (!allEventCount) ariaParts.push('אין אירועים');

    const select = () => {
      if (selectedCell) selectedCell.classList.remove('av2-cal__cell--selected');
      cell.classList.add('av2-cal__cell--selected');
      selectedCell = cell;
      if (onDayClick) onDayClick(dateStr, { ...dayEvents, records: dayRecords });
      else if (!allEventCount && onEmptyDayClick) onEmptyDayClick(dateStr);
    };

    if (onDayClick || (!allEventCount && onEmptyDayClick)) {
      cell.classList.add('av2-cal__cell--clickable');
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-label', ariaParts.join(' — '));
      cell.addEventListener('click', select);
      cell.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select();
        }
      });
    }

    grid.append(cell);
    gridIndex += 1;
  }

  while (gridIndex % 7 !== 0) appendBlankCell();

  wrap.append(header, grid);

  return {
    wrap,
    clearSelection() {
      if (selectedCell) {
        selectedCell.classList.remove('av2-cal__cell--selected');
        selectedCell = null;
      }
    },
  };
}

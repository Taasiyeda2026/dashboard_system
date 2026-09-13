import { loadActiveBirthdays } from '../../birthday-calendar.js';
import { escapeHtml } from '../shared/html.js';
import { formatDateHe } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsInteractiveCard, dsEmptyState } from '../shared/layout.js';
import { loadSchoolCalendarRows } from '../shared/school-calendar-data.js';
import { clampInstructorCalendarMonth, instructorActivityEventsForDate, instructorAttendanceDateSet, instructorCalendarDayClasses, INSTRUCTOR_CALENDAR_END_DATE, INSTRUCTOR_CALENDAR_START_DATE, moveInstructorCalendarMonth, organizationalCalendarDayLabel, organizationalEventsForDate } from './calendar-events.js';
import { instructorActivities, loadInstructorActivities, loadInstructorAttendanceDates } from './portal-data.js';
import { instructorActivityId, openInstructorActivityDrawer } from './activity-drawer.js';

const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
const localMonthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
let selectedMonth = clampInstructorCalendarMonth(localMonthKey());
const isoDay = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function organizationalCalendarGridHtml(data, month = selectedMonth) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const attendanceDates = instructorAttendanceDateSet(data?.attendanceRows);
  const slots = Array.from({ length: Math.ceil((firstWeekday + days) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > days) return '<div class="ds-cal-slot-hit is-other-month" aria-hidden="true"><article class="ds-interactive-card ds-interactive-card--day-cell is-other-month"></article></div>';
    const date = isoDay(year, monthNumber, day);
    const events = [...instructorActivityEventsForDate(data?.activities, date), ...organizationalEventsForDate(data?.calendarRows, data?.birthdays, date)];
    const eventClasses = instructorCalendarDayClasses(events, attendanceDates, date);
    return `<div class="ds-cal-slot-hit" data-calendar-date="${date}">${dsInteractiveCard({ action: `organization-day|${date}`, title: String(day), subtitle: organizationalCalendarDayLabel(events), variant: 'day-cell', extraClass: eventClasses })}</div>`;
  }).join('');
  return `<div class="ds-cal-wrap" dir="rtl"><div class="ds-cal-weekdays" role="row">${WEEKDAYS.map((day) => `<div class="ds-cal-wd" role="columnheader">${day}</div>`).join('')}</div><div class="ds-cal-grid" role="grid" aria-label="לוח חודש">${slots}</div></div>`;
}

function dayDrawerHtml(events, date) {
  if (!events.length) return dsEmptyState('אין אירועים בתאריך זה');
  return `<div class="instr-day-drawer"><h3>${escapeHtml(formatDateHe(date) || date)}</h3>${events.map((event) => event.kind === 'instructor-activity'
    ? `<button type="button" class="instr-activity-card instr-calendar-activity-open" data-calendar-activity="${escapeHtml(instructorActivityId(event))}"><strong>${escapeHtml(event.displayTitle)}</strong><small>מפגש ${event.meetingNo}${event.school ? ` · ${escapeHtml(event.school)}` : ''}</small></button>`
    : `<article class="instr-activity-card"><div><strong>${escapeHtml(event.displayTitle)}</strong></div></article>`).join('')}</div>`;
}

function instructorDetailRow(detail, summary) {
  return {
    ...detail,
    school_contact_id: summary.school_contact_id || '',
    resolved_school_2027_contact: summary.resolved_school_2027_contact,
    resolved_contact_name: summary.resolved_contact_name || '',
    resolved_contact_phone: summary.resolved_contact_phone || '',
    resolved_contact_email: summary.resolved_contact_email || '',
    resolved_contact_role: summary.resolved_contact_role || '',
    contact_name: summary.resolved_contact_name || '',
    contact_phone: summary.resolved_contact_phone || '',
    contact_email: summary.resolved_contact_email || '',
    contact_role: summary.resolved_contact_role || ''
  };
}

export const instructorPortalCalendarScreen = {
  async load({ api, state }) {
    const empId = String(state?.user?.emp_id || '').trim();
    const [calendarRows, birthdays, activityData, attendanceRows] = await Promise.all([
      loadSchoolCalendarRows(),
      loadActiveBirthdays(),
      loadInstructorActivities(api),
      loadInstructorAttendanceDates(api, { empId, fromDate: INSTRUCTOR_CALENDAR_START_DATE, toDate: INSTRUCTOR_CALENDAR_END_DATE })
    ]);
    return { calendarRows, birthdays, rows: activityData.rows, attendanceRows };
  },
  render(data, { state } = {}) {
    data.activities = instructorActivities(data?.rows, state);
    const [year, month] = selectedMonth.split('-').map(Number);
    return dsScreenStack(`<section class="instructor-area route-instructor-calendar">${dsPageHeader('לוח שנה')}<nav class="ds-cal-nav" role="navigation" aria-label="ניווט חודשי" dir="rtl"><button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-calendar-prev aria-label="חודש קודם">▶</button><span class="ds-cal-nav__label">${MONTHS[month - 1]} ${year}</span><button type="button" class="ds-btn ds-btn--sm ds-btn--today" data-calendar-today>היום</button><button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-calendar-next aria-label="חודש הבא">◀</button></nav>${dsCard({ body: organizationalCalendarGridHtml(data), padded: false })}</section>`);
  },
  bind({ root, data, state, api, rerender, ui }) {
    const move = (offset) => { const nextMonth = moveInstructorCalendarMonth(selectedMonth, offset); if (nextMonth === selectedMonth) return; selectedMonth = nextMonth; rerender?.(); };
    root.querySelector('[data-calendar-prev]')?.addEventListener('click', () => move(-1));
    root.querySelector('[data-calendar-next]')?.addEventListener('click', () => move(1));
    root.querySelector('[data-calendar-today]')?.addEventListener('click', () => { selectedMonth = clampInstructorCalendarMonth(localMonthKey()); rerender?.(); });
    root.querySelectorAll('[data-calendar-date]').forEach((node) => node.addEventListener('click', () => {
      const date = node.dataset.calendarDate;
      const events = [...instructorActivityEventsForDate(data?.activities, date), ...organizationalEventsForDate(data?.calendarRows, data?.birthdays, date)];
      ui?.openDrawer({
        title: 'אירועים בלוח השנה',
        content: dayDrawerHtml(events, date),
        onOpen(contentRoot) {
          contentRoot.querySelectorAll('[data-calendar-activity]').forEach((button) => button.addEventListener('click', async () => {
            if (button.dataset.loading === 'yes') return;
            button.dataset.loading = 'yes';
            const row = events.find((event) => event.kind === 'instructor-activity' && instructorActivityId(event) === button.dataset.calendarActivity);
            if (!row) {
              delete button.dataset.loading;
              return;
            }
            try {
              const response = await api.activityDetail(row.RowID || row.row_id || row.id, row.source_sheet || 'activities');
              const fullRow = instructorDetailRow(response?.row || row, row);
              openInstructorActivityDrawer({ row: fullRow, state, ui });
            } catch {
              button.parentElement?.querySelector('.instr-calendar-activity-error')?.remove();
              button.insertAdjacentHTML('afterend', `<div class="instr-calendar-activity-error">${dsEmptyState('טעינת פרטי הפעילות נכשלה')}</div>`);
            } finally {
              delete button.dataset.loading;
            }
          }));
        }
      });
    }));
  }
};

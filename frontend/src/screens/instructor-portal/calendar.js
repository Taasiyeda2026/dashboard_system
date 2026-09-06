import { loadActiveBirthdays } from '../../birthday-calendar.js';
import { escapeHtml } from '../shared/html.js';
import { formatDateHe } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsInteractiveCard, dsEmptyState } from '../shared/layout.js';
import { loadSchoolCalendarRows } from '../shared/school-calendar-data.js';
import { organizationalCalendarDayLabel, organizationalEventsForDate } from './calendar-events.js';

const MONTHS = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
const WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
let selectedMonth = new Date().toISOString().slice(0, 7);
const isoDay = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export function organizationalCalendarGridHtml(data, month = selectedMonth) {
  const [year, monthNumber] = month.split('-').map(Number);
  const firstWeekday = new Date(year, monthNumber - 1, 1).getDay();
  const days = new Date(year, monthNumber, 0).getDate();
  const slots = Array.from({ length: Math.ceil((firstWeekday + days) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    if (day < 1 || day > days) return '<div class="ds-cal-slot-hit is-other-month" aria-hidden="true"><article class="ds-interactive-card ds-interactive-card--day-cell is-other-month"></article></div>';
    const date = isoDay(year, monthNumber, day);
    const events = organizationalEventsForDate(data?.calendarRows, data?.birthdays, date);
    return `<div class="ds-cal-slot-hit" data-calendar-date="${date}">${dsInteractiveCard({ action: `organization-day|${date}`, title: String(day), subtitle: organizationalCalendarDayLabel(events), meta: events.length ? `${events.length} אירועים` : '', variant: 'day-cell', extraClass: events.length ? 'is-school-calendar-day' : '' })}</div>`;
  }).join('');
  return `<div class="ds-cal-wrap" dir="rtl"><div class="ds-cal-weekdays" role="row">${WEEKDAYS.map((day) => `<div class="ds-cal-wd" role="columnheader">${day}</div>`).join('')}</div><div class="ds-cal-grid" role="grid" aria-label="לוח חודש">${slots}</div></div>`;
}

function dayDrawerHtml(events, date) {
  if (!events.length) return dsEmptyState('אין אירועים בתאריך זה');
  return `<div class="instr-day-drawer"><h3>${escapeHtml(formatDateHe(date) || date)}</h3>${events.map((event) => `<article class="instr-activity-card"><div><strong>${escapeHtml(event.displayTitle)}</strong>${event.category ? `<small>${escapeHtml(event.category)}</small>` : ''}</div></article>`).join('')}</div>`;
}

export const instructorPortalCalendarScreen = {
  async load() { const [calendarRows, birthdays] = await Promise.all([loadSchoolCalendarRows(), loadActiveBirthdays()]); return { calendarRows, birthdays }; },
  render(data) {
    const [year, month] = selectedMonth.split('-').map(Number);
    return dsScreenStack(`<section class="instructor-area">${dsPageHeader('לוח שנה', 'חגים, חופשות, מועדים וימי הולדת מכל המגזרים')}<nav class="ds-cal-nav" role="navigation" aria-label="ניווט חודשי" dir="rtl"><button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-calendar-prev aria-label="חודש קודם">▶</button><span class="ds-cal-nav__label">${MONTHS[month - 1]} ${year}</span><button type="button" class="ds-btn ds-btn--sm ds-btn--today" data-calendar-today>היום</button><button type="button" class="ds-btn ds-btn--sm ds-btn--nav-arrow" data-calendar-next aria-label="חודש הבא">◀</button></nav>${dsCard({ body: organizationalCalendarGridHtml(data), padded: false })}</section>`);
  },
  bind({ root, data, rerender, ui }) {
    const move = (offset) => { const [year, month] = selectedMonth.split('-').map(Number); const next = new Date(year, month - 1 + offset, 1); selectedMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`; rerender?.(); };
    root.querySelector('[data-calendar-prev]')?.addEventListener('click', () => move(-1));
    root.querySelector('[data-calendar-next]')?.addEventListener('click', () => move(1));
    root.querySelector('[data-calendar-today]')?.addEventListener('click', () => { selectedMonth = new Date().toISOString().slice(0, 7); rerender?.(); });
    root.querySelectorAll('[data-calendar-date]').forEach((node) => node.addEventListener('click', () => { const date = node.dataset.calendarDate; ui?.openDrawer({ title: 'אירועים בלוח השנה', content: dayDrawerHtml(organizationalEventsForDate(data?.calendarRows, data?.birthdays, date), date) }); }));
  }
};

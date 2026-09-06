import { loadActiveBirthdays } from '../../birthday-calendar.js';
import { escapeHtml } from '../shared/html.js';
import { formatDateHe } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsEmptyState } from '../shared/layout.js';
import { loadSchoolCalendarRows } from '../shared/school-calendar-data.js';
import { organizationalCalendarEvents } from './calendar-events.js';

let selectedMonth = new Date().toISOString().slice(0, 7);
export const instructorPortalCalendarScreen = {
  async load() { const [calendarRows, birthdays] = await Promise.all([loadSchoolCalendarRows(), loadActiveBirthdays()]); return { calendarRows, birthdays }; },
  render(data) {
    const events = organizationalCalendarEvents(data?.calendarRows, data?.birthdays, selectedMonth);
    const body = events.length ? `<div class="instructor-calendar-events">${events.map((event) => `<article class="ds-interactive-card ds-interactive-card--mini"><p class="ds-interactive-card__title">${escapeHtml(event.title)}</p><p class="ds-interactive-card__subtitle">${escapeHtml(formatDateHe(event.date) || event.date)}</p><p class="ds-interactive-card__meta">${escapeHtml(event.meta)}</p></article>`).join('')}</div>` : dsEmptyState('אין אירועים בחודש זה');
    return dsScreenStack(`<section class="instructor-area">${dsPageHeader('לוח שנה', 'לוח ארגוני מכל המגזרים')}<label class="instructor-portal-month">חודש <input class="ds-input" type="month" value="${escapeHtml(selectedMonth)}" data-portal-calendar-month></label>${dsCard({ title: 'אירועים ארגוניים', badge: String(events.length), body })}</section>`);
  },
  bind({ root, rerender }) { root.querySelector('[data-portal-calendar-month]')?.addEventListener('change', (event) => { selectedMonth = event.target.value; rerender?.(); }); }
};

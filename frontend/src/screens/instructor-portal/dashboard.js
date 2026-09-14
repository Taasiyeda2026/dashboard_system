import { config } from '../../config.js';
import { escapeHtml } from '../shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from '../shared/layout.js';
import { instructorUpcomingMeetings, loadInstructorActivities, monthlyInstructorSummary, nextInstructorMeeting } from './portal-data.js';
import { formatDateHe } from '../shared/format-date.js';

const localMonthKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
let selectedMonth = localMonthKey();
export const PORTAL_SHORTCUTS = Object.freeze([
  { title: 'לוח שנה', action: 'route:instructor-calendar' },
  { title: 'מערכת נוכחות', action: 'external:attendance' },
  { title: 'מצגות', action: 'external:presentations' },
  { title: 'דיווחים', action: 'route:instructor-reports' },
  { title: 'הפעילויות שלי', action: 'route:my-data' }
]);

export function instructorMonthlySummaryHtml(summary = {}) {
  const types = (Array.isArray(summary.types) ? summary.types : [])
    .filter((item) => Number(item?.value) > 0 && String(item?.label || '').trim())
    .map((item) => `${escapeHtml(item.value)} ${escapeHtml(item.label)}`)
    .join(' | ');
  return `<p class="instructor-portal-monthly-summary"><strong>${escapeHtml(summary.total || 0)} פעילויות</strong>${types ? `: ${types}` : ''}</p>`;
}

function shortTime(value) {
  const match = String(value || '').match(/^(\d{2}:\d{2})/);
  return match?.[1] || '';
}

function meetingMetaHtml(meeting) {
  const timeStart = shortTime(meeting?.start_time);
  const timeEnd = shortTime(meeting?.end_time);
  const time = timeStart && timeEnd ? `${timeStart}–${timeEnd}` : timeStart || timeEnd;
  const locations = [meeting?.school, meeting?.authority]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index);
  return [time, ...locations].filter(Boolean).map(escapeHtml).join(' · ');
}

function upcomingMeetingCardHtml(meeting, label = '') {
  if (!meeting) return '';
  const date = formatDateHe(meeting.date);
  const meta = meetingMetaHtml(meeting);
  return `<section class="instructor-portal-focus" data-upcoming-activity="${escapeHtml(meeting?.row?.RowID || meeting?.row?.row_id || '')}">
    <span>${label ? `${escapeHtml(label)} · ` : ''}${escapeHtml(date)}</span>
    <strong>${escapeHtml(meeting.activity_name || 'פעילות')}</strong>
    ${meta ? `<small>${meta}</small>` : ''}
  </section>`;
}

export const instructorDashboardScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const summary = monthlyInstructorSummary(data?.rows, state, selectedMonth);
    const upcoming = instructorUpcomingMeetings(data?.rows, state, { days: 7 });
    const nextBeyondWeek = upcoming.length ? null : nextInstructorMeeting(data?.rows, state);
    const upcomingSection = upcoming.length
      ? `<p class="instructor-portal-monthly-summary"><strong>הפעילויות הקרובות · 7 ימים</strong></p>${upcoming.map((meeting) => upcomingMeetingCardHtml(meeting)).join('')}`
      : nextBeyondWeek
        ? upcomingMeetingCardHtml(nextBeyondWeek, 'הפעילות הבאה שלך')
        : '<section class="instructor-portal-focus is-empty"><span>הפעילויות הקרובות</span><strong>אין פעילות קרובה</strong></section>';
    return dsScreenStack(`<section class="instructor-area instructor-portal-dashboard">
      ${dsPageHeader('לוח בקרה')}
      <div class="instructor-portal-dashboard__toolbar"><label class="instructor-portal-month">חודש <input class="ds-input" type="month" value="${escapeHtml(selectedMonth)}" data-portal-month></label></div>
      ${instructorMonthlySummaryHtml(summary)}
      <div class="instructor-portal-summary-divider" aria-hidden="true"></div>
      ${upcomingSection}
      <div class="instructor-portal-shortcuts">${PORTAL_SHORTCUTS.map((item) => dsInteractiveCard({ action: item.action, title: item.title, variant: 'mini', extraClass: 'instructor-portal-shortcut' })).join('')}</div>
    </section>`);
  },
  bind({ root, rerender }) {
    root.querySelector('[data-portal-month]')?.addEventListener('change', (event) => { selectedMonth = event.target.value; rerender?.(); });
    root.querySelectorAll('[data-card-action]').forEach((button) => button.addEventListener('click', () => {
      const action = button.dataset.cardAction || '';
      if (action.startsWith('route:')) document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: action.slice(6) } }));
      if (action === 'external:attendance') window.location.assign(config.instructorAttendanceUrl);
      if (action === 'external:presentations') window.open(config.instructorPresentationsUrl, '_blank', 'noopener,noreferrer');
    }));
  }
};

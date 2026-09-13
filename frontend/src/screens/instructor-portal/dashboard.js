import { config } from '../../config.js';
import { escapeHtml } from '../shared/html.js';
import { dsPageHeader, dsScreenStack, dsInteractiveCard } from '../shared/layout.js';
import { loadInstructorActivities, monthlyInstructorSummary } from './portal-data.js';
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

export const instructorDashboardScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const summary = monthlyInstructorSummary(data?.rows, state, selectedMonth);
    const next = summary.next;
    const nextCard = `<section class="instructor-portal-focus${next ? '' : ' is-empty'}"><span>הפעילות הקרובה</span><strong>${escapeHtml(next?.activity_name || next?.activity || 'אין פעילות קרובה בחודש זה')}</strong>${next ? `<small>${escapeHtml(formatDateHe(next.start_date || next.activity_date || next.date_1))} · ${escapeHtml(next.school || next.authority || '')}</small>` : ''}</section>`;
    return dsScreenStack(`<section class="instructor-area instructor-portal-dashboard">
      ${dsPageHeader('לוח בקרה')}
      <div class="instructor-portal-dashboard__toolbar"><label class="instructor-portal-month">חודש <input class="ds-input" type="month" value="${escapeHtml(selectedMonth)}" data-portal-month></label></div>
      ${instructorMonthlySummaryHtml(summary)}
      <div class="instructor-portal-summary-divider" aria-hidden="true"></div>
      ${nextCard}
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

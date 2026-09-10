import { config } from '../../config.js';
import { escapeHtml } from '../shared/html.js';
import { dsPageHeader, dsScreenStack, dsKpiGrid, dsInteractiveCard } from '../shared/layout.js';
import { loadInstructorActivities, monthlyInstructorSummary } from './portal-data.js';
import { formatDateHe } from '../shared/format-date.js';

let selectedMonth = new Date().toISOString().slice(0, 7);
export const PORTAL_SHORTCUTS = Object.freeze([
  { title: 'לוח שנה', action: 'route:instructor-calendar' },
  { title: 'מערכת נוכחות', action: 'external:attendance' },
  { title: 'מצגות', action: 'external:presentations' },
  { title: 'דיווחים', action: 'route:instructor-reports' },
  { title: 'הפעילויות שלי', action: 'route:my-data' }
]);

export const instructorDashboardScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const summary = monthlyInstructorSummary(data?.rows, state, selectedMonth);
    const kpis = [{ label: 'פעילויות החודש', value: summary.total }, { label: 'דורש תשומת לב', value: summary.attention }, ...summary.types].slice(0, 4);
    const next = summary.next;
    const nextCard = `<section class="instructor-portal-focus${next ? '' : ' is-empty'}"><span>הפעילות הקרובה</span><strong>${escapeHtml(next?.activity_name || next?.activity || 'אין פעילות קרובה בחודש זה')}</strong>${next ? `<small>${escapeHtml(formatDateHe(next.start_date || next.activity_date || next.date_1))} · ${escapeHtml(next.school || next.authority || '')}</small>` : ''}</section>`;
    return dsScreenStack(`<section class="instructor-area instructor-portal-dashboard">
      ${dsPageHeader('לוח בקרה', 'סיכום אישי, הפעילות הקרובה וקיצורי דרך')}
      <div class="instructor-portal-dashboard__toolbar"><label class="instructor-portal-month">חודש <input class="ds-input" type="month" value="${escapeHtml(selectedMonth)}" data-portal-month></label>${nextCard}</div>
      ${dsKpiGrid(kpis)}
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

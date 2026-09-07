import { config } from '../../config.js';
import { escapeHtml } from '../shared/html.js';
import { dsPageHeader, dsScreenStack, dsKpiGrid, dsInteractiveCard } from '../shared/layout.js';
import { loadInstructorActivities, monthlyInstructorSummary } from './portal-data.js';

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
    const kpis = [{ label: 'סה״כ פעילויות', value: summary.total }, ...summary.types];
    return dsScreenStack(`<section class="instructor-area instructor-portal-dashboard">
      ${dsPageHeader('לוח בקרה', 'האזור האישי שלך')}
      <label class="instructor-portal-month">חודש <input class="ds-input" type="month" value="${escapeHtml(selectedMonth)}" data-portal-month></label>
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

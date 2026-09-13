import { escapeHtml } from '../shared/html.js';
import { formatDateHe, formatTimeRangeShort } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsTableWrap, dsEmptyState } from '../shared/layout.js';
import { instructorActivities, loadInstructorActivities } from './portal-data.js';
import { instructorActivityId, instructorActivityName, openInstructorActivityDrawer } from './activity-drawer.js';

export function instructorActivityContact(row) {
  return String(row?.resolved_contact_name || '').trim();
}
function chronological(rows) {
  return [...rows].sort((a, b) => String(a?.start_date || a?.activity_date || '').localeCompare(String(b?.start_date || b?.activity_date || '')));
}

function mobileActivityCard(row) {
  const id = escapeHtml(instructorActivityId(row));
  return `<article class="instr-activity-list-card portal-activity-card" role="button" tabindex="0" data-portal-activity="${id}">
    <h3>${escapeHtml(instructorActivityName(row))}</h3>
    <div class="portal-activity-card__summary">
      <span>תאריך<strong>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</strong></span>
      <span>שעות<strong>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</strong></span>
      <span>בית ספר<strong>${escapeHtml(row.school || '—')}</strong></span>
      <span>רשות<strong>${escapeHtml(row.authority || '—')}</strong></span>
    </div>
  </article>`;
}

export const instructorMyActivitiesScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = chronological(instructorActivities(data?.rows, state));
    const body = rows.map((row) => {
      const id = escapeHtml(instructorActivityId(row));
      return `<tr class="ds-data-row" role="button" tabindex="0" data-portal-activity="${id}">
        <td>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</td>
        <td>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.authority || '—')}</td>
        <td>${escapeHtml(instructorActivityName(row))}</td>
        <td><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary portal-activity-open" data-portal-open="${id}">פרטים</button></td>
      </tr>`;
    }).join('');
    const desktop = `<div class="portal-activities-desktop">${dsTableWrap(`<table class="ds-table ds-table--interactive"><thead><tr><th>תאריך</th><th>שעות</th><th>בית ספר</th><th>רשות</th><th>פעילות</th><th>פעולה</th></tr></thead><tbody>${body}</tbody></table>`)}</div>`;
    const mobile = `<div class="portal-activities-mobile">${rows.map(mobileActivityCard).join('')}</div>`;
    const presentation = rows.length ? desktop + mobile : dsEmptyState('אין פעילויות להצגה');
    return dsScreenStack(`<section class="instructor-area instructor-area--table">${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}<div class="instructor-my-activities-actions"><button type="button" class="ds-btn ds-btn--primary" data-open-work-schedule>סידור עבודה</button></div>${dsCard({ title: 'הפעילויות שלי', badge: String(rows.length), body: presentation, padded: !rows.length })}</section>`);
  },
  bind({ root, data, state, ui }) {
    root.querySelector('[data-open-work-schedule]')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-work-schedule' } }));
    });
    const rows = instructorActivities(data?.rows, state);
    const byId = new Map(rows.map((row) => [instructorActivityId(row), row]));
    const openById = (id) => {
      const row = byId.get(String(id || ''));
      if (!row) return;
      openInstructorActivityDrawer({ row, state, ui });
    };
    root.querySelectorAll('[data-portal-activity]').forEach((node) => {
      node.addEventListener('click', (event) => {
        if (event.target.closest('[data-portal-open]')) return;
        openById(node.dataset.portalActivity);
      });
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openById(node.dataset.portalActivity); } });
    });
    root.querySelectorAll('[data-portal-open]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openById(button.dataset.portalOpen);
      });
    });
  }
};

import { escapeHtml } from '../shared/html.js';
import { formatDateHe, formatTimeRangeShort } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsTableWrap, dsEmptyState } from '../shared/layout.js';
import { activityWorkDrawerHtml } from '../shared/activity-detail-html.js';
import { instructorActivities, loadInstructorActivities } from './portal-data.js';
import { currentInstructorIds, currentInstructorName } from '../instructor-utils.js';

function rowId(row) { return String(row?.RowID || row?.row_id || row?.id || ''); }
function activityName(row) { return String(row?.activity_name || row?.activity || 'פעילות').trim(); }
function activityStatus(row) {
  const raw = String(row?.status_label || row?.activity_status || row?.status || '').trim();
  if (!raw) return '—';
  const key = raw.toLowerCase();
  const labels = {
    open: 'פתוח',
    active: 'פעיל',
    scheduled: 'מתוכנן',
    completed: 'הושלם',
    closed: 'הסתיים',
    cancelled: 'בוטל',
    canceled: 'בוטל'
  };
  return labels[key] || raw;
}
export function instructorActivityContact(row) {
  return String(row?.resolved_contact_name || '').trim();
}
function chronological(rows) {
  return [...rows].sort((a, b) => String(a?.start_date || a?.activity_date || '').localeCompare(String(b?.start_date || b?.activity_date || '')));
}

function mobileActivityCard(row) {
  const id = escapeHtml(rowId(row));
  return `<article class="instr-activity-list-card portal-activity-card" role="button" tabindex="0" data-portal-activity="${id}">
    <h3>${escapeHtml(activityName(row))}</h3>
    <div class="portal-activity-card__summary">
      <span>תאריך<strong>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</strong></span>
      <span>שעות<strong>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</strong></span>
      <span>בית ספר<strong>${escapeHtml(row.school || '—')}</strong></span>
      <span>שכבה<strong>${escapeHtml(row.grade || '—')}</strong></span>
    </div>
  </article>`;
}

export const instructorMyActivitiesScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = chronological(instructorActivities(data?.rows, state));
    const body = rows.map((row) => {
      const id = escapeHtml(rowId(row));
      return `<tr class="ds-data-row" role="button" tabindex="0" data-portal-activity="${id}">
        <td>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</td>
        <td>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.grade || '—')}</td>
        <td>${escapeHtml(activityName(row))}</td>
        <td><span class="portal-activity-status">${escapeHtml(activityStatus(row))}</span></td>
        <td><button type="button" class="ds-btn ds-btn--xs ds-btn--secondary portal-activity-open" data-portal-open="${id}">פרטים</button></td>
      </tr>`;
    }).join('');
    const desktop = `<div class="portal-activities-desktop">${dsTableWrap(`<table class="ds-table ds-table--interactive"><thead><tr><th>תאריך</th><th>שעות</th><th>בית ספר</th><th>שכבה</th><th>פעילות</th><th>סטטוס</th><th>פעולה</th></tr></thead><tbody>${body}</tbody></table>`)}</div>`;
    const mobile = `<div class="portal-activities-mobile">${rows.map(mobileActivityCard).join('')}</div>`;
    const presentation = rows.length ? desktop + mobile : dsEmptyState('אין פעילויות להצגה');
    return dsScreenStack(`<section class="instructor-area instructor-area--table">${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}<div class="instructor-my-activities-actions"><button type="button" class="ds-btn ds-btn--primary" data-open-work-schedule>סידור עבודה</button></div>${dsCard({ title: 'הפעילויות שלי', badge: String(rows.length), body: presentation, padded: !rows.length })}</section>`);
  },
  bind({ root, data, state, ui }) {
    root.querySelector('[data-open-work-schedule]')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-work-schedule' } }));
    });
    const rows = instructorActivities(data?.rows, state);
    const byId = new Map(rows.map((row) => [rowId(row), row]));
    const openById = (id) => {
      const row = byId.get(String(id || ''));
      if (!row) return;
      ui?.openDrawer({ title: activityName(row), content: `<div class="instructor-activity-drawer-shell"><p class="instructor-activity-drawer-shell__eyebrow">פרטי הפעילות שלי</p>${activityWorkDrawerHtml(row, { settings: state?.clientSettings || {}, instructorLimited: true, currentInstructorIds: currentInstructorIds(state), currentInstructorName: currentInstructorName(state), canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, canSchedule: false, exportAction: false })}</div>` });
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

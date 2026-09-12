import { escapeHtml } from '../shared/html.js';
import { formatDateHe, formatTimeRangeShort } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsTableWrap, dsEmptyState } from '../shared/layout.js';
import { activityWorkDrawerHtml } from '../shared/activity-detail-html.js';
import { instructorActivities, loadInstructorActivities } from './portal-data.js';
import { currentInstructorIds, currentInstructorName } from '../instructor-utils.js';

function rowId(row) { return String(row?.RowID || row?.row_id || row?.id || ''); }
function activityName(row) { return String(row?.activity_name || row?.activity || 'פעילות').trim(); }
export function instructorActivityContact(row) {
  return String(row?.resolved_contact_name || '').trim();
}
function chronological(rows) {
  return [...rows].sort((a, b) => String(a?.start_date || a?.activity_date || '').localeCompare(String(b?.start_date || b?.activity_date || '')));
}

export const instructorMyActivitiesScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = chronological(instructorActivities(data?.rows, state));
    const body = rows.map((row) => `<tr class="ds-data-row" role="button" tabindex="0" data-portal-activity="${escapeHtml(rowId(row))}"><td>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</td><td>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</td><td>${escapeHtml(activityName(row))}</td><td>${escapeHtml(row.authority || '—')}</td><td>${escapeHtml(row.school || '—')}</td><td>${escapeHtml(row.grade || '—')}</td><td>${escapeHtml(instructorActivityContact(row) || '—')}</td></tr>`).join('');
    const desktop = `<div class="portal-activities-desktop">${dsTableWrap(`<table class="ds-table ds-table--interactive"><thead><tr><th>תאריך</th><th>שעות</th><th>פעילות</th><th>רשות</th><th>בית ספר</th><th>שכבה</th><th>איש קשר</th></tr></thead><tbody>${body}</tbody></table>`)}</div>`;
    const mobile = `<div class="portal-activities-mobile">${rows.map((row) => `<article class="instr-activity-list-card portal-activity-card" role="button" tabindex="0" data-portal-activity="${escapeHtml(rowId(row))}"><h3>${escapeHtml(activityName(row))}</h3><div class="instr-activity-list-card__fields"><div class="instr-activity-list-card__field"><span>תאריך</span><strong>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</strong></div><div class="instr-activity-list-card__field"><span>שעות</span><strong>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</strong></div><div class="instr-activity-list-card__field"><span>רשות</span><strong>${escapeHtml(row.authority || '—')}</strong></div><div class="instr-activity-list-card__field"><span>בית ספר</span><strong>${escapeHtml(row.school || '—')}</strong></div><div class="instr-activity-list-card__field"><span>שכבה</span><strong>${escapeHtml(row.grade || '—')}</strong></div><div class="instr-activity-list-card__field"><span>איש קשר</span><strong>${escapeHtml(instructorActivityContact(row) || '—')}</strong></div></div><span class="ds-btn ds-btn--sm ds-btn--ghost">פתיחת פרטים</span></article>`).join('')}</div>`;
    const presentation = rows.length ? desktop + mobile : dsEmptyState('אין פעילויות להצגה');
    return dsScreenStack(`<section class="instructor-area instructor-area--table">${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}<div class="instructor-my-activities-actions"><button type="button" class="ds-btn ds-btn--primary" data-open-work-schedule>סידור עבודה</button></div>${dsCard({ title: 'הפעילויות שלי', badge: String(rows.length), body: presentation, padded: !rows.length })}</section>`);
  },
  bind({ root, data, state, ui }) {
    root.querySelector('[data-open-work-schedule]')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'instructor-work-schedule' } }));
    });
    const rows = instructorActivities(data?.rows, state);
    const byId = new Map(rows.map((row) => [rowId(row), row]));
    const open = (node) => {
      const row = byId.get(String(node?.dataset?.portalActivity || ''));
      if (!row) return;
      ui?.openDrawer({ title: activityName(row), content: `<div class="instructor-activity-drawer-shell"><p class="instructor-activity-drawer-shell__eyebrow">פרטי הפעילות שלי</p>${activityWorkDrawerHtml(row, { settings: state?.clientSettings || {}, instructorLimited: true, currentInstructorIds: currentInstructorIds(state), currentInstructorName: currentInstructorName(state), canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, canSchedule: false, exportAction: false })}</div>` });
    };
    root.querySelectorAll('[data-portal-activity]').forEach((node) => {
      node.addEventListener('click', () => open(node));
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(node); } });
    });
  }
};

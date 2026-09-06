import { escapeHtml } from '../shared/html.js';
import { formatDateHe, formatTimeRangeShort } from '../shared/format-date.js';
import { dsPageHeader, dsScreenStack, dsCard, dsTableWrap, dsEmptyState } from '../shared/layout.js';
import { activityWorkDrawerHtml } from '../shared/activity-detail-html.js';
import { instructorActivities, loadInstructorActivities } from './portal-data.js';

function rowId(row) { return String(row?.RowID || row?.row_id || row?.id || ''); }
function activityName(row) { return String(row?.activity_name || row?.activity || 'פעילות').trim(); }
export function instructorActivityContact(row) {
  return String(row?.resolved_contact_name || row?.school_contact_name || row?.contact_name || '').trim();
}
function chronological(rows) {
  return [...rows].sort((a, b) => String(a?.start_date || a?.activity_date || '').localeCompare(String(b?.start_date || b?.activity_date || '')));
}

export const instructorMyActivitiesScreen = {
  load: ({ api }) => loadInstructorActivities(api),
  render(data, { state } = {}) {
    const rows = chronological(instructorActivities(data?.rows, state));
    const body = rows.map((row) => `<tr class="ds-data-row" role="button" tabindex="0" data-portal-activity="${escapeHtml(rowId(row))}"><td>${escapeHtml(formatDateHe(row.start_date || row.activity_date) || '—')}</td><td>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</td><td>${escapeHtml(activityName(row))}</td><td>${escapeHtml(row.activity_type || '—')}</td><td>${escapeHtml(row.authority || '—')}</td><td>${escapeHtml(row.school || '—')}</td><td>${escapeHtml(row.grade || '—')}</td><td>${escapeHtml(instructorActivityContact(row) || '—')}</td></tr>`).join('');
    const table = rows.length ? dsTableWrap(`<table class="ds-table ds-table--interactive"><thead><tr><th>תאריך</th><th>שעות</th><th>פעילות</th><th>סוג</th><th>רשות</th><th>בית ספר</th><th>שכבה</th><th>איש קשר</th></tr></thead><tbody>${body}</tbody></table>`) : dsEmptyState('אין פעילויות להצגה');
    return dsScreenStack(`<section class="instructor-area instructor-area--table">${dsPageHeader('הפעילויות שלי', 'כל הפעילויות שמשויכות אליך')}${dsCard({ title: 'הפעילויות שלי', badge: String(rows.length), body: table, padded: !rows.length })}</section>`);
  },
  bind({ root, data, state, ui }) {
    const rows = instructorActivities(data?.rows, state);
    const byId = new Map(rows.map((row) => [rowId(row), row]));
    const open = (node) => {
      const row = byId.get(String(node?.dataset?.portalActivity || ''));
      if (!row) return;
      ui?.openDrawer({ title: 'פירוט פעילות', content: activityWorkDrawerHtml(row, { instructorLimited: true, canEdit: false, canDirectEdit: false, canRequestEdit: false, canDeleteActivity: false, canSchedule: false, exportAction: false }) });
    };
    root.querySelectorAll('[data-portal-activity]').forEach((node) => {
      node.addEventListener('click', () => open(node));
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(node); } });
    });
  }
};

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

function localTodayIso(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function isPastActivityDate(value, today = localTodayIso()) {
  const iso = String(value || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && iso < today;
}

function activityDateMeta(value, today) {
  const text = formatDateHe(value) || '—';
  const past = isPastActivityDate(value, today);
  return { text, past, className: `portal-activity-date${past ? ' portal-activity-date--past' : ''}` };
}

function mobileActivityCard(row, today) {
  const id = escapeHtml(instructorActivityId(row));
  const startDate = activityDateMeta(row.start_date || row.activity_date, today);
  const endDate = activityDateMeta(row.end_date, today);
  return `<article class="instr-activity-list-card portal-activity-card" role="button" tabindex="0" data-portal-activity="${id}">
    <h3>${escapeHtml(instructorActivityName(row))}</h3>
    <div class="portal-activity-card__summary">
      <span>תאריך התחלה<strong class="${startDate.className}" aria-label="${escapeHtml(`תאריך התחלה ${startDate.text}${startDate.past ? ', תאריך שחלף' : ''}`)}">${escapeHtml(startDate.text)}</strong></span>
      <span>תאריך סיום<strong class="${endDate.className}" aria-label="${escapeHtml(`תאריך סיום ${endDate.text}${endDate.past ? ', תאריך שחלף' : ''}`)}">${escapeHtml(endDate.text)}</strong></span>
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
    const today = localTodayIso();
    const body = rows.map((row) => {
      const id = escapeHtml(instructorActivityId(row));
      const startDate = activityDateMeta(row.start_date || row.activity_date, today);
      const endDate = activityDateMeta(row.end_date, today);
      return `<tr class="ds-data-row" role="button" tabindex="0" data-portal-activity="${id}">
        <td class="${startDate.className}" aria-label="${escapeHtml(`תאריך התחלה ${startDate.text}${startDate.past ? ', תאריך שחלף' : ''}`)}">${escapeHtml(startDate.text)}</td>
        <td class="${endDate.className}" aria-label="${escapeHtml(`תאריך סיום ${endDate.text}${endDate.past ? ', תאריך שחלף' : ''}`)}">${escapeHtml(endDate.text)}</td>
        <td>${escapeHtml(formatTimeRangeShort(row.start_time, row.end_time) || '—')}</td>
        <td>${escapeHtml(row.school || '—')}</td>
        <td>${escapeHtml(row.authority || '—')}</td>
        <td>${escapeHtml(instructorActivityName(row))}</td>
      </tr>`;
    }).join('');
    const desktop = `<div class="portal-activities-desktop">${dsTableWrap(`<table class="ds-table ds-table--interactive"><thead><tr><th>תאריך התחלה</th><th>תאריך סיום</th><th>שעות</th><th>בית ספר</th><th>רשות</th><th>פעילות</th></tr></thead><tbody>${body}</tbody></table>`)}</div>`;
    const mobile = `<div class="portal-activities-mobile">${rows.map((row) => mobileActivityCard(row, today)).join('')}</div>`;
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
      node.addEventListener('click', () => openById(node.dataset.portalActivity));
      node.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openById(node.dataset.portalActivity); } });
    });
  }
};

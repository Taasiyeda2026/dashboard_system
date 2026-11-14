import { escapeHtml } from './html.js';
import { formatDateHe } from './format-date.js';

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

export function managementToday(now = new Date()) {
  const parts = dayFormatter.formatToParts(now);
  return ['year', 'month', 'day'].map((key) => parts.find((p) => p.type === key).value).join('-');
}

function dateKey(value) {
  const date = String(value || '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

/** Planning only. Repeated dates represent separate meetings; never deduplicate them.
 * The dates API synthesizes performed=no, so it cannot verify execution/cancellation.
 */
export function activityManagementSummary(row = {}, today = managementToday()) {
  let dates;
  if (Array.isArray(row.meeting_schedule) && row.meeting_schedule.length) {
    dates = row.meeting_schedule.map((item) => dateKey(item?.date));
  } else if (Array.isArray(row.meeting_dates) && row.meeting_dates.length) {
    dates = row.meeting_dates.map(dateKey);
  } else if (Array.isArray(row.date_cols) && row.date_cols.length) {
    dates = row.date_cols.map(dateKey);
  } else {
    dates = Array.from({ length: 35 }, (_, i) => dateKey(row[`date_${i + 1}`] || row[`Date${i + 1}`]));
  }
  dates = dates.filter(Boolean).sort();
  const recorded = Number(row.sessions || row.meetings_total);
  const total = Number.isInteger(recorded) && recorded > 0 ? recorded : null;
  const elapsed = dates.filter((date) => date < today).length;
  const future = dates.filter((date) => date >= today).length;
  return { total, elapsed, future, missingDates: total === null ? null : Math.max(0, total - dates.length), next: dates.find((date) => date >= today) || '', end: dateKey(row.end_date || row.date_end) || dates.at(-1) || '', verified: null, cancelled: null };
}

export function activityPlanningFactsHtml(row, today) {
  const s = activityManagementSummary(row, today);
  return `<div class="activity-planning-facts" data-planning-facts>
    <span>לפי לוח: ${s.elapsed} שמועדם חלף${s.total === null ? ' · סה״כ לא זמין' : ` מתוך ${s.total} מתוכננים`}</span>
    <span>${s.future} מהיום והלאה${s.missingDates ? ` · ${s.missingDates} ללא תאריך` : ''}</span>
    <span>ביצוע מאומת: לא זמין · ביטולים: לא זמינים</span>
    <span>ללא אימות ביצוע: ${s.total === null ? 'המספר אינו זמין' : `${s.total} מפגשים`}</span>
    <span>מועד שחלף אינו אישור ביצוע; נוכחות נבדקת במסך המורשה.</span>
    ${s.next ? `<span>המפגש הבא: <bdi>${escapeHtml(formatDateHe(s.next))}</bdi></span>` : '<span>לא קיים מפגש עתידי בלוח הזמין</span>'}
  </div>`;
}

/** Uses only the permitted list projection; no private notes or extra requests. */
export function activityMobileSummaryHtml(row, { manager = '', classGroup = '', latest = '' } = {}) {
  const s = activityManagementSummary(row);
  const field = (label, value) => value ? `<span><small>${escapeHtml(label)}</small> <bdi>${escapeHtml(value)}</bdi></span>` : '';
  return `<div class="activity-mobile-summary">
    <div class="activity-mobile-summary__identity">${field('סטטוס', row.status || 'לא צוין')}${field('כיתה / קבוצה', classGroup)}${field('מנהל', manager || 'חסר מנהל פעילות')}</div>
    <span>לפי לוח: ${s.elapsed}${s.total === null ? '' : ` מתוך ${s.total}`} מפגשים שמועדם חלף</span>
    <div class="activity-mobile-summary__schedule">${field('המפגש הבא', s.next ? formatDateHe(s.next) : 'אין מועד עתידי בלוח')}${field('סיום', s.end ? formatDateHe(s.end) : 'חסר תאריך סיום')}</div>
    ${!dateKey(row.start_date || row.date_start) ? '<span class="activity-mobile-summary__warning">חסר תאריך התחלה</span>' : ''}
    <div class="activity-mobile-summary__expanded">${field('התחלה', formatDateHe(row.start_date || row.date_start))}${activityPlanningFactsHtml(row)}${field('עדכון אחרון', latest)}<span>תיאום, נוכחות, משובים ובקרה: בפרטי הפעילות בהתאם להרשאות</span></div>
  </div>`;
}

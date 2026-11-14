import { activityMeetingCheckpoints } from './activity-meeting-checkpoints.js';
import { activityInstructorAssignmentState } from './activity-instructor-filter.js';
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

/** Repeated dates remain separate meetings. Only authorized evidence can verify them;
 * the dates API's synthetic performed flag is never an execution source.
 */
export function activityManagementSummary(row = {}, today = managementToday()) {
  let dates;
  const numberedColumns = Array.from({ length: 35 }, (_, i) => dateKey(row[`date_${i + 1}`] || row[`Date${i + 1}`]));
  if (numberedColumns.some(Boolean)) {
    dates = numberedColumns;
  } else if (Array.isArray(row.meeting_schedule) && row.meeting_schedule.length) {
    dates = row.meeting_schedule.map((item) => dateKey(item?.date));
  } else if (Array.isArray(row.meeting_dates) && row.meeting_dates.length) {
    dates = row.meeting_dates.map(dateKey);
  } else if (Array.isArray(row.date_cols) && row.date_cols.length) {
    dates = row.date_cols.map(dateKey);
  } else {
    dates = Array.from({ length: 35 }, (_, i) => dateKey(row[`date_${i + 1}`] || row[`Date${i + 1}`]));
  }
  const numberedDates = dates.map((date, index) => ({ date, meetingNo: index + 1 })).filter((item) => item.date);
  dates = dates.filter(Boolean).sort();
  const recorded = Number(row.sessions || row.meetings_total);
  const total = Number.isInteger(recorded) && recorded > 0 ? recorded : null;
  const elapsed = dates.filter((date) => date < today).length;
  const evidence = row.management || {};
  const cancelledDates = new Set(evidence.cancelledDates || []);
  const approvedDates = new Set(evidence.approvedDates || []);
  const verified = evidence.approvalsAvailable ? dates.filter((date) => approvedDates.has(date) && !cancelledDates.has(date)).length : null;
  const cancelled = evidence.cancellationsAvailable ? dates.filter((date) => cancelledDates.has(date)).length : null;
  const elapsedUnverified = evidence.approvalsAvailable && evidence.cancellationsAvailable ? dates.filter((date) => date < today && !approvedDates.has(date) && !cancelledDates.has(date)).length : null;
  const missingReports = evidence.attendanceAvailable && evidence.attendanceComplete && evidence.cancellationsAvailable ? numberedDates.filter(({ date, meetingNo }) => date < today && !cancelledDates.has(date) && !(evidence.attendance || []).some((record) => record.date === date && (String(record.meetingNo) === String(meetingNo) || (!record.meetingNo && dates.filter((d) => d === date).length === 1)))).length : null;
  return { total, elapsed, future: dates.filter((date) => date >= today && !cancelledDates.has(date)).length, missingDates: total === null ? null : Math.max(0, total - dates.length), next: dates.find((date) => date >= today && !cancelledDates.has(date)) || '', end: dateKey(row.end_date || row.date_end) || dates.at(-1) || '', verified, cancelled, elapsedUnverified, missingReports };
}

export function activityPlanningFactsHtml(row, today) {
  const s = activityManagementSummary(row, today);
  return `<div class="activity-planning-facts" data-planning-facts>
    <span>לפי לוח: ${s.elapsed} שמועדם חלף${s.total === null ? ' · סה״כ לא זמין' : ` מתוך ${s.total} מתוכננים`}</span>
    <span>${s.future} מהיום והלאה${s.missingDates ? ` · ${s.missingDates} ללא תאריך` : ''}</span>
    <span>ביצוע מאומת באישור ביצוע: ${s.verified ?? 'לא זמין'} · ביטולים: ${s.cancelled ?? 'לא זמינים'}</span>
    <span>מועדים שחלפו ללא אימות: ${s.elapsedUnverified ?? 'לא ניתן לאמת'}</span>
    <span>מועד שחלף או דיווח נוכחות אינם אישור ביצוע.</span>
    ${s.next ? `<span>המפגש הבא: <bdi>${escapeHtml(formatDateHe(s.next))}</bdi></span>` : '<span>לא קיים מפגש עתידי בלוח הזמין</span>'}
  </div>`;
}

/** Uses only the permitted list projection; no private notes or extra requests. */
export function activityManagementIndicatorsHtml(row, { interactive = true } = {}) {
  const m = row.management;
  if (!m) return '<div class="activity-management-indicators" aria-live="polite">תמונת מצב ניהולית בטעינה</div>';
  const s = activityManagementSummary(row);
  const status = { assigned: 'משובץ', draft: 'ממתין לאישור שיבוץ', unassigned: 'ללא מדריך' }[activityInstructorAssignmentState(row)];
  const action = (key, label, value, enabled = true) => `<${enabled && interactive ? 'button type="button"' : 'span'} class="activity-management-indicator" ${enabled && interactive ? `data-management-action="${key}" data-management-row="${escapeHtml(row.RowID || row.row_id)}"` : ''}><small>${escapeHtml(label)}</small> ${escapeHtml(value)}</${enabled && interactive ? 'button' : 'span'}>`;
  const coordinationLabels = { not_sent: 'טרם נשלח', ready: 'מוכן לשליחה', draft: 'טיוטה', sent: 'נשלח — אינו אישור מוסד', changed_since_sent: 'השתנה מאז שליחה', missing_details: 'חסרים פרטים' };
  return `<div class="activity-management-indicators">
    ${action('activity', 'שיבוץ', status)}
    ${action('coordination', 'תיאום', m.coordination?.available ? (coordinationLabels[m.coordination.status] || m.coordination.status) : 'לא זמין בהרשאות הנוכחיות', m.coordination?.available)}
    ${action('attendance', 'נוכחות', s.missingReports === null ? (m.attendanceAvailable ? `${(m.attendance || []).length} דיווחים מקושרים; התמונה חלקית` : 'דיווחים אינם זמינים בהרשאות הנוכחיות') : `${s.missingReports} מועדים ללא דיווח; ${(m.attendance || []).length} דיווחים זמינים`, m.attendanceAvailable)}
    ${action('exceptions', 'חריגות', m.exceptionsAvailable ? `${m.exceptions.length} חריגות לפי הכללים הקיימים` : 'לא זמין', m.exceptionsAvailable)}
    ${m.feedback?.available ? m.feedback.slots.map((slot) => action('feedback', slot.label, `${slot.statusLabel}${slot.responses === null ? '' : ` · ${slot.responses} תשובות`}`)).join('') : action('feedback', 'משובים', 'לא זמין בהרשאות הנוכחיות', false)}
    ${m.feedback?.available && !m.feedback.applicable ? '<span>הפעילות אינה באוכלוסיית משובי הקבוצות הקיימת</span>' : ''}
    ${activityMeetingCheckpoints(row).map((point) => `<span class="activity-management-checkpoint"><small>${escapeHtml(point.label)}</small> <bdi>${escapeHtml(formatDateHe(point.date))}</bdi></span>`).join('')}
    ${m.errors?.length ? '<span role="status">חלק ממקורות הבקרה לא נטענו; אין להסיק שאין חוסרים.</span>' : ''}
  </div>`;
}

export function activityMobileSummaryHtml(row, { manager = '', classGroup = '', latest = '' } = {}) {
  const s = activityManagementSummary(row);
  const field = (label, value) => value ? `<span><small>${escapeHtml(label)}</small> <bdi>${escapeHtml(value)}</bdi></span>` : '';
  return `<div class="activity-mobile-summary">
    <div class="activity-mobile-summary__identity">${field('סטטוס', row.status || 'לא צוין')}${field('כיתה / קבוצה', classGroup)}${field('מנהל', manager || 'חסר מנהל פעילות')}</div>
    <span>לפי לוח: ${s.elapsed}${s.total === null ? '' : ` מתוך ${s.total}`} מפגשים שמועדם חלף</span>
    <div class="activity-mobile-summary__schedule">${field('המפגש הבא', s.next ? formatDateHe(s.next) : 'אין מועד עתידי בלוח')}${field('סיום', s.end ? formatDateHe(s.end) : 'חסר תאריך סיום')}</div>
    ${!dateKey(row.start_date || row.date_start) ? '<span class="activity-mobile-summary__warning">חסר תאריך התחלה</span>' : ''}
    <div class="activity-mobile-summary__expanded">${field('התחלה', formatDateHe(row.start_date || row.date_start))}${activityPlanningFactsHtml(row)}${field('עדכון אחרון', latest)}${activityManagementIndicatorsHtml(row)}</div>
  </div>`;
}


export function activityMeetingManagementHtml(row) {
  const m = row.management || {};
  const raw = Array.from({ length: 35 }, (_, i) => dateKey(row[`date_${i + 1}`]));
  const slots = raw.some(Boolean) ? raw : (row.meeting_schedule?.map((item) => dateKey(item.date)) || row.meeting_dates || row.date_cols || []);
  const today = managementToday();
  const next = activityManagementSummary(row).next;
  return `<details class="activity-meeting-control"><summary>בקרת מפגשים לפי הלוח (${slots.filter(Boolean).length})</summary><ol>${slots.map((date, index) => {
    if (!date) return '';
    const cancelled = m.cancellationsAvailable && m.cancelledDates.includes(date);
    const approved = m.approvalsAvailable && m.approvedDates.includes(date);
    const status = cancelled ? 'בוטל' : approved ? 'קיים אישור ביצוע מאושר' : date >= today ? 'מתוכנן' : 'המועד חלף — אין אימות זמין';
    const reports = (m.attendance || []).filter((record) => record.date === date && (String(record.meetingNo) === String(index + 1) || (!record.meetingNo && slots.filter((d) => d === date).length === 1)));
    const history = (m.history || []).filter((event) => event.date === date);
    return `<li><strong>מפגש ${index + 1} · <bdi>${escapeHtml(formatDateHe(date))}</bdi></strong>${date === next ? '<span>המפגש הבא לפי לוח</span>' : ''}<span>${status}</span><span>נוכחות: ${m.attendanceAvailable ? reports.length + ' דיווחים זמינים' : 'לא זמין'}</span>${history.map((event) => `<span>אירוע שיבוץ: ${escapeHtml(event.instructor || 'שם לא צוין')} · <bdi>${escapeHtml(formatDateHe(String(event.recordedAt || '').slice(0, 10)))}</bdi></span>`).join('')}${!m.historyAvailable ? '<span>היסטוריית שיבוץ אינה זמינה בהרשאות הנוכחיות</span>' : ''}</li>`;
  }).join('')}</ol></details>`;
}

export function activityManagementPanelHtml(row) {
  return `<section class="activity-drawer__section activity-management-panel" data-management-panel data-mode="view"><h3 class="activity-drawer__section-title">תמונת מצב ניהולית</h3>${activityPlanningFactsHtml(row)}${activityManagementIndicatorsHtml(row)}${activityMeetingManagementHtml(row)}</section>`;
}

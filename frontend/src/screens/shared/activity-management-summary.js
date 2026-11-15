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
  const historical = row.activity_season === 'summer_2026';
  return `<div class="activity-planning-facts" data-planning-facts>
    <span class="activity-planning-progress">התקדמות הקורס: <bdi>${s.elapsed}${s.total === null ? '' : '/' + s.total}</bdi> מפגשים</span>
    ${s.missingDates ? `<span>${s.missingDates} ללא תאריך</span>` : ''}
    ${historical && s.verified !== null ? `<span>אישורי ביצוע: ${s.verified}</span>` : ''}
    ${s.cancelled > 0 ? `<span>ביטולים: ${s.cancelled}</span>` : ''}
    ${s.next ? `<span class="activity-planning-next">המפגש הבא: <bdi>${escapeHtml(formatDateHe(s.next))}</bdi></span>` : ''}
  </div>`;
}

/** Present existing evidence only; unknown sources are not counted as zero. */
export function activityManagementIndicatorsHtml(row, { interactive = true, compact = false } = {}) {
  const m = row.management;
  if (!m) return '';
  const s = activityManagementSummary(row);
  const status = { assigned: 'משובץ', draft: 'ממתין לאישור שיבוץ', unassigned: 'ללא מדריך' }[activityInstructorAssignmentState(row)];
  const action = (key, label, value, enabled = true) => `<${enabled && interactive ? 'button type="button"' : 'span'} class="activity-management-indicator" ${enabled && interactive ? `data-management-action="${key}" data-management-row="${escapeHtml(row.RowID || row.row_id)}"` : ''}><small>${escapeHtml(label)}</small> ${escapeHtml(value)}</${enabled && interactive ? 'button' : 'span'}>`;
  const coordinationLabels = { not_sent: 'טרם נשלח', ready: 'מוכן לשליחה', draft: 'טיוטה', sent: 'נשלח', changed_since_sent: 'נדרש עדכון', missing_details: 'חסרים פרטים' };
  const slots = m.feedback?.available ? (m.feedback.slots || []) : [];
  const linked = (m.attendance || []).length;
  return `<div class="activity-management-indicators">
    ${!compact ? action('activity', 'שיבוץ', status || 'ללא מדריך') : ''}
    ${m.coordination?.available ? action('coordination', 'תיאום', coordinationLabels[m.coordination.status] || m.coordination.status) : ''}
    ${s.missingReports !== null ? action('attendance', 'נוכחות', `${s.missingReports} דיווחים חסרים`, m.attendanceAvailable) : m.attendanceAvailable && (linked > 0 || s.elapsed > 0) ? action('attendance', 'נוכחות', linked > 0 ? `${linked} דיווחים` : 'צפייה בדיווחים') : ''}
    ${m.exceptionsAvailable ? action('exceptions', 'חריגות', String(m.exceptions.length)) : ''}
    ${s.cancelled > 0 ? action('activity', 'ביטולים', String(s.cancelled)) : ''}
    ${compact && slots.length ? action('feedback', 'משובים', m.feedback.needsAttention ? 'דורש טיפול' : 'לצפייה') : !compact ? slots.map((slot) => action('feedback', slot.label, `${slot.statusLabel}${slot.responses === null ? '' : ` · ${slot.responses} תשובות`}`)).join('') : ''}
    ${!compact ? activityMeetingCheckpoints(row).map((point) => `<span class="activity-management-checkpoint"><small>${escapeHtml(point.label)}</small> <bdi>${escapeHtml(formatDateHe(point.date))}</bdi></span>`).join('') : ''}
  </div>`;
}

export function activityMobileSummaryHtml(row, { manager = '', classGroup = '', school = '', authority = '', instructorHtml = '', compact2027 = row.activity_season === 'school_2027', showStart = false } = {}) {
  const s = activityManagementSummary(row);
  const clean = (value) => {
    const text = String(value || '').trim();
    return /^(?:[-—–]|לא משויך|ללא)?$/.test(text) ? '' : text;
  };
  const field = (label, value) => value ? `<span><small>${escapeHtml(label)}</small> <bdi>${escapeHtml(value)}</bdi></span>` : '';
  const identity = [clean(school), clean(authority), clean(classGroup)].filter(Boolean).join(' · ');
  const percent = s.total ? Math.max(0, Math.min(100, Math.round(s.elapsed / s.total * 100))) : 0;
  const rowId = String(row.RowID || row.row_id || '');
  const managerField = field('מנהל', clean(manager) || (compact2027 ? '' : 'ללא מנהל'));
  const validInstructor = instructorHtml && (!compact2027 || !/data-assignment-state=["']unassigned["']|ללא מדריך/.test(instructorHtml));
  const start = showStart ? dateKey(row.start_date || row.date_start) : '';
  const schedule = new Map();
  for (const [label, date] of [['התחלה', start], ['המפגש הבא', s.next], ['סיום', s.end]]) {
    if (date) schedule.set(date, schedule.has(date) ? schedule.get(date) + ' / ' + label : label);
  }
  const dateFields = [...schedule].map(([date, label]) => field(label, formatDateHe(date))).join('');
  return `<div class="activity-mobile-summary" data-mobile-card-identity="${compact2027 || instructorHtml ? '1' : '0'}"${compact2027 ? ' data-mobile-2027-card' : ''}>
    <div class="activity-mobile-summary__identity"><span class="activity-mobile-status">${escapeHtml(row.status || 'ללא סטטוס')}</span>${identity ? `<span>${escapeHtml(identity)}</span>` : ''}</div>
    ${managerField || validInstructor ? `<div class="activity-mobile-summary__team">${managerField}${validInstructor ? `<span><small>מדריך/ה</small> ${instructorHtml}</span>` : ''}</div>` : ''}
    <div class="activity-mobile-summary__progress"><span>התקדמות הקורס</span><strong><bdi>${s.elapsed}${s.total === null ? '' : '/' + s.total}</bdi></strong></div>
    ${s.total ? `<div class="activity-mobile-progress-track" role="progressbar" aria-label="התקדמות הקורס" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${percent}%"></span></div>` : ''}
    ${dateFields ? `<div class="activity-mobile-summary__schedule">${dateFields}</div>` : ''}
    ${!dateKey(row.start_date || row.date_start) ? '<span class="activity-mobile-summary__warning">חסר תאריך התחלה</span>' : ''}
    ${compact2027 ? '' : `<div class="activity-mobile-summary__expanded">${activityManagementIndicatorsHtml(row, { compact: true })}</div>`}
    <div class="activity-mobile-summary__actions">${rowId ? `<button type="button" class="activity-mobile-open" data-management-action="activity" data-management-row="${escapeHtml(rowId)}">פרטי פעילות</button>` : ''}</div>
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
    const approved = row.activity_season === 'summer_2026' && m.approvalsAvailable && m.approvedDates.includes(date);
    const status = cancelled ? 'בוטל' : approved ? 'קיים אישור ביצוע מאושר' : date >= today ? 'מתוכנן' : 'מועד שחלף';
    const reports = (m.attendance || []).filter((record) => record.date === date && (String(record.meetingNo) === String(index + 1) || (!record.meetingNo && slots.filter((d) => d === date).length === 1)));
    const history = (m.history || []).filter((event) => event.date === date);
    return `<li><strong>מפגש ${index + 1} · <bdi>${escapeHtml(formatDateHe(date))}</bdi></strong>${date === next ? '<span>המפגש הבא לפי לוח</span>' : ''}<span>${status}</span>${m.attendanceAvailable && reports.length ? `<span>נוכחות: ${reports.length} דיווחים</span>` : ''}${history.map((event) => `<span>אירוע שיבוץ: ${escapeHtml(event.instructor || 'שם לא צוין')} · <bdi>${escapeHtml(formatDateHe(String(event.recordedAt || '').slice(0, 10)))}</bdi></span>`).join('')}</li>`;
  }).join('')}</ol></details>`;
}

export function activityManagementPanelHtml(row) {
  return `<section class="activity-drawer__section activity-management-panel" data-management-panel data-mode="view"><h3 class="activity-drawer__section-title">תמונת מצב ניהולית</h3>${activityManagementIndicatorsHtml(row)}${activityMeetingManagementHtml(row)}</section>`;
}

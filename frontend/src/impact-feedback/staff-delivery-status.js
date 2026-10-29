const STATUSES = Object.freeze({
  not_due: ['טרם הגיע מועד', 'muted'],
  pending: ['ממתין לשליחה', 'pending'],
  sent: ['נשלח', 'success'],
  failed: ['נכשל', 'warning'],
  needs_attention: ['דורש טיפול', 'warning']
});

export function staffDeliveryStatus(value) {
  const [label, tone] = STATUSES[value] || STATUSES.needs_attention;
  return { label, tone };
}

export function staffStatusIndex(rows = []) {
  return new Map(rows.map((row) => [`${row.activity_row_id}|${row.stage}`, row]));
}

/**
 * An automatic email can be pending for a future course, due next Thursday,
 * or permanently missed for an older opening cohort. Show those separately.
 * This read-only presenter never changes mail queues or questionnaire records.
 */
function localIsraelDay(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(now));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return [p.year, p.month, p.day].join('-');
}
function shiftUtcDate(day, offset) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function staffDeliveryPresentation({
  stage, status, reason, startDate, eligibilityAt, scheduledOn, now = Date.now()
} = {}) {
  if (!status) return { label: 'סטטוס שליחה לא זמין', tone: 'muted' };
  if (status === 'sent') return { label: 'נשלח', tone: 'success' };
  if (status === 'pending') return { label: 'ממתין לשליחה', tone: 'pending' };
  if (status === 'scheduled') return { label: 'שליחה היום ב-08:00', tone: 'scheduled' };
  if (status === 'failed') return { label: 'השליחה נכשלה', tone: 'warning' };
  if (status === 'needs_attention') {
    const issues = {
      missing_selected_contact: 'חסר איש קשר',
      missing_contact_email: 'חסרה כתובת מייל',
      unresolved_program: 'לא זוהה קורס',
      missing_end_time: 'חסרה שעת סיום מפגש',
      overlapping_delivery: 'נדרש בירור שליחה כפולה',
      graph_response_lost: 'תוצאת השליחה לא ידועה',
      unknown: 'תוצאת השליחה לא ידועה'
    };
    return { label: issues[reason] || 'דרושה בדיקת שליחה', tone: 'warning' };
  }
  if (status !== 'not_due') return staffDeliveryStatus(status);
  const day = localIsraelDay(now);
  const timestamp = new Date(now).getTime();

  if (stage === 'pre') {
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(startDate || '')) {
      return { label: 'חסר תאריך התחלה', tone: 'warning' };
    }
    if (startDate > day) return { label: 'ממתין לתחילת הקורס', tone: 'muted' };
    const weekDay = new Date(day + 'T12:00:00Z').getUTCDay();
    const untilThursday = (4 - weekDay + 7) % 7;
    const cohortStart = shiftUtcDate(day, untilThursday - 6);
    if (startDate < cohortStart) {
      return { label: 'לא נשלח · חלון השליחה חלף', tone: 'warning' };
    }
    return { label: 'שליחה בחמישי 08:00', tone: 'scheduled' };
  }

  if (stage === 'mid') {
    if (reason === 'unscheduled' || !eligibilityAt) {
      return { label: 'ממתין לתאריכי המפגשים', tone: 'muted' };
    }
    if (Date.parse(eligibilityAt) > timestamp) {
      return { label: 'ממתין למפגש האמצעי', tone: 'muted' };
    }
    return { label: scheduledOn ? 'מועד שליחה נדחה' : 'שליחה בחמישי 08:00', tone: 'scheduled' };
  }

  if (stage === 'final') {
    if (!eligibilityAt || Date.parse(eligibilityAt) > timestamp) {
      return { label: 'ממתין לסיום הקורס', tone: 'muted' };
    }
    return { label: scheduledOn ? 'מועד שליחה נדחה' : 'ממתין לשליחת הסיום', tone: 'scheduled' };
  }
  return staffDeliveryStatus(status);
}

/**
 * Staff closing questionnaire eligibility is governed by the canonical Activities
 * end date AND the actual (non-cancelled) last meeting, not by when a personal link
 * happened to be created or manually shared.
 *
 * A staff closing campaign may already exist before its send date. Such an early
 * campaign must never be labelled "ממתין למילוי" merely because its link is active.
 */
export function staffFinalReadiness({
  endDate, eligibilityAt, eligibilityStatus, now = Date.now()
} = {}) {
  const localDay = localIsraelDay(now);
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDate || '')) {
    return { ready: false, label: 'ממתין לתאריך סיום', tone: 'muted' };
  }
  if (endDate >= localDay) {
    return { ready: false, label: 'ממתין לסיום הקורס', tone: 'muted' };
  }
  const dueMs = Date.parse(eligibilityAt || '');
  if (!Number.isFinite(dueMs)) {
    return { ready: false, label: 'ממתין להשלמת מפגשי הקורס', tone: 'muted' };
  }
  if (dueMs > new Date(now).getTime()) {
    return { ready: false, label: 'ממתין להשלמת מפגשי הקורס', tone: 'muted' };
  }
  if (eligibilityStatus === 'not_due' || eligibilityStatus === 'unscheduled') {
    return { ready: false, label: 'ממתין למועד שליחת הסיום', tone: 'muted' };
  }
  return { ready: true, label: '', tone: 'muted' };
}

/** An old personal link might expire before the course has even finished. */
export function staffFinalExpiryWarning({ expiresAt, endDate, now = Date.now() } = {}) {
  if (!expiresAt || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(endDate || '')) return '';
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return '';
  if (endDate < localIsraelDay(now)) return '';
  // The expected closing survey date is the day after the official course end.
  return expiresMs < Date.parse(endDate + 'T23:59:59+02:00')
    ? 'תוקף הקישור מסתיים לפני סיום הקורס' : '';
}

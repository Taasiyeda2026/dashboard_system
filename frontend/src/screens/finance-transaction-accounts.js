export const TRANSACTION_MEETING_HOURS = 1.5;
export const FINANCE_TIME_ZONE = 'Asia/Jerusalem';
export const TRANSACTION_MODE_AUTOMATIC = 'automatic';
export const TRANSACTION_MODE_MANUAL = 'manual';

const text = (value) => String(value ?? '').trim();
const iso = (value) => (/^\d{4}-\d{2}-\d{2}/.exec(text(value)) || [])[0] || '';

function israelParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function financeToday(now = new Date()) {
  const p = israelParts(now);
  return `${p.year}-${p.month}-${p.day}`;
}

export function financeCycleCutoff(now = new Date()) {
  const p = israelParts(now);
  const firstOfMonth = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, 1));
  const previousDay = new Date(firstOfMonth.getTime() - 86400000);
  return previousDay.toISOString().slice(0, 10);
}

export function financePaymentDueDate(issueDate = financeToday(), days = 30) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(issueDate));
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const monthEnd = new Date(Date.UTC(year, month, 0));
  monthEnd.setUTCDate(monthEnd.getUTCDate() + days);
  return monthEnd.toISOString().slice(0, 10);
}

function compactFundingPart(value) {
  return text(value)
    .normalize('NFKC')
    .replace(/["'`׳״]/g, '')
    .replace(/[\s_\-./\\]+/g, '')
    .toLowerCase();
}

export function hasGefenFunding(value) {
  return text(value)
    .split('+')
    .map(compactFundingPart)
    .some((token) => token === 'גפן' || token === 'gefen' || token === 'gafan');
}

export function activityMeetingSlots(activity = {}) {
  const rows = [];
  for (let slot = 1; slot <= 35; slot += 1) {
    const date = iso(activity[`date_${slot}`]);
    if (date) rows.push({ slot, date });
  }
  return rows;
}

// Compatibility helper: intentionally preserves duplicate same-day meetings.
export function activityMeetingDates(activity = {}) {
  return activityMeetingSlots(activity).map((row) => row.date);
}

export function plannedMeetingCount(activity = {}, slots = activityMeetingSlots(activity)) {
  const sessions = Number.parseInt(text(activity.sessions), 10);
  return Number.isSafeInteger(sessions) && sessions > 0 ? sessions : slots.length;
}

function minutes(value) {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 3600 + minute * 60 + Number(match[3] || 0);
}

function completedByCutoff(slot, activity, cutoff, now) {
  if (slot.date < cutoff) return true;
  if (slot.date > cutoff) return false;
  const today = financeToday(now);
  if (cutoff < today) return true;
  if (cutoff > today) return false;
  const endMinutes = minutes(activity.end_time);
  if (endMinutes == null) return false;
  const p = israelParts(now);
  return (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second)) > endMinutes;
}

// Descriptive progress only. Billing eligibility and amounts come exclusively
// from finance_billing_preview and are recalculated again by the reservation RPC.
export function financeActivityFacts(activity = {}, { cancelledDates = [], now = new Date() } = {}) {
  const slots = activityMeetingSlots(activity);
  const plannedCount = plannedMeetingCount(activity, slots);
  const cancelled = new Set(cancelledDates.map(iso));
  const active = slots.filter((slot) => !cancelled.has(slot.date));
  const completed = active.filter((slot) => completedByCutoff(slot, activity, financeToday(now), now));
  return { plannedCount, scheduledCount: slots.length, completedCount: completed.length,
    cancelledCount: slots.length - active.length, completedSlots: completed,
    finished: plannedCount > 0 && slots.length === plannedCount && completed.length === active.length };
}

export function transactionDraftContent(number, schoolName) {
  return {
    subject: `חשבון עסקה ${number} – תעשיידע – ${text(schoolName)}`,
    body: `שלום,\n\nמצורף חשבון עסקה מס׳ ${number} עבור הפעילויות שבוצעו בתקופה הרלוונטית.\n\nנשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.`
  };
}
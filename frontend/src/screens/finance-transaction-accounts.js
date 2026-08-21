export const TRANSACTION_MEETING_HOURS = 1.5;
export const TRANSACTION_MIN_MEETINGS = 3;
export const FINANCE_TIME_ZONE = 'Asia/Jerusalem';

const text = (value) => String(value ?? '').trim();
const iso = (value) => (/^\d{4}-\d{2}-\d{2}/.exec(text(value)) || [])[0] || '';

function israelParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: FINANCE_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
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
  const match = /^(\d{1,2}):(\d{2})/.exec(text(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
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
  return (Number(p.hour) * 60 + Number(p.minute)) >= endMinutes;
}

function billedSlotNumbers(billedSlots = []) {
  return new Set((billedSlots || []).map((value) => Number(value?.slot ?? value?.meeting_slot ?? value)).filter(Number.isFinite));
}

export function transactionActivitySummary(activity = {}, {
  cutoff = financeCycleCutoff(),
  cancelledDates = [],
  billedSlots = [],
  billedDates = [],
  billedAmount = 0,
  now = new Date()
} = {}) {
  const slots = activityMeetingSlots(activity);
  const plannedCount = plannedMeetingCount(activity, slots);
  const cancelled = new Set(cancelledDates.map(iso).filter(Boolean));
  const billedSlotSet = billedSlotNumbers(billedSlots);
  const legacyBilledDates = new Set(billedDates.map(iso).filter(Boolean));
  const slotIsBilled = (slot) => billedSlotSet.size
    ? billedSlotSet.has(slot.slot)
    : legacyBilledDates.has(slot.date);

  const nonCancelledSlots = slots.filter((slot) => !cancelled.has(slot.date));
  const completedSlots = nonCancelledSlots.filter((slot) => completedByCutoff(slot, activity, cutoff, now));
  const unbilledSlots = completedSlots.filter((slot) => !slotIsBilled(slot));
  const billedCount = slots.filter(slotIsBilled).length;
  const finished = plannedCount > 0
    && slots.length >= plannedCount
    && nonCancelledSlots.every((slot) => completedByCutoff(slot, activity, cutoff, now));

  const price = Number(String(activity.price ?? '').replace(/[₪,\s]/g, ''));
  const hourlyRate = plannedCount > 0 && Number.isFinite(price)
    ? price / (plannedCount * TRANSACTION_MEETING_HOURS)
    : 0;
  const unbilledHours = unbilledSlots.length * TRANSACTION_MEETING_HOURS;
  const unbilledAmount = unbilledHours * hourlyRate;
  const isFinal = finished && unbilledSlots.length > 0;
  const eligible = unbilledSlots.length >= TRANSACTION_MIN_MEETINGS || isFinal;
  const targetRatio = plannedCount > 0 ? Math.min(nonCancelledSlots.length, plannedCount) / plannedCount : 0;
  const closingTarget = Number.isFinite(price) ? price * targetRatio : 0;
  const amount = eligible
    ? (isFinal ? Math.max(0, closingTarget - Number(billedAmount || 0)) : unbilledAmount)
    : 0;

  let blockedReason = '';
  if (!text(activity.semel_mosad)) blockedReason = 'חסר סמל מוסד';
  else if (!Number.isFinite(price) || price < 0) blockedReason = 'מחיר פעילות אינו תקין';
  else if (!plannedCount) blockedReason = 'חסר מספר מפגשים מתוכננים';
  else if (cutoff > financeToday(now)) blockedReason = 'נקודת החיתוך עתידית';

  return {
    activityRowId: text(activity.row_id),
    institutionSymbol: text(activity.semel_mosad),
    customerName: text(activity.school),
    customerEmail: text(activity.contact_email),
    plannedCount,
    scheduledCount: slots.length,
    completedCount: completedSlots.length,
    billedCount,
    unbilledSlots,
    unbilledDates: unbilledSlots.map((slot) => slot.date),
    unbilledCount: unbilledSlots.length,
    unbilledHours,
    unbilledAmount,
    hourlyRate,
    amount,
    eligible,
    closingBill: eligible && isFinal,
    blockedReason
  };
}

export function buildTransactionPreview(activities = [], options = {}) {
  const summaries = activities.map((activity) => transactionActivitySummary(activity, {
    cutoff: options.cutoff,
    cancelledDates: options.cancelledByActivity?.[activity.row_id] || [],
    billedSlots: options.billedSlotsByActivity?.[activity.row_id] || [],
    billedDates: options.billedByActivity?.[activity.row_id] || [],
    billedAmount: options.billedAmountByActivity?.[activity.row_id] || 0,
    now: options.now || new Date()
  }));
  const accounts = new Map();
  for (const item of summaries.filter((row) => row.eligible && !row.blockedReason)) {
    if (!accounts.has(item.institutionSymbol)) accounts.set(item.institutionSymbol, {
      institutionSymbol: item.institutionSymbol,
      customerName: item.customerName,
      customerEmail: item.customerEmail,
      lines: [], totalAmount: 0
    });
    const account = accounts.get(item.institutionSymbol);
    account.lines.push(item);
    account.totalAmount += item.amount;
  }
  const rows = [...accounts.values()];
  return {
    cutoff: options.cutoff,
    accounts: rows,
    deferred: summaries.filter((row) => !row.eligible && !row.blockedReason),
    blocked: summaries.filter((row) => row.blockedReason),
    totals: {
      schools: rows.length,
      activities: rows.reduce((sum, row) => sum + row.lines.length, 0),
      meetings: rows.reduce((sum, row) => sum + row.lines.reduce((n, line) => n + line.unbilledCount, 0), 0),
      hours: rows.reduce((sum, row) => sum + row.lines.reduce((n, line) => n + line.unbilledHours, 0), 0),
      amount: rows.reduce((sum, row) => sum + row.totalAmount, 0)
    }
  };
}

export function transactionDraftContent(number, schoolName) {
  return {
    subject: `חשבון עסקה ${number} – תעשיידע – ${text(schoolName)}`,
    body: `שלום,\n\nמצורף חשבון עסקה מס׳ ${number} עבור הפעילויות שבוצעו בתקופה הרלוונטית.\n\nנשמח להסדרת התשלום בהתאם לתנאי התשלום המפורטים בחשבון.`
  };
}

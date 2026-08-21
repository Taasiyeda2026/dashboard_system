import { getActivityDateColumns } from './shared/format-date.js';

export const TRANSACTION_MEETING_HOURS = 1.5;
export const TRANSACTION_MIN_MEETINGS = 3;

const text = (value) => String(value ?? '').trim();
const iso = (value) => (/^\d{4}-\d{2}-\d{2}/.exec(text(value)) || [])[0] || '';

export function financeCycleCutoff(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return date.toISOString().slice(0, 10);
}

export function activityMeetingDates(activity = {}) {
  return [...new Set(getActivityDateColumns(activity).map(iso).filter(Boolean))].sort();
}

export function transactionActivitySummary(activity = {}, {
  cutoff,
  cancelledDates = [],
  billedDates = [],
  billedAmount = 0
} = {}) {
  const allDates = activityMeetingDates(activity);
  const cancelled = new Set(cancelledDates.map(iso));
  const billed = new Set(billedDates.map(iso));
  const plannedDates = allDates.filter((date) => !cancelled.has(date));
  const completedDates = plannedDates.filter((date) => date <= cutoff);
  const unbilledDates = completedDates.filter((date) => !billed.has(date));
  const finished = plannedDates.length > 0 && plannedDates.every((date) => date <= cutoff);
  const eligible = unbilledDates.length >= TRANSACTION_MIN_MEETINGS
    || (finished && unbilledDates.length > 0);
  const price = Number(String(activity.price ?? '').replace(/[₪,\s]/g, ''));
  const plannedCount = plannedDates.length;
  const hourlyRate = plannedCount && Number.isFinite(price)
    ? price / (plannedCount * TRANSACTION_MEETING_HOURS)
    : 0;
  const billedHours = unbilledDates.length * TRANSACTION_MEETING_HOURS;
  const isFinal = finished && unbilledDates.length > 0;
  const rawAmount = billedHours * hourlyRate;
  const amount = eligible
    ? (isFinal ? Math.max(0, price - Number(billedAmount || 0)) : rawAmount)
    : 0;
  return {
    activityRowId: text(activity.row_id),
    institutionSymbol: text(activity.semel_mosad),
    customerName: text(activity.school),
    plannedCount,
    completedCount: completedDates.length,
    billedCount: completedDates.length - unbilledDates.length,
    unbilledDates,
    unbilledCount: unbilledDates.length,
    unbilledHours: billedHours,
    hourlyRate,
    amount,
    eligible,
    closingBill: eligible && isFinal,
    blockedReason: !text(activity.semel_mosad) ? 'חסר סמל מוסד' : (!Number.isFinite(price) || price < 0 ? 'מחיר פעילות אינו תקין' : '')
  };
}

export function buildTransactionPreview(activities = [], options = {}) {
  const summaries = activities.map((activity) => transactionActivitySummary(activity, {
    cutoff: options.cutoff,
    cancelledDates: options.cancelledByActivity?.[activity.row_id] || [],
    billedDates: options.billedByActivity?.[activity.row_id] || [],
    billedAmount: options.billedAmountByActivity?.[activity.row_id] || 0
  }));
  const accounts = new Map();
  for (const item of summaries.filter((row) => row.eligible && !row.blockedReason)) {
    if (!accounts.has(item.institutionSymbol)) accounts.set(item.institutionSymbol, {
      institutionSymbol: item.institutionSymbol,
      customerName: item.customerName,
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

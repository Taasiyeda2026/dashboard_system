import { instructorReportedCancellationMinutes } from '../services/cancellation-segments.js';

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('he-IL');
}

export function isCancellationRecord(record = {}) {
  return record?.generation_kind === 'travel_time_cancellation'
    || normalizedLabel(record?.activity_type) === normalizedLabel('ביטול זמן');
}

/**
 * Instructor-facing cancellation totals are based on submitted time, not manager
 * approval. Explicit standalone cancellations remain included, while generated
 * payroll lines are excluded when their source record is already available.
 */
export function reportedCancellationHours(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const sourceIds = new Set(rows.filter((row) => !row?.generation_kind).map((row) => String(row?.id ?? '')));
  return rows.reduce((hours, row) => {
    if (isCancellationRecord(row)) {
      if (row?.generation_kind === 'travel_time_cancellation'
          && sourceIds.has(String(row?.source_attendance_record_id ?? ''))) return hours;
      return hours + numberValue(row?.total_hours);
    }
    return hours + (instructorReportedCancellationMinutes(row) ?? 0) / 60;
  }, 0);
}

export function formatDurationHours(value) {
  const totalMinutes = Math.max(0, Math.round(numberValue(value) * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

export function buildDailyHoursByDate(records = []) {
  const totals = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const date = String(record?.report_date || '').slice(0, 10);
    if (!date) continue;
    totals.set(date, (totals.get(date) || 0) + numberValue(record?.total_hours));
  }
  return totals;
}

export function buildDailyTotalHoursByRecord(records = [], displayedRecords = records) {
  const totals = buildDailyHoursByDate(records);
  const shownDates = new Set();
  const displays = new Map();
  for (const record of Array.isArray(displayedRecords) ? displayedRecords : []) {
    const date = String(record?.report_date || '').slice(0, 10);
    const showTotal = date && !shownDates.has(date);
    if (showTotal) shownDates.add(date);
    displays.set(record, showTotal ? totals.get(date) : null);
  }
  return displays;
}

export function groupReportRecordsByDate(records = []) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const date = String(record?.report_date || '').slice(0, 10);
    if (!date) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(record);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, dayRecords]) => ({
      date,
      records: [...dayRecords].sort((a, b) => String(a?.start_time || '').localeCompare(String(b?.start_time || ''))),
      totalHours: dayRecords.reduce((sum, record) => sum + numberValue(record?.total_hours), 0),
      cancellationHours: reportedCancellationHours(dayRecords)
    }));
}

const TYPE_PRIORITY = new Map([
  ['קורס', 10],
  ['סדנה', 20],
  ['הכשרה', 30],
  ['סיור', 40],
  ['זום', 50],
  ['חדר בריחה', 60],
  ['תפעול', 70],
  ['ביטול זמן', 80]
]);

export function buildMonthlySummaryItems(records = []) {
  const hoursByType = new Map();
  let totalKm = 0;
  let totalExpenses = 0;
  const rows = Array.isArray(records) ? records : [];
  const sourceIds = new Set(rows.filter((row) => !row?.generation_kind).map((row) => String(row?.id ?? '')));

  for (const record of rows) {
    const generatedLinked = record?.generation_kind === 'travel_time_cancellation'
      && sourceIds.has(String(record?.source_attendance_record_id ?? ''));
    const hours = numberValue(record?.total_hours);
    let activityType = String(record?.activity_type || '').trim();
    if (!activityType && record?.generation_kind === 'travel_time_cancellation') activityType = 'ביטול זמן';
    if (!generatedLinked && activityType && hours > 0) {
      hoursByType.set(activityType, (hoursByType.get(activityType) || 0) + hours);
    }
    if (!isCancellationRecord(record)) {
      const requested = instructorReportedCancellationMinutes(record);
      if (requested !== null && requested > 0) {
        hoursByType.set('ביטול זמן', (hoursByType.get('ביטול זמן') || 0) + requested / 60);
      }
    }
    totalKm += numberValue(record?.roundtrip_km);
    totalExpenses += numberValue(record?.expenses);
  }

  const items = [...hoursByType.entries()]
    .sort(([left], [right]) => {
      const leftPriority = TYPE_PRIORITY.get(left) ?? 500;
      const rightPriority = TYPE_PRIORITY.get(right) ?? 500;
      return leftPriority - rightPriority || left.localeCompare(right, 'he');
    })
    .map(([activityType, hours]) => ({
      key: `hours:${activityType}`,
      kind: 'hours',
      activityType,
      label: activityType === 'ביטול זמן' ? 'סה״כ ביטול זמן' : `סה״כ שעות ${activityType}`,
      value: formatDurationHours(hours),
      numericValue: hours
    }));

  if (totalKm > 0) {
    items.push({
      key: 'kilometers',
      kind: 'kilometers',
      label: 'סה״כ ק״מ',
      value: `${Math.round(totalKm).toLocaleString('he-IL')} ק״מ`,
      numericValue: totalKm
    });
  }

  if (totalExpenses > 0) {
    items.push({
      key: 'expenses',
      kind: 'expenses',
      label: 'סה״כ הוצאות',
      value: `₪${totalExpenses.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`,
      numericValue: totalExpenses
    });
  }

  return items;
}

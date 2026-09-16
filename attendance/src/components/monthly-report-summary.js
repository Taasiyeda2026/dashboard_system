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
      cancellationHours: dayRecords
        .filter(isCancellationRecord)
        .reduce((sum, record) => sum + numberValue(record?.total_hours), 0)
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

  for (const record of Array.isArray(records) ? records : []) {
    const hours = numberValue(record?.total_hours);
    let activityType = String(record?.activity_type || '').trim();
    if (!activityType && record?.generation_kind === 'travel_time_cancellation') activityType = 'ביטול זמן';
    if (activityType && hours > 0) {
      hoursByType.set(activityType, (hoursByType.get(activityType) || 0) + hours);
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

/**
 * Travel is one daily chain, independent of the number of attendance reports.
 * The first and last legs have a 45-minute deductible. Every transfer between
 * activities is payable from its first minute. No leg is ever duplicated.
 */
export const DAILY_TRAVEL_DEDUCTIBLE_MINUTES = 45;
export const DAILY_TRAVEL_LEG_KINDS = Object.freeze(['outbound', 'between', 'return']);

export function dailyTravelCancellationMinutes(legs = []) {
  if (!Array.isArray(legs)) return null;
  let total = 0;
  for (const leg of legs) {
    if (!DAILY_TRAVEL_LEG_KINDS.includes(leg.kind)) return null;
    if (leg.minutes == null || leg.minutes === '') return null;
    const minutes = Number(leg.kind === 'between' ? leg.gapMinutes : leg.minutes);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) return null;
    total += leg.kind === 'between' ? minutes
      : Math.max(0, minutes - DAILY_TRAVEL_DEDUCTIBLE_MINUTES);
  }
  return total;
}

export function summarizeDailyTravel(legs = []) {
  if (!Array.isArray(legs) || legs.length < 2) {
    return { complete: false, kilometers: null, cancellationMinutes: null };
  }
  const kinds = legs.map(leg => leg.kind);
  if (kinds[0] !== 'outbound' || kinds.at(-1) !== 'return'
    || kinds.slice(1, -1).some(kind => kind !== 'between')) {
    return { complete: false, kilometers: null, cancellationMinutes: null };
  }
  const minutes = dailyTravelCancellationMinutes(legs);
  const kilometersValid = legs.every(leg => {
    if (leg.kind === 'between' && leg.sameLocation === true) return true;
    return leg.kilometers != null && leg.kilometers !== ''
      && Number.isFinite(Number(leg.kilometers)) && Number(leg.kilometers) >= 0;
  });
  const kilometers = kilometersValid
    ? Math.round(legs.reduce((sum, leg) => sum + (leg.kind === 'between' && leg.sameLocation === true ? 0 : Number(leg.kilometers)), 0) * 100) / 100
    : null;
  return { complete: minutes !== null && kilometers !== null, kilometers,
    cancellationMinutes: minutes };
}

export function buildDailyTravelLegs(records = [], homeLabel = 'בית') {
  const physical = (records || []).filter(record => !record.isOnline && !record.isRemote
    && record.activityType !== 'ביטול זמן' && record.generationKind !== 'travel_time_cancellation'
    && record.date && record.startTime && record.endTime)
    .slice().sort((a,b) => String(a.startTime).localeCompare(String(b.startTime))
      || String(a.recordId).localeCompare(String(b.recordId)));
  if (!physical.length) return [];
  const label = record => record.destinationAddress || record.school || record.location || '';
  const stops = physical.map(row => ({ recordId: String(row.recordId || ''),
    label: label(row), startTime: row.startTime, endTime: row.endTime }));
  const result = [{ kind: 'outbound', from: homeLabel, to: stops[0].label,
    toRecordId: stops[0].recordId, minutes: null, kilometers: null }];
  for (let index = 1; index < stops.length; index++) {
    result.push({ kind: 'between', from: stops[index-1].label, to: stops[index].label,
      fromRecordId: stops[index-1].recordId, toRecordId: stops[index].recordId,
      minutes: null, kilometers: null });
  }
  result.push({ kind: 'return', from: stops.at(-1).label, to: homeLabel,
    fromRecordId: stops.at(-1).recordId, minutes: null, kilometers: null });
  return result;
}

export function dailyTravelReportStatus(records, report) {
  const hasPhysical = buildDailyTravelLegs(records).length > 0;
  if (!hasPhysical) return 'not_required';
  if (report?.no_travel === true) return 'not_required';
  if (!report) return 'missing';
  return summarizeDailyTravel(report.legs).complete ? 'reported' : 'missing';
}

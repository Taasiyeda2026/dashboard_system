/** Canonical Nov+ travel payroll exclusivity helpers (mirrors SQL projection rules). */

const EPS = 0.01;
const CUTOVER = '2026-11-01';

export function travelAmountsCompatible(left, right) {
  return Math.abs(Number(left || 0) - Number(right || 0)) <= EPS;
}

export function classifyTravelComponentOverlap({
  legacyValue = 0,
  dailyValue = 0,
  noTravel = false,
  resolved = false
} = {}) {
  const legacy = Number(legacyValue || 0);
  const daily = Number(dailyValue || 0);
  if (legacy <= EPS && daily <= EPS) return 'none';
  if (legacy > EPS && daily <= EPS && !noTravel) return resolved ? 'resolved' : 'legacy_only_with_daily_zero';
  if (legacy > EPS && noTravel) return resolved ? 'resolved' : 'no_travel_vs_legacy';
  if (legacy <= EPS && daily > EPS) return 'daily_only';
  if (travelAmountsCompatible(legacy, daily)) return 'compatible';
  return resolved ? 'resolved' : 'conflict';
}

/**
 * Payroll projection kilometres for one attendance row.
 * Does not mutate source rows — returns the payable km only.
 */
export function projectedPayrollKilometers(row = {}, {
  dailyCanonicalDays = new Set(),
  attendanceDateKey = 'attendanceDate'
} = {}) {
  const date = String(row[attendanceDateKey] || row.attendance_date || row.report_date || row.date || '').slice(0, 10);
  const emp = String(row.employeeId || row.employee_id || row.emp_id || '');
  const kind = String(row.generationKind || row.generation_kind || '');
  const km = Number(row.kilometers ?? row.roundtrip_km ?? 0) || 0;
  if (date < CUTOVER) return km;
  const dayKey = `${emp}|${date}`;
  if (!kind && dailyCanonicalDays.has(dayKey)) return 0;
  return km;
}

export function buildDailyCanonicalDaySet(rows = []) {
  const days = new Set();
  for (const row of rows || []) {
    const kind = String(row.generationKind || row.generation_kind || '');
    const review = String(row.review_status || row.reviewStatus || '');
    const date = String(row.attendanceDate || row.attendance_date || row.travel_date || row.report_date || row.date || '').slice(0, 10);
    const emp = String(row.employeeId || row.employee_id || row.emp_id || '');
    if (!emp || !date || date < CUTOVER) continue;
    if (kind === 'daily_travel_cancellation' || review === 'approved' || review === 'corrected') {
      days.add(`${emp}|${date}`);
    }
  }
  return days;
}

/** Simulate before/after km for an instructor-day inventory row. */
export function simulateDayPayrollKm({
  legacyKm = 0,
  dailyKm = null,
  reviewStatus = null,
  payableKm = 0,
  resolvedKm = null,
  unresolvedConflict = false
} = {}) {
  const hasDaily = dailyKm != null || reviewStatus != null;
  const approved = reviewStatus === 'approved' || reviewStatus === 'corrected';
  const today = Number(legacyKm || 0) + Number(payableKm || 0);
  if (!hasDaily) {
    return {
      todayKm: today,
      afterFixKm: Number(legacyKm || 0),
      ifApproveWithoutGuardKm: today,
      blocked: false
    };
  }
  const dailyAmount = approved
    ? (resolvedKm != null ? Number(resolvedKm) : Number(dailyKm || 0))
    : Number(dailyKm || 0);
  const ifApproveWithoutGuard = Number(legacyKm || 0) + (Number(payableKm || 0) > 0 ? Number(payableKm) : dailyAmount);
  if (unresolvedConflict && !approved) {
    return {
      todayKm: today,
      afterFixKm: Number(legacyKm || 0),
      ifApproveWithoutGuardKm: ifApproveWithoutGuard,
      blocked: true
    };
  }
  if (approved || Number(payableKm || 0) > 0) {
    const exclusive = Number(payableKm || 0) > 0
      ? Number(payableKm)
      : (resolvedKm != null ? Number(resolvedKm) : dailyAmount);
    return {
      todayKm: today,
      afterFixKm: exclusive,
      ifApproveWithoutGuardKm: ifApproveWithoutGuard,
      blocked: false
    };
  }
  // Pending daily: keep legacy entitlement; do not treat daily as paid.
  return {
    todayKm: today,
    afterFixKm: Number(legacyKm || 0),
    ifApproveWithoutGuardKm: ifApproveWithoutGuard,
    blocked: classifyTravelComponentOverlap({
      legacyValue: legacyKm,
      dailyValue: dailyKm,
      noTravel: false
    }) === 'conflict'
  };
}

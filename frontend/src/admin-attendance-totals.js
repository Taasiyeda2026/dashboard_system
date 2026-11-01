import { activityTypeDisplayLabel } from './screens/shared/activity-options.js';
import { escapeHtml } from './screens/shared/html.js';
import { reportedCancellationHours } from '../../attendance/src/components/monthly-report-summary.js';
import { roundCancellationMinutesUp } from '../../attendance/src/services/cancellation-segments.js';

const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const first = (row, keys) => keys.map(key => row[key]).find(value => value != null && value !== '');

export function buildAdminAttendanceTotals(records = [], { monthKey, employeeIds = [] } = {}) {
  const scope = new Set(employeeIds.map(text));
  const seen = new Set();
  const rows = [];
  for (const row of records) {
    const emp = text(first(row, ['employeeId', 'EmployeeId', 'empNum', 'emp_id']));
    const date = text(first(row, ['attendanceDate', 'AttendanceDate', 'report_date', 'date']));
    if (!scope.has(emp) || date.slice(0, 7) !== monthKey) continue;
    const id = text(first(row, ['recordId', 'id', 'ID', 'Id']));
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    const rawType = text(first(row, ['activityType', 'ActivityType', 'activity_type']));
    const type = rawType === 'סדנאות קיץ' ? 'סדנה' : rawType === 'מקוון' ? 'זום' : activityTypeDisplayLabel(rawType) || 'אחר';
    const outbound = first(row, ['reportedOutboundMinutes', 'reported_outbound_minutes']);
    const inbound = first(row, ['reportedReturnMinutes', 'reported_return_minutes']);
    rows.push({
      id, activity_type: type,
      total_hours: number(first(row, ['workHours', 'WorkHours', 'total_hours'])),
      generation_kind: first(row, ['generationKind', 'generation_kind']),
      source_attendance_record_id: first(row, ['sourceAttendanceRecordId', 'source_attendance_record_id']),
      cancellation_before_minutes: first(row, ['reportedCancellationBeforeMinutes', 'cancellation_before_minutes']),
      cancellation_after_minutes: first(row, ['reportedCancellationAfterMinutes', 'cancellation_after_minutes']),
      travel_compensation: row.travel_compensation || {
        requested_cancellation_minutes: outbound != null && inbound != null
          ? roundCancellationMinutesUp(Math.max(0, number(outbound) - 45)) + roundCancellationMinutesUp(Math.max(0, number(inbound) - 45))
          : null
      },
      kilometers: [true, 'true', 1].includes(first(row, ['publicTransport', 'PublicTransport', 'public_transport']))
        ? 0 : number(first(row, ['kilometers', 'Kilometers', 'roundtrip_km']))
    });
  }
  const hoursByType = new Map(['קורס', 'סדנה', 'הכשרה', 'תפעול', 'ביטול זמן', 'זום'].map(type => [type, 0]));
  let totalKilometers = 0;
  for (const row of rows) {
    if (row.generation_kind === 'travel_time_cancellation' || row.activity_type === 'ביטול זמן') continue;
    totalKilometers += row.kilometers;
    hoursByType.set(row.activity_type, (hoursByType.get(row.activity_type) || 0) + row.total_hours);
  }
  hoursByType.set('ביטול זמן', reportedCancellationHours(rows));
  return { totalKilometers, totalHours: [...hoursByType.values()].reduce((sum, hours) => sum + hours, 0), hoursByType };
}

function duration(hours) {
  const minutes = Math.round(number(hours) * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function adminAttendanceTotalsHtml(totals, monthKey) {
  const card = (label, value) => `<article><span>${escapeHtml(label)}</span><strong dir="ltr">${escapeHtml(value)}</strong></article>`;
  return `<section class="admin-attendance-totals" data-admin-attendance-totals aria-label="סיכום דיווחי החודש">
    <h2>סיכום דיווחי ${escapeHtml(monthKey)}</h2>
    <div class="admin-attendance-standalone__summary">
      ${card('סה״כ ק״מ', totals.totalKilometers.toLocaleString('he-IL', { maximumFractionDigits: 1 }))}
      ${card('סה״כ שעות', duration(totals.totalHours))}
      ${[...totals.hoursByType].map(([type, hours]) => card(`שעות ${type}`, duration(hours))).join('')}
    </div>
  </section>`;
}

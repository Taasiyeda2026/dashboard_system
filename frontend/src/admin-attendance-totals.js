import { activityTypeDisplayLabel } from './screens/shared/activity-options.js';
import { escapeHtml } from './screens/shared/html.js';
import { reportedCancellationHours } from '../../attendance/src/components/monthly-report-summary.js';
import { isSuspectCancellationRequest, roundCancellationMinutesUp } from '../../attendance/src/services/cancellation-segments.js';

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
    // Zoom/online describes delivery mode, not the actual work category.
    // Do not guess training/course/operations from meeting notes or names.
    const modeOnlyType = ['זום', 'מקוון', 'zoom', 'online'].includes(rawType.toLowerCase());
    const explicitWorkType = text(first(row, ['workActivityType', 'work_activity_type', 'underlyingActivityType', 'underlying_activity_type']));
    const resolvedType = modeOnlyType && explicitWorkType && !['זום', 'מקוון', 'zoom', 'online'].includes(explicitWorkType.toLowerCase())
      ? explicitWorkType : rawType;
    const type = modeOnlyType && resolvedType === rawType
      ? '' : resolvedType === 'סדנאות קיץ' ? 'סדנה' : activityTypeDisplayLabel(resolvedType) || 'אחר';
    const outbound = first(row, ['reportedOutboundMinutes', 'reported_outbound_minutes']);
    const inbound = first(row, ['reportedReturnMinutes', 'reported_return_minutes']);
    rows.push({
      id, employeeId: emp, date,
      activity_name: text(first(row, ['activityName', 'activity_name_snapshot', 'programName', 'program_name'])),
      notes: text(first(row, ['notes', 'Notes'])),
      activity_type: type,
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
  const hoursByType = new Map(['קורס', 'סדנה', 'הכשרה', 'תפעול', 'ביטול זמן'].map(type => [type, 0]));
  let unclassifiedOnlineHours = 0;
  let unclassifiedOnlineCount = 0;
  let totalKilometers = 0;
  for (const row of rows) {
    if (row.generation_kind === 'travel_time_cancellation' || row.activity_type === 'ביטול זמן') continue;
    totalKilometers += row.kilometers;
    if (!row.activity_type) {
      unclassifiedOnlineHours += row.total_hours;
      unclassifiedOnlineCount += 1;
      continue;
    }
    hoursByType.set(row.activity_type, (hoursByType.get(row.activity_type) || 0) + row.total_hours);
  }
  hoursByType.set('ביטול זמן', reportedCancellationHours(rows));
  const suspectCancellationRecords = rows.filter(isSuspectCancellationRequest);
  const unclassifiedOnlineRecords = rows.filter(row =>
    !row.activity_type && row.generation_kind !== 'travel_time_cancellation');
  const suspectCancellationCount = suspectCancellationRecords.length;
  return { totalKilometers, totalHours: [...hoursByType.values()].reduce((sum, hours) => sum + hours, 0) + unclassifiedOnlineHours,
    hoursByType, suspectCancellationCount, suspectCancellationRecords, unclassifiedOnlineHours, unclassifiedOnlineCount, unclassifiedOnlineRecords };

}

function duration(hours) {
  const minutes = Math.round(number(hours) * 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function adminAttendanceTotalsHtml(totals, monthKey) {
  const card = (label, value) => `<article><span>${escapeHtml(label)}</span><strong dir="ltr">${escapeHtml(value)}</strong></article>`;
  // Show only metrics that were actually reported in the selected month.
  // Preserve calculated values and categories; this filters presentation only.
  const cards = [];
  if (number(totals.totalKilometers) > 0) {
    cards.push(card('סה״כ ק״מ', totals.totalKilometers.toLocaleString('he-IL', { maximumFractionDigits: 1 })));
  }
  const preferredTypes = ['קורס', 'הכשרה', 'תפעול', 'סדנה', 'ביטול זמן'];
  const remainingTypes = [...totals.hoursByType.keys()].filter(type => !preferredTypes.includes(type));
  for (const type of [...preferredTypes, ...remainingTypes]) {
    const hours = number(totals.hoursByType.get(type));
    if (hours > 0) cards.push(card(`שעות ${type}`, duration(hours)));
  }
  // Cancellation anomalies are controls, not reporting categories: keep
  // their warning visible without crowding the numeric metrics row.
  const warning = number(totals.suspectCancellationCount) > 0
    ? `<button type="button" class="admin-attendance-totals__warning admin-attendance-totals__review-trigger" data-admin-attendance-review-kind="cancellation" aria-expanded="false">ביטול זמן חריג – לבדיקה: <strong>${escapeHtml(String(totals.suspectCancellationCount))}</strong> · הצג דיווחים</button>`
    : '';
  const onlineReview = number(totals.unclassifiedOnlineCount) > 0
    ? `<button type="button" class="admin-attendance-totals__warning admin-attendance-totals__review-trigger" data-admin-attendance-review-kind="online" aria-expanded="false">${escapeHtml(String(totals.unclassifiedOnlineCount))} דיווחי זום ללא סוג פעילות – נדרש סיווג (${escapeHtml(duration(totals.unclassifiedOnlineHours))} שעות) · הצג דיווחים</button>`
    : '';
  return `<section class="admin-attendance-totals" data-admin-attendance-totals aria-label="סיכום דיווחי החודש">
    <h2>סיכום דיווחי ${escapeHtml(monthKey)}</h2>
    ${cards.length ? `<div class="admin-attendance-standalone__summary">${cards.join('')}</div>` : '<p class="admin-attendance-totals__empty">אין דיווחים לחודש זה</p>'}
    ${warning}
    ${onlineReview}
    <div class="admin-attendance-totals__review-list" data-admin-attendance-review-list hidden></div>
  </section>`;
}

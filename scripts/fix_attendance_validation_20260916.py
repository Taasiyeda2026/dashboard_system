from pathlib import Path

source_path = Path('frontend/src/screens/attendance-control.js')
source = source_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    assert count == 1, f'{label}: expected 1 match, found {count}'
    source = source.replace(old, new, 1)


replace_once(
    "      expenseDetails: txt(row.expensesDetails || row.ExpensesDetails), notes: txt(row.notes || row.Notes), activityId: '',\n",
    "      expenseDetails: txt(row.expensesDetails || row.ExpensesDetails), notes: txt(row.notes || row.Notes),\n      activityId: txt(row.activityRowId || row.activity_row_id || row.activityId || row.activityNumericId || row.activity_numeric_id),\n",
    'preserve activity linkage',
)

replace_once(
    "  if ((entry.differences || []).some((diff) => !diff.decided)) return true;\n",
    "  if ((entry.differences || []).some((diff) => diff.key !== 'kilometers' && !diff.decided)) return true;\n",
    'travel correction treats km as the travel field',
)

replace_once(
    """  const used = new Set(); const assignments = new Map(); const attendanceBuckets = new Map();
  comparableAttendance.forEach((attendance, attendanceIndex) => {
""",
    """  const used = new Set(); const assignments = new Map(); const attendanceBuckets = new Map();

  // Prefer the stable activity row id supplied by attendance. The dashboard date can differ
  // from the actual attendance date, so meeting number is used to disambiguate repetitions.
  comparableAttendance.forEach((attendance, attendanceIndex) => {
    const activityId = txt(attendance.activityId);
    if (!activityId) return;
    const candidates = dashboardPopulation.filter((row) => !row.__profile
      && !used.has(row)
      && txt(row.employeeId) === txt(attendance.employeeId)
      && txt(row.activityId) === activityId);
    if (!candidates.length) return;
    const sameDate = candidates.filter((row) => row.date === attendance.date);
    const expectedMeetings = parseMeetingNumberList(attendance.meetingNo);
    const meetingMatches = expectedMeetings.length
      ? candidates.filter((row) => expectedMeetings.some((meetingNo) => dashboardMeetingNumbers(row).includes(meetingNo)))
      : [];
    const pool = sameDate.length ? sameDate : (meetingMatches.length ? meetingMatches : candidates);
    if (pool.length !== 1) return;
    const candidate = pool[0];
    assignments.set(attendanceIndex, { bundle: candidate, componentRows: [candidate], score: 100, identity: 'activityId' });
    used.add(candidate);
  });

  comparableAttendance.forEach((attendance, attendanceIndex) => {
""",
    'cross-date stable activity matching',
)

replace_once(
    """      // Travel is audited once for the instructor's complete daily route, never per row.
      if (key === 'kilometers') return [];
      // An unusual school timetable has no invented payroll conversion.
""",
    """      // An unusual school timetable has no invented payroll conversion.
""",
    'remove day-level km suppression',
)

replace_once(
    """      const dashboardValue = key === 'workHours' ? rowWorkHours(dashboard) : type === 'activityType' ? activityTypeDisplayLabel(dashboard[key]) : dashboard[key];
      if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
""",
    """      const dashboardValue = key === 'workHours' ? rowWorkHours(dashboard) : type === 'activityType' ? activityTypeDisplayLabel(dashboard[key]) : dashboard[key];
      if (key === 'kilometers') {
        const attendanceKm = optionalNumber(attendanceValue);
        const dashboardKm = optionalNumber(dashboardValue);
        if (attendanceKm != null && dashboardKm != null && Math.abs(attendanceKm - dashboardKm) <= DAILY_KM_TOLERANCE) return [];
      }
      if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
""",
    'compare km per record with existing tolerance',
)

replace_once(
    """    const kmIssue = calculated == null ? Boolean(hasReportedKm) : (hasReportedKm !== false && !matches);
    dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: kmIssue ? null : 'auto_ok' });
""",
    """    // Legacy aggregate retained for diagnostics only. Kilometer approval is per record.
    dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok', legacyOnly: true });
""",
    'day km no longer blocks approval',
)

replace_once(
    """  const kmIssue = day.calculated == null ? Boolean(hasReportedKm) : (hasReportedKm !== false && !day.matches);
  day.managerResolved = kmIssue ? null : 'auto_ok';
""",
    """  day.managerResolved = 'auto_ok';
  day.legacyOnly = true;
""",
    'travel edit cannot reactivate day-level km approval',
)

replace_once(
    """    km: (result.dailyKilometers || []).reduce((total, day) => day.calculated == null ? total : total + Math.abs(day.reported - day.calculated), 0), expenses: sum('expenses')
""",
    """    km: sum('kilometers'), expenses: sum('expenses')
""",
    'audit km summary is record based',
)

old_report_km = """  const dayKmLineForReport = (employeeId, date) => {
    const km = dayKmInfo(employeeId, date);
    if (!km) return '';
    const reportedKm = km.hasReportedKm === false || (km.hasReportedKm !== true && optionalNumber(km.reported) == null)
      ? '—'
      : shown(km.reported ?? 0);
    const calculatedKm = km.calculated == null ? 'לא ניתן לחשב' : shown(km.calculated);
    const kmStatus = km.calculated == null ? 'לא ניתן לחשב ק״מ' : (km.matches ? 'תקין' : 'לבדיקה');
    const kmAction = kmDayNeedsDecision(km)
      ? ` <button type="button" class="ds-btn ds-btn--sm" data-km-approve-reported="${escapeHtml(txt(km.employeeId))}|${escapeHtml(km.date)}">אשר ק״מ כפי שדווח</button>`
      : (km.managerResolved === 'approved_as_reported' ? ' <span class="attendance-control__resolved-note">ק״מ אושר כמדווח</span>' : '');
    return `<div class="attendance-control__report-km">ק״מ ליום: ${reportedKm} מדווח | ${calculatedKm} מחושב | ${kmStatus}${kmAction}</div>`;
  };
"""
replace_once(old_report_km, "  const dayKmLineForReport = () => '';\n", 'remove repeated day km line')

replace_once(
    """      ['kilometers', 'קילומטרים', asBoolean(current.publicTransport) ? '0 (תחבורה ציבורית)' : current.kilometers, null]
""",
    """      ['kilometers', 'קילומטרים', asBoolean(current.publicTransport) ? '0 (תחבורה ציבורית)' : current.kilometers, dashboard?.kilometers]
""",
    'show calculated km on matching record',
)

replace_once(
    """      const km = dayKmInfo(employee.id, date);
      const issue = dayKmIssue(employee.id, date) || rows.some((entry) => {
        const item = entry.item;
        return !attendanceEntryIsResolved(item);
      });
      const reportedKm = !km || km.hasReportedKm === false || (km.hasReportedKm !== true && optionalNumber(km.reported) == null)
        ? '—'
        : shown(km.reported ?? 0);
      const calculatedKm = km?.calculated == null ? 'לא ניתן לחשב' : shown(km.calculated);
      const kmStatus = km?.calculated == null ? 'לא ניתן לחשב ק״מ' : (km.matches ? 'תקין' : 'לבדיקה');
      const kmLine = `<div class="attendance-control__day-km">ק״מ מדווח: ${reportedKm} | ק״מ מחושב: ${calculatedKm} | ${kmStatus}</div>`;
      return `<details class="attendance-control__day${issue ? '' : ' attendance-control__day--ok'}" data-payroll-date="${escapeHtml(date)}"><summary><span>${shown(dateLabel(date))}</span><span>${hours.toFixed(2)} שעות</span><span class="attendance-control__row-status ${issue ? 'attendance-control__row-status--issue' : ''}">${issue ? '⚠ לבדיקה' : '✓ תקין'}</span></summary>${kmLine}<div class="attendance-control__reports">${rows.map((row) => reportHtml({ ...row, employeeId: employee.id, date })).join('')}</div></details>`;
""",
    """      const issue = rows.some((entry) => {
        const item = entry.item;
        return !attendanceEntryIsResolved(item);
      });
      return `<details class="attendance-control__day${issue ? '' : ' attendance-control__day--ok'}" data-payroll-date="${escapeHtml(date)}"><summary><span>${shown(dateLabel(date))}</span><span>${hours.toFixed(2)} שעות</span><span class="attendance-control__row-status ${issue ? 'attendance-control__row-status--issue' : ''}">${issue ? '⚠ לבדיקה' : '✓ תקין'}</span></summary><div class="attendance-control__reports">${rows.map((row) => reportHtml({ ...row, employeeId: employee.id, date })).join('')}</div></details>`;
""",
    'day status derives from record decisions',
)

replace_once(
    """    return entries.some((entry) => !attendanceEntryIsResolved(entry))
      || [...employee.days.entries()].some(([date]) => dayKmIssue(employee.id, date))
      || (hasWorkflowRow && workflow.status === 'not_submitted');
""",
    """    return entries.some((entry) => !attendanceEntryIsResolved(entry))
      || (hasWorkflowRow && workflow.status === 'not_submitted');
""",
    'employee review ignores legacy day km',
)

source_path.write_text(source)

focused_test = Path('tests/attendance-validation-record-km.test.mjs')
focused_test.write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceEntryIsResolved,
  compareAttendanceRows,
  normalizeAttendanceApiRows,
  resultsHtml
} from '../frontend/src/screens/attendance-control.js';

test('attendance API preserves the stable activity row id used by the dashboard', () => {
  const [row] = normalizeAttendanceApiRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', attendanceDate: '2026-09-02',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    schoolName: 'מקיף אבו גוש', municipality: 'אבו גוש', programName: 'ביומימיקרי',
    sessionNumber: '1', kilometers: 95,
    activityRowId: 'ACT-df3ab86a-092a-41a5-907c-41f3ea67f1a0'
  }]);
  assert.equal(row.activityId, 'ACT-df3ab86a-092a-41a5-907c-41f3ea67f1a0');
});

test('stable activity id and meeting number match even when dashboard date differs', () => {
  const attendance = [{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    school: 'מקיף אבו גוש', authority: 'אבו גוש', program: 'ביומימיקרי', meetingNo: '1',
    kilometers: 95, activityId: 'ACT-1'
  }];
  const dashboard = [{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-01',
    startTime: '08:20', endTime: '10:10', workHours: 1.83, activityType: 'קורס',
    school: 'מקיף אבו גוש', authority: 'אבו גוש', program: 'ביומימיקרי', meetingNo: '1',
    kilometers: 80, activityId: 'ACT-1'
  }];
  const result = compareAttendanceRows(attendance, dashboard);
  const entry = result.comparisons[0];
  assert.equal(entry.unmatched, false);
  assert.equal(entry.dashboard.activityId, 'ACT-1');
  assert.ok(entry.differences.some((difference) => difference.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\\s\\S]*95[\\s\\S]*80[\\s\\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
});

test('kilometer tolerance is evaluated per matched record', () => {
  const base = {
    employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00',
    workHours: 1, activityType: 'סדנה', school: 'א', authority: 'א', program: 'א',
    meetingNo: '1', activityId: 'ACT-10'
  };
  const dashboard = [{ ...base, kilometers: 40 }];
  const within = compareAttendanceRows([{ ...base, kilometers: 45 }], dashboard);
  const outside = compareAttendanceRows([{ ...base, kilometers: 46 }], dashboard);
  assert.equal(within.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), false);
  assert.equal(outside.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), true);
});

test('generated travel-time cancellation still requires manager approval', () => {
  const result = compareAttendanceRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '06:30', endTime: '08:15', workHours: 1.75,
    activityType: 'ביטול זמן', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביטול זמן מחושב', kilometers: 0,
    _source: { generationKind: 'travel_time_cancellation' }
  }], []);
  assert.equal(result.notCompared.length, 1);
  assert.equal(attendanceEntryIsResolved(result.notCompared[0]), false);
  assert.match(resultsHtml(result), /ביטול זמן[\\s\\S]*⚠ לבדיקה/);
});
""")

legacy_tests = Path('tests/attendance-control.test.mjs')
tests = legacy_tests.read_text()
tests = tests.replace(
    "  assert.match(html, /ק״מ מדווח: 30[\\s\\S]*ק״מ מחושב: 24/, 'daily kilometers are compared at day level');\n",
    "  assert.doesNotMatch(html, /ק״מ מדווח:|ק״מ ליום/, 'kilometers are validated on each record, not on the day');\n",
)
tests = tests.replace(
    """  const within = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 45 }], dashboard);
  assert.equal(within.dailyKilometers[0].matches, true);
  assert.match(resultsHtml(within), /ק״מ מדווח: 45[\\s\\S]*ק״מ מחושב: 40[\\s\\S]*תקין/);
  const outside = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 46 }], dashboard);
  assert.equal(outside.dailyKilometers[0].matches, false);
  assert.match(resultsHtml(outside), /ק״מ מדווח: 46[\\s\\S]*ק״מ מחושב: 40[\\s\\S]*לבדיקה/);
""",
    """  const within = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 45 }], dashboard);
  assert.equal(within.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), false);
  const outside = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 46 }], dashboard);
  assert.equal(outside.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), true);
  assert.match(resultsHtml(outside), /קילומטרים[\\s\\S]*46[\\s\\S]*40[\\s\\S]*לבדיקה/);
""",
)
legacy_tests.write_text(tests)

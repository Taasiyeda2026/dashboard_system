from pathlib import Path

source_path = Path('frontend/src/screens/attendance-control.js')
source = source_path.read_text()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    assert count == 1, f'{label}: expected 1 match, found {count}'
    return text.replace(old, new, 1)


source = replace_once(
    source,
    "${unavailable ? 'לא נמצאה התאמה' : (right == null && ['publicTransport', 'publicTransportCost', 'kilometers'].includes(key) ? '—' : shown(right))}",
    "${unavailable ? 'לא נמצאה התאמה' : (key === 'kilometers' && right == null ? 'לא ניתן לחשב ק״מ' : (right == null && ['publicTransport', 'publicTransportCost'].includes(key) ? '—' : shown(right)))}",
    'km unavailable UI',
)

source = replace_once(
    source,
    """      if (key === 'kilometers') {
        const attendanceKm = optionalNumber(attendanceValue);
        const dashboardKm = optionalNumber(dashboardValue);
        if (attendanceKm != null && dashboardKm != null && Math.abs(attendanceKm - dashboardKm) <= DAILY_KM_TOLERANCE) return [];
      }
      if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
""",
    """      if (key === 'kilometers') {
        const attendanceKm = optionalNumber(attendanceValue);
        const dashboardKm = optionalNumber(dashboardValue);
        if (attendanceKm == null && dashboardKm == null) return [];
        if (attendanceKm != null && dashboardKm != null && Math.abs(attendanceKm - dashboardKm) <= DAILY_KM_TOLERANCE) return [];
      } else if (comparable(type, attendanceValue) === comparable(type, dashboardValue)) return [];
""",
    'km explicit mismatch semantics',
)

source = replace_once(
    source,
    "dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok', legacyOnly: true });",
    "dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok' });",
    'legacy daily km shape',
)
source = replace_once(
    source,
    """  day.managerResolved = 'auto_ok';
  day.legacyOnly = true;
""",
    """  day.managerResolved = 'auto_ok';
""",
    'travel refresh keeps daily km non-blocking',
)
source_path.write_text(source)

finish_path = Path('frontend/src/screens/payroll-control-finish.js')
finish = finish_path.read_text()
finish = replace_once(
    finish,
    """export function payrollEmployeeHasUnresolvedEntries(result, employeeId) {
  if (payrollEmployeeEntries(result, employeeId).some((entry) => !attendanceEntryIsResolved(entry))) return true;
  const id = txt(employeeId);
  return (result?.dailyKilometers || [])
    .filter((day) => txt(day.employeeId) === id)
    .some((day) => kmDayNeedsDecision(day));
}
""",
    """export function payrollEmployeeHasUnresolvedEntries(result, employeeId) {
  return payrollEmployeeEntries(result, employeeId).some((entry) => !attendanceEntryIsResolved(entry));
}
""",
    'approval gate uses record decisions only',
)
finish_path.write_text(finish)

test_path = Path('tests/attendance-control.test.mjs')
tests = test_path.read_text()

# Names now describe the record-level behavior; the main patch script already updates these assertions.
tests = replace_once(
    tests,
    "test('payroll view groups reports by work day and compares daily kilometers', () => {",
    "test('payroll view groups reports by work day and compares kilometers per record', () => {",
    'grouped report test name',
)
tests = replace_once(
    tests,
    "test('daily kilometers allow a 5 km tolerance', () => {",
    "test('record kilometers allow a 5 km tolerance', () => {",
    'km tolerance test name',
)

# Unmatched rows keep their reported km inside that record; there is no day-level km banner.
tests = replace_once(
    tests,
    "  assert.match(html, /ק״מ מדווח: 58[\\s\\S]*לא ניתן לחשב/);",
    "  assert.match(html, /<th>ק״מ<\\/th><td>58<\\/td>/);\n  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);",
    'unmatched record km assertion',
)

old_zero = """test('payroll view treats zero reported kilometers at day level', () => {
  const attendance = { employeeId: 'zero-km', employeeName: 'מדריך אפס ק״מ', date: '2027-01-04', startTime: '08:00', endTime: '09:00', workHours: 1, kilometers: 0, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: 24 };
  const html = resultsHtml({ comparisons: [{ id: 'zero-km', attendance, dashboard, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [dashboard], dailyKilometers: [{ employeeId: 'zero-km', date: '2027-01-04', reported: 0, calculated: 24, matches: false, hasReportedKm: true }] });
  assert.match(html, /ק״מ מדווח: 0[\\s\\S]*ק״מ מחושב: 24/);
  assert.match(html, /⚠ לבדיקה/);

  const matchingHtml = resultsHtml({ comparisons: [{ id: 'zero-km-match', attendance, dashboard: { ...dashboard, kilometers: 0 }, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [], dailyKilometers: [{ employeeId: 'zero-km', date: '2027-01-04', reported: 0, calculated: 0, matches: true }] });
  assert.match(matchingHtml, /attendance-control__day--ok/);
});"""
new_zero = """test('payroll view treats zero reported kilometers as a record-level value', () => {
  const attendance = { employeeId: 'zero-km', employeeName: 'מדריך אפס ק״מ', date: '2027-01-04', startTime: '08:00', endTime: '09:00', workHours: 1, kilometers: 0, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: 24 };
  const result = compareAttendanceRows([attendance], [dashboard]);
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\\s\\S]*0[\\s\\S]*24[\\s\\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);

  const matching = compareAttendanceRows([attendance], [{ ...dashboard, kilometers: 0 }]);
  assert.equal(matching.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), false);
});"""
tests = replace_once(tests, old_zero, new_zero, 'zero km record test')

old_unavailable_view = """test('payroll view marks unavailable daily kilometers for review', () => {
  const attendance = { employeeId: '78', employeeName: 'מדריך ק״מ', date: '2027-01-04', startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: null };
  const html = resultsHtml({ comparisons: [{ id: 'km-missing', attendance, dashboard, final: { ...attendance }, differences: [], unmatched: false }], notCompared: [], dashboardOnly: [], dashboardPopulation: [dashboard], dailyKilometers: [{ employeeId: '78', date: '2027-01-04', reported: 30, calculated: null, matches: false }] });
  assert.match(html, /ק״מ מדווח: 30[\\s\\S]*לא ניתן לחשב/);
});"""
new_unavailable_view = """test('payroll view marks unavailable record kilometers for review', () => {
  const attendance = { employeeId: '78', employeeName: 'מדריך ק״מ', date: '2027-01-04', startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: null };
  const result = compareAttendanceRows([attendance], [dashboard]);
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\\s\\S]*30[\\s\\S]*לא ניתן לחשב ק״מ[\\s\\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
});"""
tests = replace_once(tests, old_unavailable_view, new_unavailable_view, 'unavailable km view test')

old_unavailable_record = """test('unavailable daily kilometers stay visible and are not shown as zero', () => {
  const result = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 50 }],
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: null }]
  );
  assert.equal(result.dailyKilometers[0].calculated, null);
  const html = resultsHtml(result);
  assert.match(html, /ק״מ מדווח: 50[\\s\\S]*ק״מ מחושב: לא ניתן לחשב[\\s\\S]*לא ניתן לחשב ק״מ/);
  assert.doesNotMatch(html, /ק״מ מחושב: 0/);
});"""
new_unavailable_record = """test('unavailable record kilometers stay visible and are not shown as zero', () => {
  const result = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 50 }],
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: null }]
  );
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\\s\\S]*50[\\s\\S]*לא ניתן לחשב ק״מ[\\s\\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ מחושב:\\s*0|ק״מ ליום|ק״מ מדווח:/);
});"""
tests = replace_once(tests, old_unavailable_record, new_unavailable_record, 'unavailable km record test')

old_keys = "['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'expenses']"
new_keys = "['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'kilometers', 'expenses']"
tests = replace_once(tests, old_keys, new_keys, 'population difference keys')

tests = replace_once(
    tests,
    "test('daily route ignores Zoom and repeated locations and compares only the day total', () => {",
    "test('daily route diagnostic stays available while km validation is per record', () => {",
    'daily route test name',
)
tests = replace_once(
    tests,
    "  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), false);",
    "  assert.equal(result.comparisons[0].differences.some((difference) => difference.key === 'kilometers'), true);",
    'daily route per-record km assertion',
)

old_daily_gate = """test('daily km issue without decision blocks approval', async () => {
  const api = {
    attendanceControlUpdateRecord: async () => ({ success: true }),
    attendanceManagerApprovalArtifacts: async (p) => p,
    managerFinalizeAttendanceMonthReview: async (p) => p
  };
  const result = {
    month: '2026-05',
    comparisons: [{ ...changedComparison }],
    dailyKilometers: [{ employeeId: '10', date: '2026-05-10', reported: 30, calculated: 20, matches: false, hasReportedKm: true, managerResolved: null }]
  };
  await assert.rejects(
    () => approvePayrollControlEmployee({
      api, user: { full_name: 'מנהל' }, result, employeeId: '10', employeeName: 'דנה', confirmed: true,
      monthWorkflow: { workflowStatus: 'submitted', attendanceSubmissionStatus: 'submitted' }
    }),
    /רשומות נוכחות שלא קיבלו/
  );
});"""
new_daily_gate = """test('legacy daily km issue does not block approval; record decisions are authoritative', () => {
  const result = {
    month: '2026-05',
    comparisons: [],
    dailyKilometers: [{ employeeId: '10', date: '2026-05-10', reported: 30, calculated: 20, matches: false, hasReportedKm: true, managerResolved: null }]
  };
  assert.equal(payrollEmployeeHasUnresolvedEntries(result, '10'), false);
});"""
tests = replace_once(tests, old_daily_gate, new_daily_gate, 'daily km approval gate test')

test_path.write_text(tests)

parity_path = Path('tests/attendance-control-manager-admin-parity.test.mjs')
parity = parity_path.read_text()
old_assert = "  assert.equal(result.dailyKilometers[0].managerResolved, null);"
assert parity.count(old_assert) == 2, f'parity daily km assertions: expected 2 matches, found {parity.count(old_assert)}'
parity = parity.replace(old_assert, "  assert.equal(result.dailyKilometers[0].managerResolved, 'auto_ok');")
parity_path.write_text(parity)

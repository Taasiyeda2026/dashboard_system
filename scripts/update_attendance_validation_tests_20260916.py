from pathlib import Path
import re

source_path = Path('frontend/src/screens/attendance-control.js')
source = source_path.read_text()


def replace_source(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    assert count == 1, f'{label}: expected 1 match, found {count}'
    source = source.replace(old, new, 1)


# A missing calculated km value belongs to the individual record and must stay visible.
replace_source(
    "${unavailable ? 'לא נמצאה התאמה' : (right == null && ['publicTransport', 'publicTransportCost', 'kilometers'].includes(key) ? '—' : shown(right))}",
    "${unavailable ? 'לא נמצאה התאמה' : (key === 'kilometers' && right == null ? 'לא ניתן לחשב ק״מ' : (right == null && ['publicTransport', 'publicTransportCost'].includes(key) ? '—' : shown(right)))}",
    'km unavailable UI',
)

# Kilometer equality is decided explicitly. Do not fall through to the generic number
# comparator, because 0 and null have different meanings for travel validation.
replace_source(
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

# Keep the legacy daily aggregate only as non-blocking diagnostics. Do not add a new
# public shape/property that would affect unrelated route-calculation consumers.
replace_source(
    "dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok', legacyOnly: true });",
    "dailyKilometers.push({ employeeId, date, reported, calculated, matches, hasReportedKm, managerResolved: 'auto_ok' });",
    'legacy daily km shape',
)
replace_source(
    """  day.managerResolved = 'auto_ok';
  day.legacyOnly = true;
""",
    """  day.managerResolved = 'auto_ok';
""",
    'travel refresh keeps daily km non-blocking',
)

source_path.write_text(source)


def replace_test(text: str, name: str, replacement: str) -> str:
    pattern = rf"test\('{re.escape(name)}', \(\) => \{{.*?\n\}}\);(?=\n\ntest\(|\Z)"
    updated, count = re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)
    assert count == 1, f'{name}: expected 1 test block, found {count}'
    return updated


test_path = Path('tests/attendance-control.test.mjs')
tests = test_path.read_text()

tests = replace_test(
    tests,
    'payroll view groups reports by work day and compares daily kilometers',
    r"""test('payroll view groups reports by work day and compares kilometers per record', () => {
  const base = { employeeId: '77', employeeName: 'ברקת קטעי', date: '2027-01-03', activityType: 'קורס', school: 'בית ספר X', authority: 'רחובות' };
  const result = compareAttendanceRows([
    { ...base, startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, program: 'תוכנית א' },
    { ...base, startTime: '10:00', endTime: '11:00', workHours: 1, kilometers: 0, activityType: 'הכשרה', program: 'הכשרה' }
  ], [{ ...base, startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 24, program: 'תוכנית א' }]);
  const html = resultsHtml(result);
  assert.equal((html.match(/class=\"attendance-control__employee\"/g) || []).length, 1);
  assert.equal((html.match(/class=\"attendance-control__day\"/g) || []).length, 1, 'same-date reports share one day row');
  assert.ok(result.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), 'kilometers are compared on the matched record');
  assert.match(html, /קילומטרים[\s\S]*30[\s\S]*24[\s\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
  assert.match(html, /09:00–10:00[\s\S]*10:00–11:00/, 'reports are ordered by start time');
  assert.doesNotMatch(html, /נוכחות בלבד|נדרש אישור ידני/);
});""",
)

tests = replace_test(
    tests,
    'daily kilometers allow a 5 km tolerance',
    r"""test('record kilometers allow a 5 km tolerance', () => {
  const dashboard = [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: 40 }];
  const within = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 45 }], dashboard);
  assert.equal(within.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), false);
  const outside = compareAttendanceRows([{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 46 }], dashboard);
  assert.equal(outside.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), true);
  assert.match(resultsHtml(outside), /קילומטרים[\s\S]*46[\s\S]*40[\s\S]*לבדיקה/);
  assert.doesNotMatch(resultsHtml(outside), /ק״מ ליום|ק״מ מדווח:/);
});""",
)

tests = replace_test(
    tests,
    'unavailable daily kilometers stay visible and are not shown as zero',
    r"""test('unavailable record kilometers stay visible and are not shown as zero', () => {
  const result = compareAttendanceRows(
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'קורס', school: 'א', program: 'א', kilometers: 50 }],
    [{ employeeId: '10', date: '2026-05-10', startTime: '08:00', endTime: '09:00', activityType: 'course', school: 'א', program: 'א', kilometers: null }]
  );
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\s\S]*50[\s\S]*לא ניתן לחשב ק״מ[\s\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ מחושב:\s*0|ק״מ ליום|ק״מ מדווח:/);
});""",
)

tests = replace_test(
    tests,
    'unmatched attendance explicitly marks the missing dashboard source without false valid fields',
    r"""test('unmatched attendance explicitly marks the missing dashboard source without false valid fields', () => {
  const attendance = { employeeId: 'missing', employeeName: 'מדריכה', date: '2026-05-03', startTime: '10:00', endTime: '12:00', workHours: 2, kilometers: 58, activityType: 'קורס', program: 'ביומימיקרי', school: 'אילנות', authority: 'אשקלון', meetingNo: 7 };
  const result = compareAttendanceRows([attendance], []);
  const html = resultsHtml(result);
  assert.equal(attendanceEntryIsResolved(result.comparisons[0]), false);
  assert.match(html, /attendance-control__missing-match\">לא נמצאה פעילות תואמת בדשבורד<\/p>/);
  assert.match(html, /<th>ק״מ<\/th><td>58<\/td>/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
  assert.doesNotMatch(html, /לא נמצאה התאמה<\/td><td class=\"attendance-control__row-status \">תקין/);
  assert.match(html, /10:00–12:00 \| קורס/);
  assert.match(html, /ביומימיקרי \| אילנות \| אשקלון \| מפגש 7/);
});""",
)

tests = replace_test(
    tests,
    'payroll view treats zero reported kilometers at day level',
    r"""test('payroll view treats zero reported kilometers as a record-level value', () => {
  const attendance = { employeeId: 'zero-km', employeeName: 'מדריך אפס ק״מ', date: '2027-01-04', startTime: '08:00', endTime: '09:00', workHours: 1, kilometers: 0, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: 24 };
  const result = compareAttendanceRows([attendance], [dashboard]);
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\s\S]*0[\s\S]*24[\s\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);

  const matching = compareAttendanceRows([attendance], [{ ...dashboard, kilometers: 0 }]);
  assert.equal(matching.comparisons[0].differences.some((diff) => diff.key === 'kilometers'), false);
});""",
)

tests = replace_test(
    tests,
    'payroll view marks unavailable daily kilometers for review',
    r"""test('payroll view marks unavailable record kilometers for review', () => {
  const attendance = { employeeId: '78', employeeName: 'מדריך ק״מ', date: '2027-01-04', startTime: '09:00', endTime: '10:00', workHours: 1, kilometers: 30, activityType: 'קורס' };
  const dashboard = { ...attendance, kilometers: null };
  const result = compareAttendanceRows([attendance], [dashboard]);
  const entry = result.comparisons[0];
  assert.ok(entry.differences.some((diff) => diff.key === 'kilometers'));
  assert.equal(attendanceEntryIsResolved(entry), false);
  const html = resultsHtml(result);
  assert.match(html, /קילומטרים[\s\S]*30[\s\S]*לא ניתן לחשב ק״מ[\s\S]*לבדיקה/);
  assert.doesNotMatch(html, /ק״מ ליום|ק״מ מדווח:/);
});""",
)

old_keys = "['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'expenses']"
new_keys = "['startTime', 'endTime', 'workHours', 'program', 'meetingNo', 'kilometers', 'expenses']"
assert tests.count(old_keys) == 1, f'population difference keys: expected 1 match, found {tests.count(old_keys)}'
tests = tests.replace(old_keys, new_keys, 1)

test_path.write_text(tests)

# This parity test used to expect a day-level km approval to reopen after each travel edit.
# Day-level km is now diagnostics only; record-level manager resolution is authoritative.
parity_path = Path('tests/attendance-control-manager-admin-parity.test.mjs')
parity = parity_path.read_text()
old_assert = "  assert.equal(result.dailyKilometers[0].managerResolved, null);"
assert parity.count(old_assert) == 2, f'parity daily km assertions: expected 2 matches, found {parity.count(old_assert)}'
parity = parity.replace(old_assert, "  assert.equal(result.dailyKilometers[0].managerResolved, 'auto_ok');")
parity_path.write_text(parity)

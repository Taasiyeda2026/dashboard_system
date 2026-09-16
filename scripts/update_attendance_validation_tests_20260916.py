from pathlib import Path
import re

source_path = Path('frontend/src/screens/attendance-control.js')
source = source_path.read_text()
old = "${unavailable ? 'לא נמצאה התאמה' : (right == null && ['publicTransport', 'publicTransportCost', 'kilometers'].includes(key) ? '—' : shown(right))}"
new = "${unavailable ? 'לא נמצאה התאמה' : (key === 'kilometers' && right == null ? 'לא ניתן לחשב ק״מ' : (right == null && ['publicTransport', 'publicTransportCost'].includes(key) ? '—' : shown(right)))}"
assert source.count(old) == 1, f'km unavailable UI: expected 1 match, found {source.count(old)}'
source_path.write_text(source.replace(old, new, 1))

test_path = Path('tests/attendance-control.test.mjs')
tests = test_path.read_text()

def replace_test(name: str, replacement: str) -> None:
    global tests
    pattern = rf"test\('{re.escape(name)}', \(\) => \{{.*?\n\}}\);"
    tests, count = re.subn(pattern, replacement, tests, count=1, flags=re.S)
    assert count == 1, f'{name}: expected 1 test block, found {count}'

replace_test(
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

replace_test(
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

replace_test(
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

test_path.write_text(tests)

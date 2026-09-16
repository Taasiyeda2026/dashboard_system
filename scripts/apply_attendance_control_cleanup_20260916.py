from pathlib import Path

path = Path('frontend/src/screens/attendance-control.js')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    assert count == 1, f'{label}: expected exactly one match, found {count}'
    text = text.replace(old, new, 1)


replace_once(
"""      if (key === 'meetingNo' && meetingNumberListsEqual(parseMeetingNumberList(attendance.meetingNo), dashboardMeetingNumbers(dashboard))) return [];
      if (['school', 'authority', 'program'].includes(key) && payrollEntityFieldsEquivalent(""",
"""      if (key === 'meetingNo' && meetingNumberListsEqual(parseMeetingNumberList(attendance.meetingNo), dashboardMeetingNumbers(dashboard))) return [];
      // Attendance may carry a decorated display label (program + school + authority), while
      // the dashboard keeps the canonical program name. A stable activity id proves these
      // values belong to the same activity, so the display decoration is not a real mismatch.
      if (key === 'program' && hasActivityIdMatch(attendance, dashboard)) return [];
      if (['school', 'authority', 'program'].includes(key) && payrollEntityFieldsEquivalent(""",
'program identity comparison'
)

replace_once(
"""  const hasValue = (value) => value != null && txt(value) !== '';
  const dayKmMap = new Map""",
"""  const hasValue = (value) => value != null && txt(value) !== '';
  const hasMeaningfulValue = (value) => {
    if (!hasValue(value)) return false;
    if (typeof value === 'boolean') return value;
    const raw = txt(value);
    const numeric = Number(raw.replace(/[₪,\\s]/g, ''));
    if (Number.isFinite(numeric)) return numeric !== 0;
    return !['לא', 'false'].includes(raw.toLowerCase());
  };
  const dayKmMap = new Map""",
'meaningful value helper'
)

replace_once(
"""  const identityHtml = (row) => {
    const fields = [activityTypeDisplayLabel(row.activityType), row.program, row.school, row.authority, hasValue(row.meetingNo) ? `מפגש ${row.meetingNo}` : ''].filter(hasValue);
    return fields.length ? `<div class=\"attendance-control__identity\">${fields.map(shown).join(' | ')}</div>` : '';
  };""",
"""  const identityHtml = (row, { compactCancellation = false } = {}) => {
    const fields = compactCancellation
      ? [activityTypeDisplayLabel(row.activityType), row.program]
      : [activityTypeDisplayLabel(row.activityType), row.program, row.school, row.authority, hasValue(row.meetingNo) ? `מפגש ${row.meetingNo}` : ''];
    const visible = fields.filter(hasValue);
    return visible.length ? `<div class=\"attendance-control__identity\">${visible.map(shown).join(' | ')}</div>` : '';
  };""",
'compact cancellation identity'
)

replace_once(
"""    const fields = [
      ['שעות שכר', displayWorkHours(display)],
      ['ק״מ', asBoolean(display.publicTransport) ? '0 (תחבורה ציבורית)' : display.kilometers],
      ['תחבורה ציבורית', asBoolean(display.publicTransport) ? 'כן' : (hasValue(display.publicTransportCost) || hasValue(display.kilometers) ? 'לא' : '')],
      ['עלות תחבורה ציבורית', asBoolean(display.publicTransport) ? display.publicTransportCost : ''],
      ['הוצאות', display.expenses],
      ['פירוט הוצאה', display.expenseDetails], ['הערות', display.notes]
    ].filter(([, value]) => hasValue(value));""",
"""    const fields = autoCancellation ? [] : [
      ['שעות שכר', displayWorkHours(display)],
      ['ק״מ', asBoolean(display.publicTransport) ? '0 (תחבורה ציבורית)' : display.kilometers],
      ['תחבורה ציבורית', asBoolean(display.publicTransport) ? 'כן' : (hasValue(display.publicTransportCost) || hasValue(display.kilometers) ? 'לא' : '')],
      ['עלות תחבורה ציבורית', asBoolean(display.publicTransport) ? display.publicTransportCost : ''],
      ['הוצאות', display.expenses],
      ['פירוט הוצאה', display.expenseDetails], ['הערות', display.notes]
    ].filter(([label, value]) => {
      if (label === 'תחבורה ציבורית') return value === 'כן';
      if (['שעות שכר', 'ק״מ', 'עלות תחבורה ציבורית', 'הוצאות'].includes(label)) return hasMeaningfulValue(value);
      return hasValue(value);
    });""",
'manual zero-field filtering'
)

replace_once(
"""    return `${note}<table class=\"attendance-control__comparison-table attendance-control__manual-table\"><tbody>${fields.map(([label, value]) => `<tr><th>${label}</th><td>${shown(value)}</td></tr>`).join('')}</tbody></table>${attachmentsHtml(display)}`;""",
"""    const table = fields.length
      ? `<table class=\"attendance-control__comparison-table attendance-control__manual-table\"><tbody>${fields.map(([label, value]) => `<tr><th>${label}</th><td>${shown(value)}</td></tr>`).join('')}</tbody></table>`
      : '';
    return `${note}${table}${attachmentsHtml(display)}`;""",
'optional manual table'
)

replace_once(
"""    const rows = definitions.filter(([key, , left, right]) => ['workHours', 'activityType', 'activityHours', 'publicTransport', 'publicTransportCost', 'kilometers'].includes(key) || hasValue(left) || hasValue(right)).map(([key, label, left, right]) => {""",
"""    const rows = definitions.filter(([key, , left, right]) => {
      const related = key === 'activityHours'
        ? ['startTime', 'endTime'].map((field) => diffByKey.get(field)).find(Boolean)
        : diffByKey.get(key);
      if (related || (key === 'workHours' && payrollReview) || (key === 'expenses' && hasReviewExpense(attendance))) return true;
      if (['workHours', 'activityType', 'activityHours'].includes(key)) return true;
      if (key === 'publicTransport') return asBoolean(current.publicTransport);
      if (key === 'publicTransportCost') return asBoolean(current.publicTransport) && hasMeaningfulValue(current.publicTransportCost);
      return hasMeaningfulValue(left) || hasMeaningfulValue(right);
    }).map(([key, label, left, right]) => {""",
'comparison zero-field filtering'
)

replace_once(
"""    const table = kind === 'comparison'
      ? (item.unmatched ? `${managerActionsHtml(item)}${manualReportTable(row, { entry: item })}` : comparisonTable(item))
      : `${managerActionsHtml(item)}${manualReportTable(row, { cancellation: isAttendanceOnlyActivityType(row.activityType), entry: item })}`;
    const missingMatch = kind === 'comparison' && item.unmatched ? '<p class=\"attendance-control__missing-match\">לא נמצאה פעילות תואמת בדשבורד</p>' : '';
    const manualStatus = kind === 'attendance' && issue ? '<span class=\"attendance-control__row-status attendance-control__row-status--issue\">⚠ לבדיקה</span>' : '';
    return `<section class=\"attendance-control__report\"><div class=\"attendance-control__report-line\"><strong>${shown(`${row.startTime || '—'}–${row.endTime || '—'} | ${activityTypeDisplayLabel(row.activityType) || 'דיווח'}`)}</strong>${timelineStatus}${manualStatus}</div>${identityHtml(row)}${dayKmLineForReport(employeeId, date)}${missingMatch}${table}</section>`;""",
"""    const cancellationEntry = isAttendanceTravelTimeCancellation(item)
      || normalizeAttendanceName(row.activityType).includes('ביטולזמן');
    const table = kind === 'comparison'
      ? (item.unmatched ? `${managerActionsHtml(item)}${manualReportTable(row, { entry: item })}` : comparisonTable(item))
      : `${managerActionsHtml(item)}${manualReportTable(row, { cancellation: isAttendanceOnlyActivityType(row.activityType), entry: item })}`;
    const missingMatch = kind === 'comparison' && item.unmatched ? '<p class=\"attendance-control__missing-match\">לא נמצאה פעילות תואמת בדשבורד</p>' : '';
    const manualStatus = kind === 'attendance' && issue ? '<span class=\"attendance-control__row-status attendance-control__row-status--issue\">⚠ לבדיקה</span>' : '';
    return `<section class=\"attendance-control__report\"><div class=\"attendance-control__report-line\"><strong>${shown(`${row.startTime || '—'}–${row.endTime || '—'} | ${activityTypeDisplayLabel(row.activityType) || 'דיווח'}`)}</strong>${timelineStatus}${manualStatus}</div>${identityHtml(row, { compactCancellation: cancellationEntry })}${dayKmLineForReport(employeeId, date)}${missingMatch}${table}</section>`;""",
'compact cancellation report identity'
)

path.write_text(text, encoding='utf-8')

# Extend focused regression coverage.
test_path = Path('tests/attendance-validation-record-km.test.mjs')
tests = test_path.read_text(encoding='utf-8')
append = r'''

test('decorated attendance program label is not a mismatch when stable activity id matches', () => {
  const attendance = [{
    employeeId: '1503', date: '2026-09-02', startTime: '08:20', endTime: '10:10',
    workHours: 1.83, activityType: 'קורס', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביומימיקרי — מקיף אבו גוש — אבו גוש', meetingNo: '1', kilometers: 95, activityId: 'ACT-1'
  }];
  const dashboard = [{
    employeeId: '1503', date: '2026-09-01', startTime: '08:20', endTime: '10:10',
    workHours: 1.83, activityType: 'קורס', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביומימיקרי', meetingNo: '1', kilometers: 95, activityId: 'ACT-1'
  }];
  const entry = compareAttendanceRows(attendance, dashboard).comparisons[0];
  assert.equal(entry.differences.some((difference) => difference.key === 'program'), false);
});

test('comparison UI hides empty zero-value rows but keeps real kilometer differences', () => {
  const base = {
    employeeId: '10', employeeName: 'מדריך', date: '2026-09-02', startTime: '08:00', endTime: '09:00',
    workHours: 1, activityType: 'קורס', school: 'בית ספר', authority: 'רשות', program: 'תכנית',
    meetingNo: '1', activityId: 'ACT-10', publicTransport: false, publicTransportCost: 0, expenses: 0
  };
  const result = compareAttendanceRows([{ ...base, kilometers: 95 }], [{ ...base, kilometers: 120 }]);
  const html = resultsHtml(result);
  assert.doesNotMatch(html, /<th>הוצאות<\/th>/);
  assert.doesNotMatch(html, /<th>תחבורה ציבורית<\/th>/);
  assert.doesNotMatch(html, /<th>עלות תחבורה ציבורית<\/th>/);
  assert.match(html, /<th>קילומטרים<\/th>[\s\S]*95[\s\S]*120/);
});

test('generated cancellation review is compact and does not show irrelevant zero travel or expense fields', () => {
  const result = compareAttendanceRows([{
    employeeId: '1503', employeeName: 'הנאא אבו אמנה', date: '2026-09-02',
    startTime: '06:30', endTime: '08:15', workHours: 1.75,
    activityType: 'ביטול זמן', school: 'מקיף אבו גוש', authority: 'אבו גוש',
    program: 'ביטול זמן מחושב', kilometers: 0, publicTransport: false, publicTransportCost: 0,
    expenses: 0,
    _source: { generationKind: 'travel_time_cancellation', finalCancellationMinutes: 105 }
  }], []);
  const html = resultsHtml(result);
  assert.match(html, /ביטול זמן: 1:45/);
  assert.match(html, /אשר כפי שדווח/);
  assert.doesNotMatch(html, /<th>ק״מ<\/th>/);
  assert.doesNotMatch(html, /<th>תחבורה ציבורית<\/th>/);
  assert.doesNotMatch(html, /<th>הוצאות<\/th>/);
  assert.doesNotMatch(html, /מקיף אבו גוש \| אבו גוש/);
});
'''
assert "decorated attendance program label is not a mismatch" not in tests
test_path.write_text(tests.rstrip() + append + '\n', encoding='utf-8')

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const homeSource    = await readFile(new URL('../attendance/src/screens/home-screen.js',    import.meta.url), 'utf8');
const homeStyles    = await readFile(new URL('../attendance/src/styles/home-screen.css',    import.meta.url), 'utf8');
const desktopAppThemeStyles = await readFile(new URL('../attendance/src/styles/desktop-app-theme.css', import.meta.url), 'utf8');
const reportsSource = await readFile(new URL('../attendance/src/screens/my-reports-screen.js', import.meta.url), 'utf8');
const newReportSource = await readFile(new URL('../attendance/src/screens/new-report-screen.js', import.meta.url), 'utf8');
const newReportStyles = await readFile(new URL('../attendance/src/styles/new-report-screen.css', import.meta.url), 'utf8');
const newReportLayoutFix = await readFile(new URL('../attendance/src/styles/new-report-layout-fix.css', import.meta.url), 'utf8');
const reportsStyles = await readFile(new URL('../attendance/src/styles/my-reports-screen.css', import.meta.url), 'utf8');
const attendanceFollowupStyles = await readFile(new URL('../attendance/src/styles/attendance-followup.css', import.meta.url), 'utf8');
const reportTableFitStyles = await readFile(new URL('../attendance/src/styles/report-table-fit-fix.css', import.meta.url), 'utf8');
const attendanceFollowupRuntime = await readFile(new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url), 'utf8');
const timePickerSource = await readFile(new URL('../attendance/src/components/time-picker.js', import.meta.url), 'utf8');
const activitiesServiceSource = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const attendanceSwSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const attendanceIndexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const calSource     = await readFile(new URL('../attendance/src/components/mini-calendar.js', import.meta.url), 'utf8');

test('Attendance Home is summary-only with instructor monthly totals and no report rows', () => {
  assert.doesNotMatch(homeSource, /createMiniCalendar|av2-home__calendar|renderCalendarSection/);
  assert.doesNotMatch(homeSource, /createReportDaySummaryRow|groupReportRecordsByDate|av2-home__report-list|אין כרגע דיווחים בחודש זה/);
  assert.match(homeSource, /buildHomeSummaryStats\(records\)/);
  for (const label of [
    'סה״כ קורס','סה״כ סדנה','סה״כ הכשרות','סה״כ תפעול','סה״כ ביטול זמן',
    'סה״כ קילומטר','סה״כ הוצאות','סה״כ סיור','סה״כ ימי עבודה'
  ]) {
    assert.match(homeSource, new RegExp(label));
  }
  assert.match(homeSource, /heading\.textContent = 'הדיווחים שלי'/);
  assert.match(homeSource, /viewLink\.textContent = 'לכל הדיווחים ←'/);
  assert.match(homeSource, /xlLabel\.textContent = 'Excel'/);
  assert.match(homeSource, /'סיום ואישור'/);
  assert.doesNotMatch(homeSource, /newReportLabel\.textContent = 'הוספת דיווח'/);
  assert.match(homeSource, /av2-home__status-area/);
  assert.match(homeSource, /av2-home__action-strip/);
  assert.doesNotMatch(homeStyles, /av2-home__calendar|av2-cal--home/);
  assert.match(homeStyles, /av2-stats-grid/);
});

test('Attendance My Reports owns the calendar above the report list', () => {
  const calendarIndex    = reportsSource.indexOf('av2-reports__calendar-wrap');
  const reportListIndex  = reportsSource.indexOf('av2-report-list');
  assert.notEqual(calendarIndex,   -1, 'calendar-wrap class missing');
  assert.notEqual(reportListIndex, -1, 'report-list class missing');
  assert.ok(calendarIndex < reportListIndex, 'calendar must render before the reports table');
});

test('Attendance My Reports table has all required columns', () => {
  // All 11 column cells present as class names
  for (const cls of ['av2-rr__date','av2-rr__start','av2-rr__end','av2-rr__hours',
                      'av2-rr__type','av2-rr__name','av2-rr__school','av2-rr__authority',
                      'av2-rr__km','av2-rr__expenses','av2-rr__actions']) {
    assert.match(reportsSource, new RegExp(cls), `missing column class ${cls}`);
  }
  // Records sorted date DESC
  assert.match(reportsSource, /report_date.*localeCompare|localeCompare.*report_date/);
  // Action colour classes
  assert.match(reportsSource, /av2-rr__action-copy/);
  assert.match(reportsSource, /av2-rr__action-dup/);
  assert.match(reportsSource, /av2-rr__action-delete/);
});

test('Attendance calendar day click opens the unified day drawer instead of filtering report rows', () => {
  assert.match(reportsSource, /openAttendanceCalendarDay/);
  assert.match(reportsSource, /loadAttendanceCalendarContext/);
  assert.match(reportsSource, /onDayClick:\s*\(dateStr, dayEvents\)/);
  assert.doesNotMatch(reportsSource, /rowEntries\.push|row\.hidden = selectedDate/);
});

test('Attendance report actions and expenses use distinct accessible indicators', () => {
  assert.match(reportsSource, /aria-label', 'העתק פרטי דיווח'/);
  assert.match(reportsSource, /aria-label', 'שכפל דיווח'/);
  assert.match(reportsSource, /createIcon\('copy'/);
  assert.match(reportsSource, /createIcon\('duplicate'/);
  assert.match(reportsSource, /createIcon\('receipt'/);
  assert.match(reportsSource, /if \(expenseAmount > 0\)/);
  assert.match(reportsSource, /classList\.toggle\('is-revealed'\)/);
});

test('shared Attendance time picker uses compact numeric placeholders and supports automatic values', () => {
  assert.doesNotMatch(timePickerSource, /placeholder: 'שע׳'|placeholder: 'דק׳'/);
  assert.match(timePickerSource, /placeholder: '--'/);
  assert.match(timePickerSource, /function setValue\(value = ''\)/);
  assert.match(timePickerSource, /setValue,\s*\n\s*clearValue/);
  assert.match(newReportStyles, /\.av2-time-picker__part\s*\{[^}]*width:\s*64px/);
  assert.match(newReportStyles, /\.av2-time-picker__sep\s*\{[^}]*justify-content:\s*center/);
});

test('Attendance calendar shows TODAY highlight plus separate activity and attendance indicators', () => {
  assert.match(calSource, /av2-cal__cell--today/);
  assert.match(calSource, /av2-cal__activity-dot/);
  assert.match(calSource, /av2-cal__attendance-dot/);
  assert.match(calSource, /aria-current', 'date'/);
  assert.match(calSource, /attendanceCalendarEventsForDate/);
});

test('Attendance New Report uses two compact desktop cards and instructor activity IDs', () => {
  assert.match(newReportStyles, /\.av2-report__form\s*\{/);
  assert.match(newReportLayoutFix, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*255px\)\)/);
  assert.match(newReportLayoutFix, /gap:\s*14px 30px/);
  assert.match(newReportLayoutFix, /max-width:\s*221px/);
  assert.match(newReportStyles, /\.av2-form-section__body--times/);
  assert.doesNotMatch(newReportLayoutFix, /av2-planned-activity/);
  assert.match(newReportSource, /deriveAuthoritySchoolListFromActivities/);
  assert.match(newReportSource, /getInstructorActivities/);
  assert.doesNotMatch(newReportSource, /getInstructorActivitiesForDate/);
  assert.match(newReportSource, /ONLINE_REPORT_TYPE/);
  assert.match(newReportSource, /syncKmForReportType/);
  assert.match(newReportSource, /getAllAuthoritySchoolList/);
  assert.doesNotMatch(newReportSource, /getActivityNamesByType/);
  assert.doesNotMatch(newReportSource, /av2-planned-activity/);
  assert.match(newReportSource, /instructorActivitySelectOptions/);
  assert.match(activitiesServiceSource, /instructorActivitySelectOptions/);
  assert.match(newReportSource, /תחבורה ציבורית/);
  assert.match(newReportSource, /public_transport_cost/);
  assert.match(attendanceSwSource, /const CACHE_VERSION = 85;/);
  assert.match(attendanceIndexSource, /\?v=85/);
});

test('Attendance New Report keeps mobile fields inside padded page gutters', () => {
  assert.match(newReportLayoutFix, /@media \(max-width: 639px\)/);
  assert.match(newReportLayoutFix, /\.av2-report__inner\s*\{[\s\S]*padding-inline:\s*20px\s*!important/);
  assert.match(newReportLayoutFix, /\.av2-field__input,[\s\S]*width:\s*100%/);
  assert.match(newReportLayoutFix, /min-width:\s*0/);
  assert.match(newReportLayoutFix, /max-width:\s*100%/);
});

test('Attendance New Report cancel resets the form in place instead of navigating away', () => {
  const cancelStart = newReportSource.indexOf("cancelBtn.addEventListener('click'");
  assert.notEqual(cancelStart, -1, 'cancel handler missing');
  const cancelBlock = newReportSource.slice(cancelStart, cancelStart + 420);
  assert.match(cancelBlock, /buildForm\(null, defaultDate\)/);
  assert.match(cancelBlock, /successBanner\.hidden = true/);
  assert.match(cancelBlock, /lockBanner\.hidden = true/);
  assert.doesNotMatch(cancelBlock, /onBack/);
});

test('Attendance monthly summary uses current instructor month records and hides zero totals', () => {
  assert.match(homeSource, /const sourceRows = sourceAttendanceRecords\(rows\)/);
  assert.match(homeSource, /hoursForType\(sourceRows, 'קורס'\)/);
  assert.match(homeSource, /hoursForType\(sourceRows, 'סדנה'\)/);
  assert.match(homeSource, /cancellationHours\(rows\)/);
  assert.match(homeSource, /distinctAttendanceWorkDays\(sourceRows\)/);
  assert.match(homeSource, /\.filter\(\(item\) => Number\(item\.numericValue\) > 0\)/);
  assert.match(homeSource, /statsEl\.hidden = homeStats\.length === 0/);
  assert.doesNotMatch(reportsSource, /DAY_NAMES_SHORT|dateDay|dayName/);
  assert.match(newReportSource, /activity\?\.activity_name \|\| activity\?\.program_name/);
  assert.doesNotMatch(newReportSource, /activityNameSnapshot = activityNameSel\.getLabel/);
  assert.match(newReportSource, /attrs: \{ max: localIsoDate\(\) \}/);
  assert.match(newReportSource, /buildForm\(null, reportDate\)/);
});

test('Attendance travel modes clear the inactive reimbursement value', () => {
  assert.match(newReportSource, /kmField\.input\.value = '0'/);
  assert.match(newReportSource, /publicTransportCostField\.input\.value = ''/);
  assert.match(newReportSource, /public_transport: usesPublicTransport/);
  assert.match(newReportSource, /roundtrip_km: kmValue/);
});

test('Attendance New Report enforces dependent location choices and course-only meeting numbers', () => {
  assert.match(newReportSource, /const courseAwaitingActivity = isCourseReportType\(\) && !selectedActivity/);
  assert.match(newReportSource, /authSel\?\.setDisabled\(!hasType \|\| !showsLocation \|\| courseAwaitingActivity \|\| !!selectedActivity\)/);
  assert.match(newReportSource, /setSchoolEnabled\(hasType && showsLocation && !courseAwaitingActivity && hasSelectedAuthority\(\)\)/);
  assert.match(newReportSource, /formatTravelMinutes\(Math\.round\(h \* 60\)\)/);
  assert.match(newReportSource, /meetingWrap\.hidden = !course/);
  assert.match(newReportSource, /meetingField\.select\.disabled = !course \|\| !hasSelectedAuthority\(\) \|\| !hasSelectedSchool\(\)/);
  assert.match(newReportSource, /manualSchoolId = null;[\s\S]*clearMeetingSelection\(\)/);
  assert.match(newReportSource, /meeting_no: isCourseReportType\(reportType\)/);
  assert.match(reportsSource, /meeting_no:\s+isCourse && meetField\.input\.value/);
});

test('Attendance reports table keeps the required 13-column grid including time cancellation', () => {
  const widths = ['70px','63px','63px','65px','63px','65px','63px','245px','210px','198px','55px','55px','125px'];
  for (const width of widths) {
    assert.match(attendanceFollowupStyles, new RegExp(width.replace('.', '\\.')));
    assert.match(reportTableFitStyles, new RegExp(width.replace('.', '\\.')));
  }
  assert.match(attendanceFollowupRuntime, /cancel\.textContent = 'ביטול זמן'/);
  assert.match(attendanceFollowupRuntime, /hours\.insertAdjacentElement\('afterend', cancel\)/);
  assert.match(attendanceFollowupRuntime, /cell\.className = 'av2-rr__time-cancel'/);
  assert.match(attendanceFollowupRuntime, /hours\.insertAdjacentElement\('afterend', cell\)/);
});


test('Attendance Home desktop summary cards are exactly half width and centered', () => {
  assert.match(desktopAppThemeStyles, /display:\s*flex\s*!important/);
  assert.match(desktopAppThemeStyles, /justify-content:\s*center\s*!important/);
  assert.match(desktopAppThemeStyles, /max-width:\s*440px\s*!important/);
  assert.match(desktopAppThemeStyles, /flex:\s*0 0 133\.333px\s*!important/);
  assert.match(desktopAppThemeStyles, /width:\s*133\.333px\s*!important/);
  assert.match(desktopAppThemeStyles, /min-width:\s*133\.333px\s*!important/);
  assert.match(desktopAppThemeStyles, /max-width:\s*133\.333px\s*!important/);
});

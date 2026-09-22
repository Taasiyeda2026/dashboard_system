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
const newReportAccessibilityStyles = await readFile(new URL('../attendance/src/styles/new-report-accessibility.css', import.meta.url), 'utf8');
const reportsStyles = await readFile(new URL('../attendance/src/styles/my-reports-screen.css', import.meta.url), 'utf8');
const attendanceFollowupStyles = await readFile(new URL('../attendance/src/styles/attendance-followup.css', import.meta.url), 'utf8');
const reportTableFitStyles = await readFile(new URL('../attendance/src/styles/report-table-fit-fix.css', import.meta.url), 'utf8');
const attendanceFollowupRuntime = await readFile(new URL('../attendance/src/attendance-followup-runtime-v2.js', import.meta.url), 'utf8');
const timePickerSource = await readFile(new URL('../attendance/src/components/time-picker.js', import.meta.url), 'utf8');
const activitiesServiceSource = await readFile(new URL('../attendance/src/services/activities.service.js', import.meta.url), 'utf8');
const attendanceServiceSource = await readFile(new URL('../attendance/src/services/attendance.service.js', import.meta.url), 'utf8');
const duplicateCourseSource = await readFile(new URL('../attendance/src/duplicate-course-runtime.js', import.meta.url), 'utf8');
const dashboardAlignmentMigration = await readFile(new URL('../supabase/migrations/20260921205240_attendance_dashboard_alignment_validation.sql', import.meta.url), 'utf8');
const attendanceSwSource = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
const attendanceIndexSource = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
const calSource     = await readFile(new URL('../attendance/src/components/mini-calendar.js', import.meta.url), 'utf8');
const calendarDayDrawerSource = await readFile(new URL('../attendance/src/components/calendar-day-drawer.js', import.meta.url), 'utf8');
const excelServiceSource = await readFile(new URL('../attendance/src/services/excel.service.js', import.meta.url), 'utf8');

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
  assert.match(homeSource, /viewLabel\.textContent = 'לכל הדיווחים'/);
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

test('Attendance calendar drawer uses clean inline facts and blue-teal styling', () => {
  assert.match(calendarDayDrawerSource, /function formatClock\(value\)/);
  assert.match(calendarDayDrawerSource, /function makeInlineFact\(label, value/);
  assert.match(calendarDayDrawerSource, /av2-calendar-day__attendance-meta/);
  assert.match(calendarDayDrawerSource, /av2-calendar-day__attendance-location/);
  assert.match(calendarDayDrawerSource, /av2-calendar-day__time-strip/);
  assert.match(calendarDayDrawerSource, /makeMeta\('התחלה', startTime/);
  assert.match(calendarDayDrawerSource, /makeMeta\('סיום', endTime/);
  assert.match(calendarDayDrawerSource, /makeMeta\('סה״כ', formatDurationHours\(totalHours\)/);
  assert.match(calendarDayDrawerSource, /av2-calendar-day__attendance-extras/);
  assert.doesNotMatch(calendarDayDrawerSource, /av2-calendar-day__attendance-grid--core/);
  assert.match(reportsStyles, /\.av2-calendar-day__section\.is-attendance\s*\{[\s\S]*border:\s*0[\s\S]*background:\s*transparent/);
  assert.match(reportsStyles, /\.av2-calendar-day__attendance\s*\{[\s\S]*border-inline-start:\s*3px solid #0f9f96/);
  assert.match(reportsStyles, /\.av2-calendar-day__time-item\.is-total\s*\{[\s\S]*background:\s*#eef6ff/);
  assert.doesNotMatch(reportsStyles, /#e07a2f|#b86428|#9a4f18|rgba\(224,122,47/);
});

test('Attendance Excel export uses real time values and a correctly structured total row', () => {
  assert.match(excelServiceSource, /const excelClock = \(value\) =>/);
  assert.match(excelServiceSource, /const excelDuration = \(value\) => Math\.max\(0, Number\(value\) \|\| 0\) \/ 24/);
  assert.match(excelServiceSource, /'התחלה':\s+excelClock\(r\.start_time\)/);
  assert.match(excelServiceSource, /'סיום':\s+excelClock\(r\.end_time\)/);
  assert.match(excelServiceSource, /'שעות':\s+excelDuration\(r\.total_hours\)/);
  assert.match(excelServiceSource, /applyNumberFormat\(XLSX, ws1, 4,[\s\S]*'\[h\]:mm'\)/);
  assert.match(excelServiceSource, /'סוג פעילות': 'סה"כ'/);
  assert.match(excelServiceSource, /'ק"מ': totalKm/);
  assert.match(excelServiceSource, /'הוצאות \(₪\)': totalExpenses/);
  assert.match(excelServiceSource, /header: \['סוג פעילות', 'מפגשים', 'שעות', 'ק"מ', 'הוצאות \(₪\)'\]/);
  assert.doesNotMatch(excelServiceSource, /'סוג פעילות': 'סה"כ ק"מ'[\s\S]*'שעות':/);
  assert.doesNotMatch(excelServiceSource, /Number\(totalHours\.toFixed\(2\)\)/);
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
  assert.match(attendanceSwSource, /const CACHE_VERSION = 92;/);
  assert.match(attendanceIndexSource, /\?v=92/);
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

test('Attendance reports table keeps the required no-scroll 13-column grid including time cancellation', () => {
  const widths = ['61px','60px','60px','60px','61px','61px','60px','100px','95px','90px','55px','55px','100px'];
  for (const width of widths) {
    assert.match(attendanceFollowupStyles, new RegExp(width.replace('.', '\\.')));
    assert.match(reportTableFitStyles, new RegExp(width.replace('.', '\\.')));
  }
  assert.match(reportTableFitStyles, /918px/);
  assert.match(reportTableFitStyles, /overflow-x:\s*hidden/);
  assert.doesNotMatch(reportTableFitStyles, /overflow-x:\s*auto/);
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


test('Attendance My Reports monthly summary cards are compact and centered', () => {
  assert.match(reportsStyles, /\.av2-reports__summary-grid\s*\{[\s\S]*max-width:\s*620px/);
  assert.match(reportsStyles, /justify-content:\s*center/);
  assert.match(reportsStyles, /gap:\s*16px/);
  assert.match(reportsStyles, /\.av2-reports__summary-card\s*\{[\s\S]*flex:\s*0 0 300px/);
  assert.match(reportsStyles, /width:\s*300px/);
  assert.match(reportsStyles, /min-width:\s*300px/);
  assert.match(reportsStyles, /max-width:\s*300px/);
});


test('Attendance calendar desktop rows have a fixed compact height', () => {
  assert.match(reportsStyles, /\.av2-cal__grid\s*\{[\s\S]*grid-auto-rows:\s*54px/);
  assert.match(reportsStyles, /\.av2-cal__cell\s*\{[\s\S]*height:\s*54px[\s\S]*min-height:\s*54px[\s\S]*max-height:\s*54px/);
  assert.match(reportsStyles, /@media \(max-width: 767px\)[\s\S]*\.av2-cal__cell\s*\{[\s\S]*height:\s*44px/);
});


function relativeLuminance(hex) {
  const channels = hex.replace('#', '').match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('New Report accessibility layer is scoped, color-only and loaded last', () => {
  assert.doesNotMatch(newReportAccessibilityStyles, /:root\s*\{/);
  assert.match(newReportAccessibilityStyles, /\.av2-report\s*\{/);
  assert.match(newReportAccessibilityStyles, /#374151/i);
  assert.match(newReportAccessibilityStyles, /#5F6B7A/i);
  assert.match(newReportAccessibilityStyles, /#667085/i);
  assert.match(newReportAccessibilityStyles, /#C5D2E1/i);
  assert.match(newReportAccessibilityStyles, /#F4F7FA/i);
  assert.match(newReportAccessibilityStyles, /#7A8797/i);
  assert.match(newReportAccessibilityStyles, /#2563EB/i);
  assert.doesNotMatch(newReportAccessibilityStyles, /(?:^|[;{]\s*)(?:width|height|min-width|max-width|min-height|max-height|padding|margin|gap|border-radius|font-size|font-family|grid-template-columns|display|position)\s*:/m);

  const fitIndex = attendanceIndexSource.indexOf('report-table-fit-fix.css?v=92');
  const accessibilityIndex = attendanceIndexSource.indexOf('new-report-accessibility.css?v=92');
  assert.notEqual(fitIndex, -1);
  assert.notEqual(accessibilityIndex, -1);
  assert.ok(accessibilityIndex > fitIndex, 'New Report accessibility CSS must load last');
});

test('New Report required text colors meet WCAG AA contrast on white', () => {
  assert.ok(contrastRatio('#374151', '#FFFFFF') >= 4.5);
  assert.ok(contrastRatio('#5F6B7A', '#FFFFFF') >= 4.5);
  assert.ok(contrastRatio('#667085', '#FFFFFF') >= 4.5);
  assert.ok(contrastRatio('#FFFFFF', '#2563EB') >= 4.5);
  assert.ok(contrastRatio('#475569', '#FFFFFF') >= 4.5);
});

test('New Report accessibility covers fields, placeholders, disabled, focus and actions', () => {
  assert.match(newReportAccessibilityStyles, /::placeholder[\s\S]*var\(--av2-new-report-placeholder\)/);
  assert.match(newReportAccessibilityStyles, /\.av2-field__input:disabled[\s\S]*var\(--av2-new-report-disabled-bg\)/);
  assert.match(newReportAccessibilityStyles, /\.av2-ssel__trigger:disabled[\s\S]*opacity:\s*1/);
  assert.match(newReportAccessibilityStyles, /\.av2-ssel__chevron[\s\S]*border-top-color:\s*var\(--av2-new-report-secondary\)/);
  assert.match(newReportAccessibilityStyles, /\.av2-time-picker:focus-within[\s\S]*border-color:\s*var\(--av2-new-report-primary\)/);
  assert.match(newReportAccessibilityStyles, /\.av2-report__save[\s\S]*background:\s*var\(--av2-new-report-primary\)/);
  assert.match(newReportAccessibilityStyles, /\.av2-report__cancel[\s\S]*background:\s*#FFFFFF[\s\S]*var\(--av2-new-report-cancel-text\)[\s\S]*var\(--av2-new-report-cancel-border\)/);
});


test('Attendance Home clearly separates status from compact uniform actions', () => {
  assert.match(homeSource, /av2-home__report-status/);
  assert.match(homeSource, /badge\.setAttribute\('role', 'status'\)/);
  assert.match(homeSource, /av2-home__action-btn av2-home__view-all/);
  assert.match(homeSource, /av2-home__action-btn av2-home__excel-btn/);
  assert.match(homeSource, /av2-home__action-btn av2-home__month-submit/);
  assert.match(desktopAppThemeStyles, /\.av2-home \.av2-home__status-area\s*\{[\s\S]*max-width:\s*500px/);
  assert.match(desktopAppThemeStyles, /\.av2-home \.av2-home__action-btn\s*\{[\s\S]*width:\s*118px[\s\S]*height:\s*36px/);
  assert.match(desktopAppThemeStyles, /\.av2-home \.av2-home__report-status\s*\{[\s\S]*pointer-events:\s*none/);
});

test('Attendance desktop row data uses the activity-name font size everywhere', () => {
  const dataClasses = [
    'av2-rr__date strong','av2-rr__start','av2-rr__end','av2-rr__hours',
    'av2-rr__time-cancel','av2-rr__day-total','av2-rr__type','av2-rr__name',
    'av2-rr__school','av2-rr__authority','av2-rr__km','av2-rr__expenses'
  ];
  for (const cls of dataClasses) assert.match(reportTableFitStyles, new RegExp(cls.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&')));
  assert.match(reportTableFitStyles, /font-size:\s*0\.75rem\s*!important/);
});

test('Course reports are dashboard-driven and expose mismatch notices', () => {
  assert.match(newReportSource, /getInstructorActivitiesForDate/);
  assert.match(newReportSource, /function validateCourseAgainstDashboard/);
  assert.match(newReportSource, /אי התאמה לנתוני הדשבורד – נדרשת בדיקה/);
  assert.match(newReportSource, /function syncCourseDashboardLocks/);
  assert.match(newReportSource, /picker\.hourSel\.disabled = locked/);
  assert.match(newReportSource, /av2:dashboard-duplicate-meeting/);
  assert.match(reportsSource, /getMonthDashboardValidation/);
  assert.match(reportsSource, /av2-rr__dashboard-warning/);
  assert.match(reportsSource, /אי התאמה לנתוני הדשבורד – נדרשת בדיקה/);
  assert.match(dashboardAlignmentMigration, /av2_validate_attendance_month_dashboard/);
  assert.match(dashboardAlignmentMigration, /שעות הדיווח אינן תואמות לשעות המחושבות מהדשבורד/);
});

test('Course duplication targets only the immediate next dashboard meeting, including across months', () => {
  assert.match(duplicateCourseSource, /const nextMeeting = schedule\.find\(\(item\) => item\.meeting_no > sourceMeetingNo\) \|\| null/);
  assert.match(duplicateCourseSource, /const nextMeetingAssignedToCurrent = !!nextMeeting && nextMeeting\.assigned_to_current !== false/);
  assert.match(duplicateCourseSource, /const available = nextMeeting && nextMeetingAssignedToCurrent && !nextMeetingAlreadyReported \? \[nextMeeting\] : \[\]/);
  assert.match(duplicateCourseSource, /גם אם הוא בחודש הבא/);
  assert.match(duplicateCourseSource, /המפגש הבא בדשבורד כבר דווח ולכן לא ניתן לדלג למפגש מאוחר יותר/);
  assert.match(duplicateCourseSource, /המפגש הבא בדשבורד משויך למדריך אחר ולכן לא ניתן לדלג למפגש מאוחר יותר/);
  assert.match(duplicateCourseSource, /start_time:\s*clean\(item\?\.start_time\)/);
  assert.match(duplicateCourseSource, /end_time:\s*clean\(item\?\.end_time\)/);
  assert.match(duplicateCourseSource, /av2:dashboard-duplicate-meeting/);
  assert.match(duplicateCourseSource, /#av2-activity-type[\s\S]*#av2-meeting-no-trigger[\s\S]*\.av2-time-picker/);
  assert.doesNotMatch(duplicateCourseSource, /\.av2-form-section input:not\(#av2-report-date\)/);
  assert.match(dashboardAlignmentMigration, /scheduling_effective_meetings/);
});

test('Attendance navigation reads use short caches and do not recalculate every route on load', () => {
  assert.match(attendanceServiceSource, /ATTENDANCE_READ_CACHE_TTL_MS = 60_000/);
  assert.match(attendanceServiceSource, /monthRecordsCache/);
  assert.match(attendanceServiceSource, /dashboardValidationCache/);
  assert.match(attendanceServiceSource, /Route reconciliation is intentionally not run during screen reads/);
  const getMonthBlock = attendanceServiceSource.slice(
    attendanceServiceSource.indexOf('export async function getMonthRecords'),
    attendanceServiceSource.indexOf('/**\n * Aggregate monthly summary')
  );
  assert.doesNotMatch(getMonthBlock, /Promise\.allSettled\(sourceIds\.map\(\(id\) => reconcileTravelCompensation/);
  assert.match(activitiesServiceSource, /ACTIVITY_CACHE_TTL_MS = 60_000/);
});

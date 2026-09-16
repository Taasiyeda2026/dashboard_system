from pathlib import Path


def replace_once(path, old, new, label):
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise AssertionError(f'{label}: expected 1 match, got {count}')
    file_path.write_text(text.replace(old, new, 1))


def append_once(path, marker, addition):
    file_path = Path(path)
    text = file_path.read_text()
    if marker in text:
        return
    file_path.write_text(text.rstrip() + '\n\n' + addition.strip() + '\n')


# Home: group the compact list by reporting date and calculate the shown total
# from every record on that date, including generated travel-time cancellation.
replace_once(
    'attendance/src/screens/home-screen.js',
    "import { createReportSummaryRow, distinctAttendanceWorkDays } from '../components/report-summary-row.js';\n",
    "import { createReportDaySummaryRow, distinctAttendanceWorkDays } from '../components/report-summary-row.js';\nimport { groupReportRecordsByDate } from '../components/monthly-report-summary.js';\n",
    'home imports'
)

replace_once(
    'attendance/src/screens/home-screen.js',
    """  } else {
    sourceRecords.slice().sort((a,b) => String(b.report_date).localeCompare(String(a.report_date))).slice(0, 6)
      .forEach((record) => list.append(createReportSummaryRow(record, { editable, onEdit: () => onEditReport?.(record) })));
  }
""",
    """  } else {
    groupReportRecordsByDate(records).slice(0, 6)
      .forEach((day) => list.append(createReportDaySummaryRow(day, {
        editable,
        onEdit: (record) => onEditReport?.(record)
      })));
  }
""",
    'home daily grouped rows'
)

# Home grouped-day component.
append_once(
    'attendance/src/components/report-summary-row.js',
    'export function createReportDaySummaryRow(day, options = {})',
    r'''
function isGeneratedCancellationRow(record = {}) {
  return record?.generation_kind === 'travel_time_cancellation' && !!record?.source_attendance_record_id;
}

function reportHoursLabel(record = {}) {
  return formatTravelMinutes(Number(record?.total_hours || 0) * 60);
}

export function createReportDaySummaryRow(day, options = {}) {
  const records = Array.isArray(day?.records) ? day.records : [];
  const sourceRecords = records.filter((record) => !isGeneratedCancellationRow(record));
  const wrapper = document.createElement('div');
  wrapper.className = 'av2-report-summary-row av2-report-summary-row--day';
  wrapper.dataset.reportDate = String(day?.date || '');
  wrapper.dataset.tone = mobileToneForActivityType(sourceRecords[0]?.activity_type || records[0]?.activity_type);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'av2-report-summary-row__toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', `פתיחת פירוט דיווחים ליום ${formatDate(day?.date)}`);

  const dateEl = document.createElement('span');
  dateEl.className = 'av2-report-summary-row__date';
  dateEl.textContent = formatDate(day?.date);

  const main = document.createElement('span');
  main.className = 'av2-report-summary-row__main';
  const heading = document.createElement('strong');
  const context = document.createElement('small');
  if (sourceRecords.length === 1) {
    const presentation = reportPresentation(sourceRecords[0]);
    heading.textContent = presentation.activity;
    context.textContent = presentation.secondary;
  } else {
    heading.textContent = `${sourceRecords.length || records.length} דיווחים`;
    context.textContent = [...new Set(records.map((record) => String(record?.activity_type || '').trim()).filter(Boolean))].join(' · ');
  }
  main.append(heading, context);

  const hours = document.createElement('span');
  hours.className = 'av2-report-summary-row__hours';
  hours.textContent = formatTravelMinutes(Number(day?.totalHours || 0) * 60);
  hours.setAttribute('aria-label', `סה״כ ${hours.textContent} שעות ביום זה`);

  const travel = document.createElement('span');
  travel.className = 'av2-report-summary-row__travel';
  if (Number(day?.cancellationHours || 0) > 0) {
    travel.textContent = `ביטול ${formatTravelMinutes(Number(day.cancellationHours) * 60)}`;
    travel.setAttribute('aria-label', `${travel.textContent} מתוך הסה״כ היומי`);
  } else {
    travel.hidden = true;
  }

  const chevron = document.createElement('span');
  chevron.className = 'av2-report-summary-row__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.append(createIcon('chevron-left', { size: 14 }));
  toggle.append(dateEl, main, hours, travel, chevron);

  const details = document.createElement('div');
  details.className = 'av2-report-summary-row__details';
  details.hidden = true;

  const list = document.createElement('div');
  list.className = 'av2-report-summary-row__activity-list';
  for (const record of records) {
    const line = document.createElement('div');
    line.className = 'av2-report-summary-row__activity-line';
    if (isGeneratedCancellationRow(record)) line.classList.add('is-cancellation');

    const type = document.createElement('strong');
    type.className = 'av2-report-summary-row__activity-type';
    type.textContent = record?.activity_type || (isGeneratedCancellationRow(record) ? 'ביטול זמן' : '—');

    const activity = document.createElement('span');
    activity.className = 'av2-report-summary-row__activity-name';
    activity.textContent = isGeneratedCancellationRow(record)
      ? (record?.activity_name_snapshot || record?.program_name_snapshot || 'ביטול זמן מחושב')
      : reportPresentation(record).activity;

    const lineHours = document.createElement('span');
    lineHours.className = 'av2-report-summary-row__activity-hours';
    lineHours.textContent = reportHoursLabel(record);
    lineHours.setAttribute('aria-label', `${lineHours.textContent} שעות`);

    line.append(type, activity, lineHours);
    if (options.editable && !isGeneratedCancellationRow(record) && typeof options.onEdit === 'function') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'av2-btn av2-btn--link av2-report-summary-row__activity-edit';
      edit.textContent = 'עריכה';
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        options.onEdit(record);
      });
      line.append(edit);
    }
    list.append(line);
  }
  details.append(list);

  toggle.addEventListener('click', () => {
    const expanded = details.hidden;
    details.hidden = !expanded;
    wrapper.classList.toggle('is-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', `${expanded ? 'סגירת' : 'פתיחת'} פירוט דיווחים ליום ${formatDate(day?.date)}`);
  });

  wrapper.append(toggle, details);
  return wrapper;
}
'''
)

# My Reports: monthly summary cards, daily totals (including cancellation), and
# conditional totals only when the metric actually exists.
replace_once(
    'attendance/src/screens/my-reports-screen.js',
    "import { isBaseTrainingRecord, reportPresentation } from '../components/report-summary-row.js';\n",
    "import { isBaseTrainingRecord, reportPresentation } from '../components/report-summary-row.js';\nimport { buildMonthlySummaryItems, buildDailyHoursByDate, formatDurationHours } from '../components/monthly-report-summary.js';\n",
    'reports summary helper import'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """    const calContainer = document.createElement('div');
    calContainer.className = 'av2-reports__calendar-wrap';
    calContainer.append(calWrap);
    contentArea.append(calContainer, filterBar);

    // ── Empty state ───────────────────────────────────────────────────────
""",
    """    const calContainer = document.createElement('div');
    calContainer.className = 'av2-reports__calendar-wrap';
    calContainer.append(calWrap);
    contentArea.append(calContainer, filterBar);

    const monthlySummary = buildMonthlySummaryGrid(records);
    if (monthlySummary) contentArea.append(monthlySummary);

    // ── Empty state ───────────────────────────────────────────────────────
""",
    'monthly summary placement'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """    // ── Sort: date DESC, then start_time ASC within same date ────────────
    const sorted = [...sourceRecords].sort((a, b) => {
""",
    """    // ── Sort: date DESC, then start_time ASC within same date ────────────
    const dailyHoursByDate = buildDailyHoursByDate(records);
    const datesWithShownTotal = new Set();
    const sorted = [...sourceRecords].sort((a, b) => {
""",
    'daily total map'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """    for (const record of sorted) {
      const row = buildRecordRow({ record, generated: generatedCancellationFor(records, record.id), editable, instructor, activityTypes, onDuplicate, onRefresh });
      row.dataset.reportDate = record.report_date;
      rowEntries.push({ row, reportDate: record.report_date });
      listWrap.append(row);
    }
""",
    """    for (const record of sorted) {
      const reportDate = String(record.report_date || '').slice(0, 10);
      const showDayTotal = reportDate && !datesWithShownTotal.has(reportDate);
      if (showDayTotal) datesWithShownTotal.add(reportDate);
      const row = buildRecordRow({
        record,
        generated: generatedCancellationFor(records, record.id),
        editable,
        instructor,
        activityTypes,
        onDuplicate,
        onRefresh,
        dayTotalHours: showDayTotal ? dailyHoursByDate.get(reportDate) : null
      });
      row.dataset.reportDate = record.report_date;
      rowEntries.push({ row, reportDate: record.report_date });
      listWrap.append(row);
    }
""",
    'show daily total once per date'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """    // ── Totals row ────────────────────────────────────────────────────────
    const totals = document.createElement('div');
    totals.className = 'av2-report-list__totals';
    const totalsLabel = document.createElement('span');
    totalsLabel.textContent = 'סה״כ החודש';
    const totalsHours = document.createElement('strong');
    totalsHours.textContent = `${summary.totalHours.toFixed(2)} שעות`;
    const totalsKm = document.createElement('strong');
    totalsKm.textContent = `${summary.totalKm.toFixed(0)} ק"מ`;
    const totalsExp = document.createElement('strong');
    totalsExp.textContent = `₪${summary.totalExpenses.toFixed(2)}`;
    totals.append(totalsLabel, totalsHours, totalsKm, totalsExp);

    contentArea.append(listWrap, totals);
""",
    """    // ── Totals row ────────────────────────────────────────────────────────
    const totals = document.createElement('div');
    totals.className = 'av2-report-list__totals';
    const totalsLabel = document.createElement('span');
    totalsLabel.textContent = 'סה״כ החודש';
    const totalMetrics = [];
    if (Number(summary.totalHours || 0) > 0) {
      const totalsHours = document.createElement('strong');
      totalsHours.textContent = `${formatDurationHours(summary.totalHours)} שעות`;
      totalMetrics.push(totalsHours);
    }
    if (Number(summary.totalKm || 0) > 0) {
      const totalsKm = document.createElement('strong');
      totalsKm.textContent = `${summary.totalKm.toFixed(0)} ק"מ`;
      totalMetrics.push(totalsKm);
    }
    if (Number(summary.totalExpenses || 0) > 0) {
      const totalsExp = document.createElement('strong');
      totalsExp.textContent = `₪${summary.totalExpenses.toFixed(2)}`;
      totalMetrics.push(totalsExp);
    }
    if (totalMetrics.length) {
      totals.append(totalsLabel, ...totalMetrics);
      contentArea.append(listWrap, totals);
    } else {
      contentArea.append(listWrap);
    }
""",
    'conditional month totals'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    "function buildRecordRow({ record, generated, editable, instructor, activityTypes, onDuplicate, onRefresh }) {\n",
    "function buildRecordRow({ record, generated, editable, instructor, activityTypes, onDuplicate, onRefresh, dayTotalHours = null }) {\n",
    'record row day total argument'
)

replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """  const dateStrong = document.createElement('strong');
  dateStrong.textContent = formatDateHeb(record.report_date);
  dateCell.append(dateStrong);
""",
    """  const dateStrong = document.createElement('strong');
  dateStrong.textContent = formatDateHeb(record.report_date);
  dateCell.append(dateStrong);
  if (dayTotalHours != null) {
    const dayTotal = document.createElement('span');
    dayTotal.className = 'av2-rr__day-total';
    dayTotal.textContent = `סה״כ יום ${formatDurationHours(dayTotalHours)}`;
    dateCell.append(dayTotal);
  }
""",
    'date cell daily total'
)

# Add the monthly card renderer as a normal function declaration (hoisted).
replace_once(
    'attendance/src/screens/my-reports-screen.js',
    """export function formatCancellationMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

""",
    """export function formatCancellationMinutes(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function buildMonthlySummaryGrid(records) {
  const items = buildMonthlySummaryItems(records);
  if (!items.length) return null;
  const grid = document.createElement('div');
  grid.className = 'av2-reports__summary-grid';
  grid.setAttribute('aria-label', 'סיכום חודשי');
  for (const item of items) {
    const card = document.createElement('div');
    card.className = `av2-reports__summary-card av2-reports__summary-card--${item.kind}`;
    const value = document.createElement('strong');
    value.className = 'av2-reports__summary-value';
    value.textContent = item.value;
    const label = document.createElement('span');
    label.className = 'av2-reports__summary-label';
    label.textContent = item.label;
    card.append(value, label);
    grid.append(card);
  }
  return grid;
}

""",
    'monthly card renderer'
)

# Mobile expanded report must explicitly show the activity type as a detail.
replace_once(
    'attendance/src/mobile-reports-enhancer.js',
    """  const startCell = row.querySelector('.av2-rr__start');
  const endCell = row.querySelector('.av2-rr__end');
  const nameCell = row.querySelector('.av2-rr__name');
""",
    """  const startCell = row.querySelector('.av2-rr__start');
  const endCell = row.querySelector('.av2-rr__end');
  const typeCell = row.querySelector('.av2-rr__type');
  const nameCell = row.querySelector('.av2-rr__name');
""",
    'mobile type cell lookup'
)

replace_once(
    'attendance/src/mobile-reports-enhancer.js',
    """  setMobileLabel(startCell, 'שעת התחלה');
  setMobileLabel(endCell, 'שעת סיום');
  setMobileLabel(nameCell, 'שם הפעילות');
""",
    """  setMobileLabel(startCell, 'שעת התחלה');
  setMobileLabel(endCell, 'שעת סיום');
  setMobileLabel(typeCell, 'סוג פעילות');
  setMobileLabel(nameCell, 'שם הפעילות');
""",
    'mobile type label'
)

replace_once(
    'attendance/src/styles/mobile-reports.css',
    """  .av2-report-row.is-mobile-expanded > .av2-rr__start,
  .av2-report-row.is-mobile-expanded > .av2-rr__end,
  .av2-report-row.is-mobile-expanded > .av2-rr__name,
""",
    """  .av2-report-row.is-mobile-expanded > .av2-rr__start,
  .av2-report-row.is-mobile-expanded > .av2-rr__end,
  .av2-report-row.is-mobile-expanded > .av2-rr__type,
  .av2-report-row.is-mobile-expanded > .av2-rr__name,
""",
    'mobile expanded activity type'
)

# Keep the existing desktop reference table compatible with the current row DOM.
replace_once(
    'attendance/src/reference-data-layout.js',
    """function extractReportRow(row) {
  const timeText = text(row.querySelector('.av2-report-row__time strong'));
  const [start = '—', end = '—'] = timeText.split(/[–—-]/).map((value) => value.trim());
  const hours = numberFrom(text(row.querySelector('.av2-report-row__time span')));
  const km = numberFrom(detailValue(row, 'ק"מ'));
  return {
    date: String(row.dataset.reportDate || text(row.querySelector('.av2-report-row__date strong')) || '—'),
    start,
    end,
    hours,
    activity: text(row.querySelector('.av2-report-row__main strong')) || '—',
    school: text(row.querySelector('.av2-report-row__school strong')) || text(row.querySelector('.av2-report-row__main span')) || '—',
    authority: detailValue(row, 'רשות') || '—',
    km,
    actions: [...row.querySelectorAll('.av2-report-row__actions button')]
  };
}
""",
    """function extractReportRow(row) {
  const date = String(row.dataset.reportDate || text(row.querySelector('.av2-rr__date strong')) || '—');
  const dayTotal = text(row.querySelector('.av2-rr__day-total'));
  return {
    date: dayTotal ? `${date} · ${dayTotal}` : date,
    start: text(row.querySelector('.av2-rr__start')) || '—',
    end: text(row.querySelector('.av2-rr__end')) || '—',
    hours: numberFrom(text(row.querySelector('.av2-rr__hours'))),
    activity: text(row.querySelector('.av2-rr__name')) || '—',
    school: text(row.querySelector('.av2-rr__school')) || '—',
    authority: text(row.querySelector('.av2-rr__authority')) || '—',
    km: numberFrom(text(row.querySelector('.av2-rr__km'))),
    actions: [...row.querySelectorAll('.av2-rr__actions button')]
  };
}
""",
    'reference table current row extraction'
)

# Styles: monthly cards + daily total marker.
append_once(
    'attendance/src/styles/my-reports-screen.css',
    '.av2-reports__summary-grid',
    r'''
/* Monthly summary cards: only rendered for metrics that actually exist. */
.av2-reports__summary-grid {
  width: min(100%, 960px);
  margin-inline: auto;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
  gap: 10px;
}
.av2-reports__summary-card {
  min-height: 72px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 10px 12px;
  border: 1px solid #e1e7ef;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, .045);
  text-align: center;
}
.av2-reports__summary-value {
  color: var(--av2-color-text);
  font-size: .92rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.av2-reports__summary-label {
  color: var(--av2-color-text-muted);
  font-size: .64rem;
  font-weight: 650;
  line-height: 1.25;
}
.av2-reports__summary-card--hours { background: linear-gradient(180deg, #fff 0%, #fbfcff 100%); }
.av2-reports__summary-card--kilometers { background: linear-gradient(180deg, #fff 0%, #f8fdfb 100%); }
.av2-reports__summary-card--expenses { background: linear-gradient(180deg, #fff 0%, #fffdf8 100%); }
.av2-rr__day-total {
  margin-top: 3px;
  color: var(--av2-color-accent) !important;
  font-size: .58rem !important;
  font-weight: 750;
  white-space: nowrap;
}
@media (max-width: 767px) {
  .av2-reports__summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .av2-reports__summary-card { min-height: 64px; padding: 8px; }
}
'''
)

# Styles for grouped day details on the home screen.
append_once(
    'attendance/src/styles/attendance-followup.css',
    '.av2-report-summary-row__activity-list',
    r'''
.av2-report-summary-row__activity-list {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  gap: 0;
  border: 1px solid #e7edf4;
  border-radius: 7px;
  overflow: hidden;
}
.av2-report-summary-row__activity-line {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr) 52px auto;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 8px;
  border-top: 1px solid #eef2f6;
  background: #fff;
}
.av2-report-summary-row__activity-line:first-child { border-top: 0; }
.av2-report-summary-row__activity-line.is-cancellation { background: #f8fbff; }
.av2-report-summary-row__activity-type {
  font-size: .66rem;
  color: #475569;
}
.av2-report-summary-row__activity-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: .69rem;
  color: var(--av2-color-text);
}
.av2-report-summary-row__activity-hours {
  font-size: .7rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.av2-report-summary-row__activity-edit { font-size: .64rem !important; }
@media (max-width: 640px) {
  .av2-report-summary-row__activity-line {
    grid-template-columns: 72px minmax(0, 1fr) 46px;
  }
  .av2-report-summary-row__activity-edit {
    grid-column: 1 / -1;
    justify-self: end;
  }
}
'''
)

# Force a fresh attendance PWA cache after the UI change.
replace_once(
    'attendance/sw.js',
    'const CACHE_VERSION = 71;\n',
    'const CACHE_VERSION = 72;\n',
    'attendance cache version'
)

# Focused tests.
Path('tests/attendance-monthly-report-summary.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildDailyHoursByDate,
  buildMonthlySummaryItems,
  formatDurationHours,
  groupReportRecordsByDate
} from '../attendance/src/components/monthly-report-summary.js';
import { createReportDaySummaryRow } from '../attendance/src/components/report-summary-row.js';
import { readFile } from 'node:fs/promises';

test('daily hours include generated travel cancellation', () => {
  const records = [
    { id: 'course', report_date: '2026-09-02', total_hours: 1.83, activity_type: 'קורס', activity_name_snapshot: 'ביומימיקרי' },
    { id: 'cancel', report_date: '2026-09-02', total_hours: 1.75, activity_type: 'ביטול זמן', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course' }
  ];
  const totals = buildDailyHoursByDate(records);
  assert.equal(Math.round(totals.get('2026-09-02') * 100), 358);
  const [day] = groupReportRecordsByDate(records);
  assert.equal(Math.round(day.totalHours * 100), 358);
  assert.equal(day.cancellationHours, 1.75);
  assert.equal(formatDurationHours(day.totalHours), '3:35');
});

test('monthly cards omit empty metrics and include only existing attendance data', () => {
  const items = buildMonthlySummaryItems([
    { activity_type: 'קורס', total_hours: 3.5, roundtrip_km: 95, expenses: 0 },
    { activity_type: 'ביטול זמן', total_hours: 1.75, generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course', roundtrip_km: 0, expenses: 0 }
  ]);
  assert.deepEqual(items.map((item) => item.label), ['סה״כ שעות קורס', 'סה״כ ביטול זמן', 'סה״כ ק״מ']);
  assert.ok(!items.some((item) => item.label === 'סה״כ הוצאות'));
  assert.equal(items.find((item) => item.label === 'סה״כ שעות קורס').value, '3:30');
});

test('home daily row shows one daily total and activity types in the opened detail', () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  globalThis.document = dom.window.document;
  const day = groupReportRecordsByDate([
    { id: 'course', report_date: '2026-09-02', total_hours: 1.83, activity_type: 'קורס', activity_name_snapshot: 'ביומימיקרי', school_name_snapshot: 'מקיף אבו גוש' },
    { id: 'cancel', report_date: '2026-09-02', total_hours: 1.75, activity_type: 'ביטול זמן', activity_name_snapshot: 'ביטול זמן מחושב', generation_kind: 'travel_time_cancellation', source_attendance_record_id: 'course' }
  ])[0];
  const row = createReportDaySummaryRow(day);
  assert.match(row.textContent, /3:35/);
  const button = row.querySelector('.av2-report-summary-row__toggle');
  button.click();
  assert.match(row.textContent, /קורס/);
  assert.match(row.textContent, /ביטול זמן/);
  assert.equal(row.querySelector('.av2-report-summary-row__details').hidden, false);
  delete globalThis.document;
});

test('mobile expanded report explicitly exposes activity type', async () => {
  const enhancer = await readFile(new URL('../attendance/src/mobile-reports-enhancer.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../attendance/src/styles/mobile-reports.css', import.meta.url), 'utf8');
  assert.match(enhancer, /setMobileLabel\(typeCell, 'סוג פעילות'\)/);
  assert.match(css, /is-mobile-expanded > \.av2-rr__type/);
});
''')

/**
 * my-reports-screen.js  —  Calendar + full report table
 *
 * Calendar: premium, shows activity summaries in day cells, TODAY highlighted.
 * Table:    11 columns — date, start, end, hours, activity type, activity name,
 *           school, authority, km, expenses, actions.
 * Sort:     date DESC, then start_time ASC within the same date.
 * Actions:  copy (blue), duplicate (purple), edit, delete (red).
 * Expenses: one receipt indicator in the expenses column; hover exposes the
 * amount/detail and click opens the expense details and supporting documents.
 */

import { createIcon } from '../components/icon.js';
import { getDailyTravelReports } from '../services/daily-travel.service.js';
import {formatTravelDistance,sumReportedDailyTravel} from '../components/reported-daily-travel.js';
import {createDayDetailRow,formatDecimalHours,formatActivityHours} from '../components/my-reports-day-detail.js';
import { listExpenseReports } from '../services/expense-reports.service.js';
import { reportedKilometers } from '../services/reported-kilometers.js';
import { createInputField, createSelectField } from '../components/field.js';
import { createTimePicker } from '../components/time-picker.js';
import { createMiniCalendar } from '../components/mini-calendar.js';
import { openAttendanceCalendarDay } from '../components/calendar-day-drawer.js';
import { loadAttendanceCalendarContext } from '../services/calendar.service.js';
import { getMonthRecords, calcMonthSummary, updateRecord, deleteRecord,
         getMonthApproval, getActivityTypes, getOperationOptions, deleteAttachmentRecord, sourceAttendanceRecords,
         generatedCancellationFor, reportTravelTime, reconcileTravelCompensation,
         getMonthDashboardValidation } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel, latestReportDate } from '../services/month-gate.service.js';
import { calcHours, ONLINE_REPORT_TYPE, OPERATIONS_REPORT_TYPE } from '../services/activities.service.js';
import { deleteAttachment, getSignedUrl } from '../services/storage.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';
import { isBaseTrainingRecord, reportPresentation } from '../components/report-summary-row.js';
import { isZoomLocationReport } from '../services/attendance-location-policy.js';
import {
  canReportInlineCancellation,
  parseCancellationDuration,
  cancellationMinutesForSave,
  formatCancellationDuration,
  instructorReportedCancellationMinutes,
} from '../services/cancellation-segments.js';
import { buildMonthlySummaryItems, buildDailyTotalHoursByRecord, formatDurationHours } from '../components/monthly-report-summary.js';

const COURSE_REPORT_TYPE = 'קורס';
const BASE_TRAINING_ALLOWED_DATES = new Set(['2026-09-15', '2026-09-16', '2026-09-17']);

function isBaseTrainingAllowedDate(dateStr) {
  return BASE_TRAINING_ALLOWED_DATES.has(String(dateStr || '').trim());
}


export function renderMyReportsScreen(container, {
  instructor = {},
  year,
  month,
  onBack,
  onPrevMonth,
  onNextMonth,
  onNewReport,
  onTravelReport,
  onDuplicate,
} = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-reports';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-reports__inner';

  // ── Header ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'av2-reports__header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'av2-btn av2-btn--icon';
  backBtn.setAttribute('aria-label', 'חזרה');
  backBtn.append(createIcon('chevron-right'));
  backBtn.addEventListener('click', () => onBack?.());
  const title = document.createElement('h1');
  title.className = 'av2-reports__title';
  title.textContent = 'הדיווחים שלי';
  header.append(backBtn, title);

  // ── Month nav + toolbar ──────────────────────────────────────────────────
  const monthNav = buildMonthNav(year, month, onPrevMonth, onNextMonth);
  const toolbar = document.createElement('div');
  toolbar.className = 'av2-reports__toolbar';

  const controls = document.createElement('div');
  controls.className = 'av2-reports__controls';
  controls.append(monthNav, toolbar);

  // ── Loading area ────────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.className = 'av2-reports__content';
  contentArea.innerHTML = '<p class="av2-reports__loading">טוען…</p>';

  inner.append(header, controls, contentArea);
  wrap.append(inner);
  container.append(wrap);

  loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate });
}

async function loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate, deletedTravelDate = null }) {
  const monthKey = getMonthKey(year, month);

  try {
    const [records, approval, activityTypes, calendarContext, dashboardValidation] = await Promise.all([
      getMonthRecords(instructor.empId, year, month),
      getMonthApproval(instructor.empId, monthKey),
      getActivityTypes(),
      loadAttendanceCalendarContext(year, month, { scope: instructor.empId }),
      getMonthDashboardValidation(instructor.empId, year, month),
    ]);

    const sourceRecords = sourceAttendanceRecords(records);
    const expenseReports=monthKey>='2026-11'
      ? await listExpenseReports({
          fromDate:monthKey+'-01',
          toDate:monthKey+'-'+String(new Date(year,month,0).getDate()).padStart(2,'0'),
          employeeIds:[instructor.empId]
        }) : [];
    const dailyTravelReports = monthKey >= '2026-11'
      ? await getDailyTravelReports(instructor.empId,monthKey) : [];
    const dailyTravelByDate = new Map(dailyTravelReports.map(row=>[row.travel_date,row]));
    const travelDays = [...new Set(sourceRecords.filter(row=>
      row.report_date >= '2026-11-01'
      && !isZoomLocationReport({
        activityType:row.activity_type,
        trainingMode:row.training_mode,
        operationMeetingMode:row.operation_meeting_mode,
        operationName:row.activity_name_snapshot
      }) && row.activity_type !== 'ביטול זמן'
    ).map(row=>row.report_date))].sort();
    const missingTravel = travelDays.filter(date=>!dailyTravelByDate.has(date));
    const dashboardValidationByRecord = new Map(
      (dashboardValidation || []).map((item) => [String(item?.record_id || ''), item]),
    );
    const editable = canEditMonth(year, month, approval);
    const summary  = calcMonthSummary(records);
    const savedTravelTotals=sumReportedDailyTravel(dailyTravelReports);

    contentArea.innerHTML = '';

    const onRefresh = (notice = {}) => loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onTravelReport, onDuplicate, ...notice });

    if (deletedTravelDate && !dailyTravelByDate.has(deletedTravelDate)) {
      contentArea.append(buildDeletedTravelNotice({
        date: deletedTravelDate, records: sourceRecords, editable, onTravelReport,
      }));
    }

    // Status badge
    toolbar.innerHTML = '';
    if (approval) {
      const statusMap = {
        submitted:           ['אושר עובד / בבקרת מנהל', 'warning'],
        locked:              ['אושר על ידי המנהל',       'success'],
        reopened:            ['הוחזר לתיקון',             'neutral'],
        approved_for_payroll:['אושר סופית',               'success']
      };
      const [statusLabel, tone] = statusMap[approval.status] || ['פתוח', 'neutral'];
      const badge = document.createElement('span');
      badge.className = `av2-badge av2-badge--${tone}`;
      badge.textContent = statusLabel;
      contentArea.append(badge);
    }

    if (!editable) {
      const lockMsg = document.createElement('p');
      lockMsg.className = 'av2-reports__lock-msg';
      lockMsg.textContent = editBlockReason(year, month, approval);
      contentArea.append(lockMsg);
    }

    if(travelDays.length){
      const travelStatus=document.createElement('section');
      travelStatus.className='av2-reports__travel-status';
      const heading=document.createElement('strong');
      heading.textContent='נסיעות וביטולים';
      const count=document.createElement('span');
      const isCurrentReportMonth = year===new Date().getFullYear() && month===new Date().getMonth()+1;
      count.textContent=missingTravel.length
        ? missingTravel.length+(isCurrentReportMonth?' ימי נסיעה להשלמה עד סוף החודש':' ימים ללא דיווח נסיעות')
        : 'דיווחי הנסיעות הושלמו';
      travelStatus.append(heading,count);
      if(missingTravel.length && editable){
        const action=document.createElement('button');
        action.type='button';
        action.className='av2-btn av2-btn--secondary';
        action.textContent='השלמת נסיעות';
        action.addEventListener('click',()=>onTravelReport?.(missingTravel[0]));
        travelStatus.append(action);
      }
      contentArea.append(travelStatus);
    }

    // ── Toolbar buttons ──────────────────────────────────────────────────
    if (editable) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'av2-btn av2-btn--primary';
      const addLabel = document.createElement('span');
      addLabel.textContent = 'הוסף דיווח';
      addBtn.append(createIcon('plus', { size: 15 }), addLabel);
      addBtn.addEventListener('click', () => onNewReport?.());
      toolbar.append(addBtn);
    }

    if (sourceRecords.length > 0 || expenseReports.length > 0) {
      const xlBtn = document.createElement('button');
      xlBtn.type = 'button';
      xlBtn.className = 'av2-btn av2-btn--secondary';
      xlBtn.append(createIcon('download', { size: 15 }));
      const xlLabel = document.createElement('span');
      xlLabel.textContent = 'Excel';
      xlBtn.append(xlLabel);
      xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month, dailyTravelReports, expenseReports));
      toolbar.append(xlBtn);
    }

    // ── Calendar ─────────────────────────────────────────────────────────
    const { wrap: calWrap } = createMiniCalendar({
      year,
      month,
      records: sourceRecords,
      calendarContext,
      onDayClick: (dateStr, dayEvents) => {
        openAttendanceCalendarDay({
          dateStr,
          activities: dayEvents.activities,
          schoolEvents: dayEvents.schoolEvents,
          birthdays: dayEvents.birthdays,
          records: dayEvents.records,
          canAddReport: editable,
          onNewReport,
        });
      },
    });

    const calContainer = document.createElement('div');
    calContainer.className = 'av2-reports__calendar-wrap';
    calContainer.append(calWrap);
    contentArea.append(calContainer);

    const monthlySummary = buildMonthlySummaryGrid(records,monthKey>='2026-11'?dailyTravelReports:null);
    if (monthlySummary) contentArea.append(monthlySummary);
    if(expenseReports.length){
      const expenseStatus=document.createElement('p');
      expenseStatus.className='av2-reports__expense-status';
      const approved=expenseReports.filter(row=>row.review_status==='approved')
        .reduce((sum,row)=>sum+Number(row.approved_amount||0),0);
      const pending=expenseReports.filter(row=>row.review_status==='pending_review').length;
      expenseStatus.textContent='הוצאות החודש: '+expenseReports.length
        +' · אושרו ₪'+approved.toFixed(2)
        +(pending?' · '+pending+' ממתינות לאישור':'');
      contentArea.append(expenseStatus);
    }

    // ── Empty state ───────────────────────────────────────────────────────
    if (!sourceRecords.length) {
      const empty = document.createElement('p');
      empty.className = 'av2-reports__empty';
      empty.textContent = `אין דיווחים לחודש ${formatMonthLabel(year, month)}.`;
      contentArea.append(empty);
      return;
    }

    // ── Section title ────────────────────────────────────────────────────
    const tableTitle = document.createElement('h2');
    tableTitle.className = 'av2-reports__table-title';
    tableTitle.textContent = 'דיווחי החודש';
    contentArea.append(tableTitle);

    // ── Sort: date DESC, then start_time ASC within same date ────────────
    const sorted = [...sourceRecords].sort((a, b) => {
      const dc = String(b.report_date).localeCompare(String(a.report_date));
      if (dc !== 0) return dc;
      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });
    const dailyTotalHoursByRecord = buildDailyTotalHoursByRecord(records, sorted);

    // ── Table ─────────────────────────────────────────────────────────────
    const listWrap = document.createElement('div');
    listWrap.className = 'av2-report-list av2-report-list--unified';

    // Table header
    const listHead = document.createElement('div');
    listHead.className = 'av2-report-list__head';
    const colLabels = ['תאריך', 'סוג', 'התחלה', 'סיום', 'שעות', 'שם פעילות', 'מפגש', 'מיקום / בית ספר', 'רשות', 'פעולות'];
    for (const label of colLabels) {
      const cell = document.createElement('span');
      cell.textContent = label;
      listHead.append(cell);
    }
    listWrap.append(listHead);

    for(const [index,record] of sorted.entries()){
      const reportDate=String(record.report_date||'').slice(0,10);
      const row=buildRecordRow({
        record,
        generated:generatedCancellationFor(records,record.id),
        editable,instructor,activityTypes,onDuplicate,onTravelReport,onRefresh,
        hasDailyTravel: dailyTravelByDate.has(reportDate),
        dashboardValidation:dashboardValidationByRecord.get(String(record.id))||null
      });
      row.dataset.reportDate=reportDate;
      listWrap.append(row);
      if(index===sorted.length-1 || String(sorted[index+1].report_date||'').slice(0,10)!==reportDate){
        const dayRecords=sorted.filter(item=>String(item.report_date||'').slice(0,10)===reportDate);
        const dayExpenses=expenseReports.filter(item=>String(item.expense_date||'').slice(0,10)===reportDate);
        listWrap.append(createDayDetailRow({
          date:reportDate,records:dayRecords,
          travelReport:dailyTravelByDate.get(reportDate)||null,
          expenseReports:dayExpenses,
          modern:reportDate>='2026-11-01',onTravelReport
        }));
      }
    }

    // ── Totals row ────────────────────────────────────────────────────────
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
    const displayTotalKm=monthKey>='2026-11'?savedTravelTotals.kilometers:Number(summary.totalKm||0);
    if (displayTotalKm > 0) {
      const totalsKm = document.createElement('strong');
      totalsKm.textContent = formatTravelDistance(displayTotalKm);
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

  } catch (err) {
    contentArea.innerHTML = `<p class="av2-error">שגיאה בטעינת נתונים: ${err.message}</p>`;
  }
}

// ── Record row (12 columns on desktop) ────────────────────────────────────────

export function formatCancellationMinutes(value) {
  return formatCancellationDuration(value);
}

function buildMonthlySummaryGrid(records,travelReports=null) {
  const items = buildMonthlySummaryItems(records,travelReports);
  if (!items.length) return null;
  const grid = document.createElement('div');
  grid.className = 'av2-reports__summary-grid';
  grid.setAttribute('aria-label', 'סיכום חודשי');
  for (const item of items) {
    const card = document.createElement('div');
    card.className = `av2-reports__summary-card av2-reports__summary-card--${item.kind}`;
    const value = document.createElement('strong');
    value.className = 'av2-reports__summary-value';
    value.textContent = item.kind==='hours' ? formatDecimalHours(item.numericValue)+' שעות' : item.value;
    const label = document.createElement('span');
    label.className = 'av2-reports__summary-label';
    label.textContent = item.label;
    card.append(value, label);
    grid.append(card);
  }
  return grid;
}

function locationOrSchoolForRecord(record, baseTraining) {
  const school = String(record.school_name_snapshot || '').trim();
  const authority = String(record.authority_name_snapshot || '').trim();

  if (baseTraining) {
    if (school && authority) {
      if (authority.includes(school)) return authority;
      return `${school}, ${authority}`;
    }
    return authority || school || 'Greenwork, יקום';
  }

  if (isZoomLocationReport({
    activityType: record.activity_type,
    trainingMode: record.training_mode,
    operationMeetingMode: record.operation_meeting_mode,
    operationName: record.activity_name_snapshot,
  })) return 'זום';
  if (record.activity_type === OPERATIONS_REPORT_TYPE && record.activity_name_snapshot === 'צוות') {
    return record.destination_address_snapshot || '—';
  }
  if (record.training_schedule_id) return authority || school || '—';
  return school || '—';
}

function buildRecordRow({ record, generated, editable, instructor, activityTypes, onDuplicate, onTravelReport, onRefresh, hasDailyTravel = false, dashboardValidation = null }) {
  const row = document.createElement('div');
  row.className = 'av2-report-row';
  row.dataset.recordId = record.id;
  const baseTraining = isBaseTrainingRecord(record);

  // ── 1. Date ─────────────────────────────────────────────────────────────
  const dateCell = document.createElement('div');
  dateCell.className = 'av2-rr__date';
  const dateStrong = document.createElement('strong');
  dateStrong.textContent = formatDateHeb(record.report_date);
  dateCell.append(dateStrong);

  // ── 2. Start time ────────────────────────────────────────────────────────
  const startCell = document.createElement('div');
  startCell.className = 'av2-rr__start';
  startCell.textContent = formatTime(record.start_time);

  // ── 3. End time ──────────────────────────────────────────────────────────
  const endCell = document.createElement('div');
  endCell.className = 'av2-rr__end';
  endCell.textContent = formatTime(record.end_time);

  // ── 4. Total hours ────────────────────────────────────────────────────────
  const hoursCell = document.createElement('div');
  hoursCell.className = 'av2-rr__hours';
  hoursCell.textContent = formatActivityHours(record.total_hours);

  // ── 5. Activity type ─────────────────────────────────────────────────────
  const typeCell = document.createElement('div');
  typeCell.className = 'av2-rr__type';
  typeCell.textContent = record.activity_type || '—';

  // ── 6. Activity name ─────────────────────────────────────────────────────
  const nameCell = document.createElement('div');
  nameCell.className = 'av2-rr__name';
  const presentation = reportPresentation(record);
  nameCell.textContent = presentation.activity || '—';
  nameCell.title = presentation.activity || '';

  // ── 7. Course meeting number ────────────────────────────────────────────
  const meetingCell=document.createElement('div');
  meetingCell.className='av2-rr__meeting';
  meetingCell.textContent=record.meeting_no==null||record.meeting_no===''?'—':String(record.meeting_no);

  // ── 8. Location / school ─────────────────────────────────────────────────
  const schoolCell = document.createElement('div');
  schoolCell.className = 'av2-rr__school';
  schoolCell.textContent = locationOrSchoolForRecord(record, baseTraining);

  // ── 8. Authority ─────────────────────────────────────────────────────────
  const authCell = document.createElement('div');
  authCell.className = 'av2-rr__authority';
  authCell.textContent = baseTraining ? '—' : (record.authority_name_snapshot || '—');

  // ── 11. Actions ───────────────────────────────────────────────────────────
  const actionsCell = document.createElement('div');
  actionsCell.className = 'av2-rr__actions';

  // Duplicate (purple) — always available
  if (onDuplicate) {
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'av2-btn av2-btn--icon av2-rr__action-dup';
    dupBtn.setAttribute('aria-label', 'שכפל דיווח');
    dupBtn.title = 'שכפל דיווח';
    dupBtn.append(createIcon('duplicate', { size: 14 }));
    dupBtn.addEventListener('click', (e) => { e.stopPropagation(); onDuplicate(record); });
    actionsCell.append(dupBtn);
  }

  if (onTravelReport && record.report_date >= '2026-11-01'
      && !isZoomLocationReport({
        activityType:record.activity_type,
        trainingMode:record.training_mode,
        operationMeetingMode:record.operation_meeting_mode,
        operationName:record.activity_name_snapshot
      }) && record.activity_type !== 'ביטול זמן') {
    const travelBtn = document.createElement('button');
    travelBtn.type = 'button';
    travelBtn.className = 'av2-btn av2-btn--icon av2-rr__travel-shortcut';
    travelBtn.append(createIcon('map-pin',{size:14}));
    travelBtn.title = 'מילוי נסיעות ליום הפעילות';
    travelBtn.setAttribute('aria-label', 'מילוי נסיעות ליום ' + record.report_date);
    travelBtn.addEventListener('click',event=>{
      event.stopPropagation();
      onTravelReport(record.report_date);
    });
    actionsCell.append(travelBtn);
  }

  // Edit + Delete (only when editable)
  if (editable) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'av2-btn av2-btn--icon av2-rr__action-edit';
    editBtn.setAttribute('aria-label', 'עריכה');
    editBtn.title = 'עריכה';
    editBtn.append(createIcon('edit', { size: 14 }));
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); showEditModal({ record, instructor, activityTypes, onRefresh }); });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'av2-btn av2-btn--icon av2-rr__action-delete';
    deleteBtn.setAttribute('aria-label', 'מחק');
    deleteBtn.title = 'מחק';
    deleteBtn.append(createIcon('trash', { size: 14 }));
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete({ record, instructor, row, onRefresh, hasDailyTravel }); });

    actionsCell.append(editBtn, deleteBtn);
  }

  // Stable action sequence: edit, delete, duplicate, daily travel.
  const priority=(button)=>button.classList.contains('av2-rr__action-edit')?0
    :button.classList.contains('av2-rr__action-delete')?1
    :button.classList.contains('av2-rr__action-dup')?2:3;
  actionsCell.replaceChildren(...[...actionsCell.children].sort((a,b)=>priority(a)-priority(b)));

  row.append(dateCell,typeCell,startCell,endCell,hoursCell,nameCell,meetingCell,schoolCell,authCell,actionsCell);

  if (dashboardValidation?.mismatch) {
    row.classList.add('has-dashboard-mismatch');
    const warning = document.createElement('div');
    warning.className = 'av2-rr__dashboard-warning';
    const reasons = Array.isArray(dashboardValidation.reasons) ? dashboardValidation.reasons.filter(Boolean) : [];
    warning.textContent = `אי התאמה לנתוני הדשבורד – נדרשת בדיקה${reasons.length ? `: ${reasons.join(' · ')}` : ''}`;
    warning.setAttribute('role', 'status');
    row.append(warning);
  }

  const compensation = record.travel_compensation;
  const instructorMinutes = instructorReportedCancellationMinutes(record);
  // Legacy per-activity travel compensation UI stays for pre-cutover months only.
  // From 2026-11-01 the daily-travel tab is the single instructor travel path.
  if (record.report_date < '2026-11-01' && (compensation || instructorMinutes !== null)) {
    const detail = document.createElement('div');
    detail.className = 'av2-rr__travel-compensation';
    const text = document.createElement('span');
    // Show the instructor's own entry even while awaiting manager review.
    // Approved minutes belong to the separate payroll/manager workflow.
    const label = instructorMinutes !== null ? formatCancellationMinutes(instructorMinutes) : 'טרם דווח';
    text.innerHTML = `<strong aria-label="משך ביטול זמן">${label}</strong>`;
    detail.append(text);
    const audit = document.createElement('span');
    audit.className = 'av2-rr__travel-audit';
    const bits = [];
    if (compensation?.reported_outbound_minutes != null && compensation?.reported_return_minutes != null) {
      bits.push(`הלוך ${compensation.reported_outbound_minutes} · חזור ${compensation.reported_return_minutes}`);
    }
    if (compensation?.review_status && compensation.review_status !== 'none') {
      bits.push(`סטטוס: ${compensation.review_status}`);
    }
    if (compensation?.show_travel_report_reminder) bits.push('תזכורת: מעל 40 ק״מ בכיוון אחד');
    audit.textContent = bits.join(' · ')
      || (instructorMinutes !== null ? 'דווח על ידי המדריך' : 'ניתן לדווח זמני נסיעה');
    detail.append(audit);
    if (editable && compensation && !['approved', 'corrected', 'rejected'].includes(compensation.review_status)) {
      const edit = document.createElement('button');
      edit.type = 'button'; edit.className = 'av2-btn av2-btn--link'; edit.textContent = 'דיווח נסיעה';
      edit.addEventListener('click', () => {
        edit.hidden = true;
        const out = document.createElement('input');
        out.type = 'number'; out.min = '0'; out.step = '1';
        out.value = String(compensation.reported_outbound_minutes ?? '');
        out.className = 'av2-rr__travel-minutes'; out.setAttribute('aria-label', 'דקות נסיעה הלוך');
        out.placeholder = 'הלוך';
        const ret = document.createElement('input');
        ret.type = 'number'; ret.min = '0'; ret.step = '1';
        ret.value = String(compensation.reported_return_minutes ?? '');
        ret.className = 'av2-rr__travel-minutes'; ret.setAttribute('aria-label', 'דקות נסיעה חזור');
        ret.placeholder = 'חזור';
        const save = document.createElement('button'); save.type = 'button'; save.className = 'av2-btn av2-btn--link'; save.textContent = 'שמירה';
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            await reportTravelTime(record.id, Number(out.value), Number(ret.value));
            onRefresh();
          } catch (error) {
            save.disabled = false;
            save.textContent = error.message || 'השמירה נכשלה';
          }
        });
        detail.append(out, ret, save); out.focus();
      });
      detail.append(edit);
    }
    row.append(detail);
  } else if (generated) {
    row.dataset.generatedCompensation = generated.id;
  }

  // Notes expandable (notes only, not shown in main grid)
  if (record.notes) {
    const notesRow = document.createElement('div');
    notesRow.className = 'av2-rr__notes-row';
    notesRow.hidden = true;
    const notesLabel = document.createElement('span');
    notesLabel.textContent = 'הערות:';
    const notesText = document.createElement('span');
    notesText.textContent = record.notes;
    notesRow.append(notesLabel, notesText);
    row.append(notesRow);
    row.classList.add('av2-report-row--has-notes');
    row.style.cursor = 'pointer';
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', 'false');
    row.tabIndex = 0;
    const toggle = () => {
      const expanded = notesRow.hidden;
      notesRow.hidden = !expanded;
      row.setAttribute('aria-expanded', String(expanded));
      row.classList.toggle('is-expanded', expanded);
    };
    row.addEventListener('click', (e) => { if (!e.target.closest('button,a')) toggle(); });
    row.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button,a')) { e.preventDefault(); toggle(); }
    });
  }

  return row;
}

// ── Copy to clipboard ─────────────────────────────────────────────────────────

async function handleCopy(record, btn) {
  const parts = [
    formatDateHeb(record.report_date),
    `${formatTime(record.start_time)}–${formatTime(record.end_time)}`,
    formatDurationHours(record.total_hours) + ' שעות',
    record.activity_name_snapshot || record.activity_type || '',
    record.school_name_snapshot || '',
    record.authority_name_snapshot || '',
    ...(instructorReportedCancellationMinutes(record) !== null
      ? [`ביטול זמן מדווח: ${formatCancellationMinutes(instructorReportedCancellationMinutes(record))}`]
      : []),
    Number(record.roundtrip_km || 0).toFixed(0) + ' ק"מ',
  ].filter(Boolean).join(' | ');

  try {
    await navigator.clipboard.writeText(parts);
    btn.style.color = '#16a34a';
    setTimeout(() => { btn.style.color = ''; }, 1200);
  } catch {
    // Clipboard not available — silent
  }
}

// ── Delete ─────────────────────────────────────────────────────────────────────

function buildDeletedTravelNotice({ date, records, editable, onTravelReport }) {
  const remainingPhysical = records.some(record => record.report_date === date
    && record.generation_kind == null && record.activity_type !== 'ביטול זמן'
    && !isZoomLocationReport({
      activityType: record.activity_type, trainingMode: record.training_mode,
      operationMeetingMode: record.operation_meeting_mode,
      operationName: record.activity_name_snapshot,
    }));
  const notice = document.createElement('section');
  notice.className = 'av2-reports__travel-status';
  notice.setAttribute('role', 'status');
  notice.dataset.deletedTravelDate = date;
  const message = document.createElement('p');
  message.textContent = 'בעקבות מחיקת רשומת הנוכחות, גם דיווח הנסיעות של יום זה נמחק.'
    + (remainingPhysical ? ' יש למלא מחדש את נסיעות היום.' : '');
  notice.append(message);
  if (remainingPhysical && editable && onTravelReport) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'av2-btn av2-btn--secondary';
    action.textContent = 'מילוי נסיעות היום';
    action.addEventListener('click', () => onTravelReport(date));
    notice.append(action);
  }
  return notice;
}

async function handleDelete({ record, instructor, row, onRefresh, hasDailyTravel = false }) {
  if (row.dataset.deleting === 'true') return;
  const dateStr = formatDateHeb(record.report_date);
  const physicalTravel=record.generation_kind==null
    && !['זום','ביטול זמן'].includes(record.activity_type)
    && record.training_mode!=='online'
    && record.operation_meeting_mode!=='online';
  const travelWarning=physicalTravel
    ? record.report_date>='2026-11-01'
      ? '\nגם הנסיעות וביטול הזמן של יום זה יימחקו, לרבות האישור והזכאות לתשלום הקשורים לדיווח.\nדיווחי הנוכחות האחרים יישארו ללא שינוי. אם נותרו פעילויות, יהיה צורך למלא מחדש את נסיעות היום.'
      : '\nגם נתוני הנסיעה המשויכים לדיווח יימחקו.'
    : '';
  if (!confirm(`למחוק את הדיווח מתאריך ${dateStr}?${travelWarning}\nפעולה זו אינה הפיכה.`)) return;

  row.dataset.deleting = 'true';
  row.style.opacity = '0.5';
  try {
    const attachments = record.attendance_record_attachments || [];
    for (const att of attachments) {
      try {
        await deleteAttachment(att.storage_path);
        await deleteAttachmentRecord(att.id, instructor.empId);
      } catch (e) {
        console.warn('attachment delete failed:', e.message);
      }
    }
    await deleteRecord(record.id, instructor.empId);
    await onRefresh({ deletedTravelDate: physicalTravel && hasDailyTravel
      && record.report_date >= '2026-11-01' ? record.report_date : null });
  } catch (err) {
    delete row.dataset.deleting;
    row.style.opacity = '1';
    alert(`שגיאה במחיקה: ${err.message}`);
  }
}

// ── Edit modal ─────────────────────────────────────────────────────────────────

function showEditModal({ record, instructor, activityTypes, onRefresh }) {
  document.querySelector('.av2-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'av2-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'av2-modal av2-modal--form';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  const modalHeader = document.createElement('div');
  modalHeader.className = 'av2-modal__header';
  const modalTitle = document.createElement('h2');
  modalTitle.className = 'av2-modal__title';
  modalTitle.textContent = `עריכת דיווח — ${formatDateHeb(record.report_date)}`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'av2-btn av2-btn--icon';
  closeBtn.setAttribute('aria-label', 'סגירה');
  closeBtn.append(createIcon('x'));
  closeBtn.addEventListener('click', () => overlay.remove());
  modalHeader.append(modalTitle, closeBtn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  const typeOptions = activityTypes.length ? activityTypes : ['ביטול זמן','הכשרה','חדר בריחה','זום','סדנה','סיור','קורס','תפעול'];

  const form = document.createElement('form');
  form.className = 'av2-report__form';
  form.noValidate = true;

  function sectionTitle(text) {
    const el = document.createElement('div');
    el.className = 'av2-form-section-title av2-field--full';
    el.textContent = text;
    return el;
  }

  form.append(sectionTitle('פעילות'));

  const reportDateField = createInputField({ id: 'edit-report-date', label: 'תאריך', type: 'date', value: String(record.report_date || '').slice(0, 10), attrs: { max: latestReportDate() } });

  const actNameField = createInputField({ id: 'edit-activity-name', label: 'שם פעילות', value: record.activity_name_snapshot || '', placeholder: 'שם התוכנית' });
  actNameField.wrap.classList.add('av2-field--full');
  const typeOpts = [{ value: '', label: 'בחר' }, ...typeOptions.map(t => typeof t === 'string' ? { value: t, label: t } : t)];
  const typeField = createSelectField({ id: 'edit-type', label: 'סוג פעילות', options: typeOpts, value: '' });
  typeField.input.value = record.activity_type || '';
  const meetField = createInputField({ id: 'edit-meeting', label: 'מפגש מס\'', type: 'number', value: record.meeting_no != null ? String(record.meeting_no) : '', attrs: { min: '0', max: '50' } });

  form.append(reportDateField.wrap, actNameField.wrap, typeField.wrap, meetField.wrap);

  const teamModeField = createSelectField({
    id: 'edit-team-meeting-mode',
    label: 'אופן מפגש צוות *',
    options: [
      { value: '', label: 'בחר אופן מפגש…' },
      { value: 'online', label: 'זום' },
      { value: 'physical', label: 'מפגש פיזי' },
    ],
    value: record.operation_meeting_mode || '',
  });
  const teamLocationField = createInputField({
    id: 'edit-team-location',
    label: 'מיקום פיזי *',
    placeholder: 'כתובת המפגש',
    value: record.operation_meeting_mode === 'physical'
      ? String(record.destination_address_snapshot || '') : '',
  });
  const knownLocations = document.createElement('datalist');
  knownLocations.id = 'edit-team-known-locations';
  teamLocationField.input.setAttribute('list', knownLocations.id);
  teamLocationField.wrap.append(knownLocations);
  void getOperationOptions().then((operations) => {
    [...new Set(operations.map((item) => String(item.address || '').trim()).filter(Boolean))]
      .forEach((address) => {
        const option = document.createElement('option');
        option.value = address;
        knownLocations.append(option);
      });
  }).catch(() => {}); // Manual entry remains available if the catalog is offline.
  form.append(teamModeField.wrap, teamLocationField.wrap);

  const authField   = createInputField({ id: 'edit-authority', label: 'רשות',    value: record.authority_name_snapshot || '' });
  const schoolField = createInputField({ id: 'edit-school',    label: 'בית ספר', value: record.school_name_snapshot || '' });
  const virtualLocationInfo = document.createElement('div');
  virtualLocationInfo.className = 'av2-field av2-report__virtual-location';
  virtualLocationInfo.textContent = 'מיקום: זום — אין צורך בכתובת, רשות או בית ספר';
  virtualLocationInfo.hidden = true;
  form.append(authField.wrap, schoolField.wrap, virtualLocationInfo);

  form.append(sectionTitle('זמן ונסיעות'));

  const startTimeField = createTimePicker('edit-start-time', 'שעת התחלה', record.start_time || '', 1);
  const endTimeField   = createTimePicker('edit-end-time',   'שעת סיום',  record.end_time   || '', 1);

  const hoursDisplay = document.createElement('div');
  hoursDisplay.className = 'av2-report__hours-display av2-field--full';
  const hoursLabel = document.createElement('span');
  hoursLabel.className = 'av2-report__hours-label';
  hoursLabel.textContent = 'סה״כ שעות:';
  const hoursValue = document.createElement('span');
  hoursValue.className = 'av2-report__hours-value';
  function updateHours() {
    const h = calcHours(startTimeField.getValue(), endTimeField.getValue());
    hoursValue.textContent = h > 0 ? formatDurationHours(h) : '—';
  }
  startTimeField.hourSel.addEventListener('change', updateHours);
  startTimeField.minSel.addEventListener('change', updateHours);
  endTimeField.hourSel.addEventListener('change', updateHours);
  endTimeField.minSel.addEventListener('change', updateHours);
  updateHours();
  hoursDisplay.append(hoursLabel, hoursValue);
  form.append(startTimeField.wrap, endTimeField.wrap, hoursDisplay);

  const kmField  = createInputField({ id: 'edit-km', label: 'ק״מ הלוך־חזור (יש להזין 0 אם אין)', type: 'number', value: record.roundtrip_km != null ? String(record.roundtrip_km) : '', attrs: { min: '0', step: '1', placeholder: 'יש להזין מספר' } });
  const expField = createInputField({ id: 'edit-expenses', label: 'הוצאות (₪)', type: 'number', value: String(record.expenses || 0), attrs: { min: '0', step: '0.01' } });
  const publicTransportWrap = document.createElement('label');
  publicTransportWrap.className = 'av2-report__transport-toggle';
  const publicTransportToggle = document.createElement('input');
  publicTransportToggle.id = 'edit-public-transport';
  publicTransportToggle.type = 'checkbox';
  publicTransportToggle.checked = record.public_transport === true;
  publicTransportWrap.append(publicTransportToggle, document.createTextNode('תחבורה ציבורית'));
  const publicTransportCostField = createInputField({
    id: 'edit-public-transport-cost', label: 'עלות תחבורה ציבורית (₪)',
    type: 'number', value: String(record.public_transport_cost || 0),
    attrs: { min: '0', step: '0.01' },
  });
  form.append(publicTransportWrap, kmField.wrap, publicTransportCostField.wrap);
  if(record.report_date<'2026-11-01')form.append(expField.wrap);
  const cancellationWrap = document.createElement('label');
  cancellationWrap.className = 'av2-report__transport-toggle av2-report__inline-cancellation-toggle';
  const cancellationToggle = document.createElement('input');
  cancellationToggle.type = 'checkbox';
  cancellationToggle.id = 'edit-has-cancellation';
  cancellationToggle.checked = record.cancellation_before_minutes != null
    && record.cancellation_after_minutes != null;
  cancellationWrap.append(cancellationToggle, document.createTextNode('הוספת ביטול זמן'));
  const beforeCancellationField = createInputField({
    id: 'edit-cancellation-before', label: 'ביטול זמן לפני הפעילות (שעות:דקות)',
    value: formatCancellationDuration(record.cancellation_before_minutes),
    placeholder: '0:00',
  });
  const afterCancellationField = createInputField({
    id: 'edit-cancellation-after', label: 'ביטול זמן אחרי הפעילות (שעות:דקות)',
    value: formatCancellationDuration(record.cancellation_after_minutes),
    placeholder: '0:00',
  });
  for (const field of [beforeCancellationField, afterCancellationField]) {
    field.input.addEventListener('change', () => {
      const minutes = parseCancellationDuration(field.input.value);
      if (minutes !== null) field.input.value = formatCancellationDuration(minutes);
    });
  }
  const cancellationFields = document.createElement('div');
  cancellationFields.className = 'av2-report__time-cancellation av2-report__inline-cancellation';
  const cancellationNote = document.createElement('small');
  cancellationNote.textContent = 'ביטול הזמן נבדק בנפרד ואינו משנה את שעות הפעילות.';
  cancellationFields.append(beforeCancellationField.wrap, afterCancellationField.wrap, cancellationNote);
  form.append(cancellationWrap, cancellationFields);

  const trainingModeField = createSelectField({
    id: 'edit-training-mode',
    label: 'אופן ההכשרה',
    options: [{ value: 'physical', label: 'פרונטלי' }, { value: 'online', label: 'מקוון' }],
    value: record.training_mode === 'online' ? 'online' : 'physical',
  });
  form.insertBefore(trainingModeField.wrap, authField.wrap);
  const trainingLocationField = createInputField({
    id: 'edit-training-location', label: 'מיקום ההכשרה *',
    placeholder: 'בחר מיקום או הקלד כתובת מלאה',
    value: String(record.destination_address_snapshot || record.authority_name_snapshot || ''),
  });
  const knownTrainingLocations = document.createElement('datalist');
  knownTrainingLocations.id = 'edit-training-known-locations';
  const defaultLocation = document.createElement('option');
  defaultLocation.value = 'Greenwork, יקום';
  knownTrainingLocations.append(defaultLocation);
  trainingLocationField.input.setAttribute('list', knownTrainingLocations.id);
  trainingLocationField.wrap.append(knownTrainingLocations);
  form.insertBefore(trainingLocationField.wrap, authField.wrap);

  const hasTrainingSchedule = Boolean(record.training_schedule_id);
  if (hasTrainingSchedule) {
    reportDateField.input.disabled = true;
    typeField.input.disabled = true;
    actNameField.input.readOnly = true;
    trainingModeField.input.disabled = true;
    trainingLocationField.input.readOnly = true;
  }

  let kmBeforeZoom = record.activity_type === ONLINE_REPORT_TYPE ? '' : kmField.input.value;
  function syncEditTypeUi() {
    const reportType = typeField.input.value;
    const isOperations = reportType === OPERATIONS_REPORT_TYPE;
    const isTeam = isOperations && actNameField.input.value.trim() === 'צוות';
    const isTeamZoom = isTeam && teamModeField.input.value === 'online';
    teamModeField.wrap.hidden = !isTeam;
    teamLocationField.wrap.hidden = !isTeam || teamModeField.input.value !== 'physical';
    const isZoom = isZoomLocationReport({
      activityType: reportType,
      trainingMode: trainingModeField.input.value,
      operationMeetingMode: isTeam ? teamModeField.input.value : '',
      operationName: isOperations ? actNameField.input.value.trim() : '',
    });
    virtualLocationInfo.hidden = !isZoom;
    const isCourse = reportType === COURSE_REPORT_TYPE;
    const isBaseTraining = reportType === 'הכשרה' && actNameField.input.value.trim() === 'הכשרת בסיס';
    const isOnlineTraining = reportType === 'הכשרה' && trainingModeField.input.value === 'online';
    const isScheduledTraining = reportType === 'הכשרה' && hasTrainingSchedule;

    const activityLabel = actNameField.wrap.querySelector('.av2-field__label');
    if (activityLabel) activityLabel.textContent = isOperations ? 'פרטי תפעול *' : 'שם פעילות';
    const authorityLabel = authField.wrap.querySelector('.av2-field__label');
    if (authorityLabel) authorityLabel.textContent = isScheduledTraining ? 'מיקום ההכשרה' : 'רשות';
    actNameField.input.placeholder = isOperations
      ? 'לדוגמה: פגישת צוות, הכנת ציוד או עבודה תפעולית'
      : 'שם התוכנית';

    meetField.wrap.hidden = !isCourse || record.course_dashboard_sources?.length > 1;
    if (!isCourse) meetField.input.value = '';
    trainingModeField.wrap.hidden = reportType !== 'הכשרה';
    trainingModeField.input.disabled = isScheduledTraining;
    authField.wrap.hidden = isOperations || reportType === 'הכשרה' || isZoom;
    authField.input.disabled = isScheduledTraining || reportType === 'הכשרה';
    schoolField.wrap.hidden = isOperations || reportType === 'הכשרה' || isZoom;
    trainingLocationField.wrap.hidden = reportType !== 'הכשרה' || isOnlineTraining;
    const isDailyTravel=reportDateField.input.value >= '2026-11-01';
    const eligibleCancellation = !isDailyTravel && canReportInlineCancellation({ activityType: reportType, online: isZoom });
    cancellationWrap.hidden = !eligibleCancellation;
    if (!eligibleCancellation) cancellationToggle.checked = false;
    cancellationFields.hidden = !eligibleCancellation || !cancellationToggle.checked;
    publicTransportWrap.hidden = isZoom || isDailyTravel;
    publicTransportToggle.disabled = isZoom || isDailyTravel;
    if (isZoom || isDailyTravel) publicTransportToggle.checked = false;
    const usesTransport = !isZoom && !isDailyTravel && publicTransportToggle.checked;
    publicTransportCostField.wrap.hidden = isDailyTravel || !usesTransport;
    publicTransportCostField.input.disabled = !usesTransport;
    kmField.wrap.hidden = isZoom || usesTransport || isDailyTravel;

    if (isZoom || isOnlineTraining || usesTransport || isDailyTravel) {
      if (!kmField.input.disabled) kmBeforeZoom = kmField.input.value;
      kmField.input.value = '0';
      kmField.input.readOnly = true;
      kmField.input.disabled = true;
    } else {
      const wasDisabled = kmField.input.disabled;
      kmField.input.readOnly = false;
      kmField.input.disabled = false;
      if (wasDisabled) kmField.input.value = kmBeforeZoom;
    }
  }
  reportDateField.input.addEventListener('change', syncEditTypeUi);
  typeField.input.addEventListener('change', syncEditTypeUi);
  teamModeField.input.addEventListener('change', syncEditTypeUi);
  trainingModeField.input.addEventListener('change', syncEditTypeUi);
  publicTransportToggle.addEventListener('change', syncEditTypeUi);
  cancellationToggle.addEventListener('change', syncEditTypeUi);
  actNameField.input.addEventListener('input', syncEditTypeUi);
  syncEditTypeUi();

  form.append(sectionTitle('מידע נוסף'));
  const expDField  = createInputField({ id: 'edit-exp-detail', label: 'פירוט הוצאות', value: record.expense_details || '' });
  const notesField = createInputField({ id: 'edit-notes',      label: 'הערות',        value: record.notes || '' });
  expDField.wrap.classList.add('av2-field--full');
  notesField.wrap.classList.add('av2-field--full');
  if(record.report_date<'2026-11-01')form.append(expDField.wrap);
  form.append(notesField.wrap);

  const errorEl = document.createElement('p');
  errorEl.className = 'av2-report__error av2-field--full';
  errorEl.hidden = true;
  form.append(errorEl);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'av2-btn av2-btn--primary av2-field--full';
  const saveBtnLabel = document.createElement('span');
  saveBtnLabel.textContent = 'שמירת שינויים';
  saveBtn.append(createIcon('check', { size: 15 }), saveBtnLabel);
  form.append(saveBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    if (reportDateField.input.value > latestReportDate()) {
      errorEl.textContent = 'לא ניתן לדווח נוכחות עבור תאריך עתידי.';
      errorEl.hidden = false;
      reportDateField.input.focus();
      return;
    }

    const startTime  = startTimeField.getValue();
    const endTime    = endTimeField.getValue();
    const totalHours = record.course_business_identity && typeField.input.value === COURSE_REPORT_TYPE
      ? Number(record.total_hours) : calcHours(startTime, endTime);
    const reportType = typeField.input.value;
    const isOperations = reportType === OPERATIONS_REPORT_TYPE;
    const isTeam = isOperations && actNameField.input.value.trim() === 'צוות';
    const isTeamZoom = isTeam && teamModeField.input.value === 'online';
    const isZoom = isZoomLocationReport({
      activityType: reportType,
      trainingMode: trainingModeField.input.value,
      operationMeetingMode: isTeam ? teamModeField.input.value : '',
      operationName: isOperations ? actNameField.input.value.trim() : '',
    });
    const isCourse = reportType === COURSE_REPORT_TYPE;
    const isBaseTraining = reportType === 'הכשרה' && actNameField.input.value.trim() === 'הכשרת בסיס';
    const isOnlineTraining = reportType === 'הכשרה' && trainingModeField.input.value === 'online';
    const isScheduledTraining = reportType === 'הכשרה' && hasTrainingSchedule;

    if (isBaseTraining && !isBaseTrainingAllowedDate(reportDateField.input.value)) {
      errorEl.textContent = 'הכשרת בסיס ניתנת לדיווח רק בתאריכים 15–17.09.2026. יש לתקן את סוג/שם הפעילות לפני השמירה.';
      errorEl.hidden = false;
      return;
    }

    const missing = [];
    let kmValue = reportedKilometers(kmField.input.value, {
      online: isZoom, publicTransport: publicTransportToggle.checked, activityType: reportType,
    });
    if (reportDateField.input.value < '2026-11-01' && kmValue == null) missing.push('קילומטרים לדיווח, או 0 אם אין');
    if (reportDateField.input.value >= '2026-11-01') kmValue = 0;
    if (!startTime || !endTime) missing.push('שעות');
    if (startTime && endTime && totalHours <= 0) missing.push('שעת סיום חייבת להיות מאוחרת מהתחלה');
    if (!reportType) missing.push('סוג פעילות');
    if (!actNameField.input.value.trim()) missing.push(isOperations ? 'פרטי תפעול' : 'שם פעילות');
    if (isTeam && !['online', 'physical'].includes(teamModeField.input.value)) missing.push('אופן מפגש צוות');
    if (isTeam && teamModeField.input.value === 'physical' && !teamLocationField.input.value.trim()) missing.push('מיקום פיזי');
    if (reportType === 'הכשרה' && !isZoom && !trainingLocationField.input.value.trim()) missing.push('מיקום ההכשרה');
    if (!isOperations && reportType !== 'הכשרה' && !isZoom && !authField.input.value.trim()) missing.push('רשות');
    if (cancellationToggle.checked && parseCancellationDuration(beforeCancellationField.input.value) == null) missing.push('ביטול זמן לפני הפעילות (שעות:דקות)');
    if (cancellationToggle.checked && parseCancellationDuration(afterCancellationField.input.value) == null) missing.push('ביטול זמן אחרי הפעילות (שעות:דקות)');
    if (missing.length) {
      errorEl.textContent = `שדות חובה: ${missing.join(' · ')}`;
      errorEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtnLabel.textContent = 'שומר…';

    try {
      await updateRecord(record.id, instructor.empId, {
        report_date:             reportDateField.input.value,
        start_time:              startTime,
        end_time:                endTime,
        total_hours:             totalHours,
        course_business_identity: isCourse ? record.course_business_identity ?? null : null,
        activity_type:           reportType,
        operation_meeting_mode: isTeam ? teamModeField.input.value : null,
        destination_address_snapshot: isTeam && !isTeamZoom
          ? teamLocationField.input.value.trim()
          : (reportType === 'הכשרה' && !isZoom ? trainingLocationField.input.value.trim() : null),
        training_mode:           reportType === 'הכשרה' ? (isOnlineTraining ? 'online' : 'physical') : null,
        training_schedule_id:    reportType === 'הכשרה' ? (record.training_schedule_id ?? null) : null,
        activity_id:             isOperations || isBaseTraining || isScheduledTraining ? null : (record.activity_id ?? null),
        activity_row_id:         isOperations || isBaseTraining || isScheduledTraining ? null : (record.activity_row_id ?? null),
        activity_no:             isOperations || isBaseTraining ? null : (record.activity_no ?? null),
        activity_season:         isOperations || isBaseTraining ? null : (record.activity_season ?? null),
        activity_name_snapshot:  actNameField.input.value.trim() || null,
        authority_id:            isOperations || isBaseTraining || isZoom || isOnlineTraining || isScheduledTraining ? null : (record.authority_id ?? null),
        authority_name_snapshot: isOperations || isZoom
          ? null : (reportType === 'הכשרה' ? trainingLocationField.input.value.trim() : (authField.input.value.trim() || null)),
        school_id:               isOperations || isBaseTraining || isZoom || isOnlineTraining || isScheduledTraining ? null : (record.school_id ?? null),
        school_name_snapshot:    isOperations || isZoom || reportType === 'הכשרה' ? null : (schoolField.input.value.trim() || null),
        semel_mosad:             isOperations || isBaseTraining || isZoom || isOnlineTraining || isScheduledTraining ? null : (record.semel_mosad ?? null),
        meeting_no:              isCourse && meetField.input.value ? Number(meetField.input.value) : null,
        program_name:            isOperations || isBaseTraining ? null : (record.program_name ?? null),
        cancellation_before_minutes: reportDateField.input.value < '2026-11-01' && cancellationToggle.checked ? cancellationMinutesForSave(beforeCancellationField.input.value, record, 'cancellation_before_minutes') : null,
        cancellation_after_minutes:  reportDateField.input.value < '2026-11-01' && cancellationToggle.checked ? cancellationMinutesForSave(afterCancellationField.input.value, record, 'cancellation_after_minutes') : null,
        roundtrip_km:            kmValue,
        public_transport:        !isZoom && publicTransportToggle.checked,
        public_transport_cost:   !isZoom && publicTransportToggle.checked ? Number(publicTransportCostField.input.value || 0) : 0,
        expenses:                reportDateField.input.value >= '2026-11-01' ? 0 : (expField.input.value ? Number(expField.input.value) : 0),
        expense_details:         reportDateField.input.value >= '2026-11-01' ? null : (expDField.input.value.trim() || null),
        notes:                   notesField.input.value.trim() || null
      });
      overlay.remove();
      onRefresh();
      if(reportDateField.input.value < '2026-11-01') void reconcileTravelCompensation(record.id).then(() => onRefresh()).catch(() => null);
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      saveBtn.disabled = false;
      saveBtnLabel.textContent = 'שמירת שינויים';
    }
  });

  modal.append(modalHeader, form);
  overlay.append(modal);
  document.body.append(overlay);
  startTimeField.hourSel.focus();
}

// ── Attachments viewer ──────────────────────────────────────────────────────────

async function viewExpense(record) {
  document.querySelector('.av2-modal-overlay')?.remove();
  const attachments = record.attendance_record_attachments || [];
  const amount = Number(record.expenses || 0);
  const detail = String(record.expense_details || '').trim();
  const overlay = document.createElement('div');
  overlay.className = 'av2-modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'av2-modal av2-modal--expense';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const mh = document.createElement('div');
  mh.className = 'av2-modal__header';
  const mt = document.createElement('h2');
  mt.className = 'av2-modal__title';
  mt.textContent = 'הוצאות';
  const cb = document.createElement('button');
  cb.type = 'button';
  cb.className = 'av2-btn av2-btn--icon';
  cb.setAttribute('aria-label', 'סגירת חלון הוצאות');
  cb.append(createIcon('x'));
  cb.addEventListener('click', () => overlay.remove());
  mh.append(mt, cb);
  const list = document.createElement('div');
  list.className = 'av2-expense-modal__body';
  const summary = document.createElement('div');
  summary.className = 'av2-expense-modal__summary';
  const amountRow = document.createElement('div');
  amountRow.className = 'av2-expense-modal__field';
  const amountLabel = document.createElement('span');
  amountLabel.className = 'av2-expense-modal__label';
  amountLabel.textContent = 'סכום';
  const amountValue = document.createElement('strong');
  amountValue.className = 'av2-expense-modal__amount';
  amountValue.textContent = `${amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪`;
  amountRow.append(amountLabel, amountValue);
  summary.append(amountRow);
  if (detail) {
    const detailRow = document.createElement('div');
    detailRow.className = 'av2-expense-modal__field';
    const detailLabel = document.createElement('span');
    detailLabel.className = 'av2-expense-modal__label';
    detailLabel.textContent = 'פירוט';
    const detailValue = document.createElement('span');
    detailValue.className = 'av2-expense-modal__value';
    detailValue.textContent = detail;
    detailRow.append(detailLabel, detailValue);
    summary.append(detailRow);
  }
  list.append(summary);
  const attachmentSection = document.createElement('section');
  attachmentSection.className = 'av2-expense-modal__attachments';
  const attachmentHeading = document.createElement('strong');
  attachmentHeading.className = 'av2-expense-modal__attachments-title';
  attachmentHeading.textContent = 'מסמכים מצורפים';
  attachmentSection.append(attachmentHeading);
  list.append(attachmentSection);
  modal.append(mh, list);
  overlay.append(modal);
  document.body.append(overlay);
  if (!attachments.length) {
    const empty = document.createElement('p');
    empty.className = 'av2-expense-modal__empty';
    empty.textContent = 'אין מסמכים מצורפים.';
    attachmentSection.append(empty);
    return;
  }
  for (const att of attachments) {
    const row = document.createElement('div');
    row.className = 'av2-expense-modal__document';
    try {
      const url = await getSignedUrl(att.storage_path);
      const link = document.createElement('a');
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = att.file_name;
      row.append(createIcon('paperclip', { size: 14 }), link);
    } catch {
      row.textContent = att.file_name + ' (שגיאה)';
    }
    attachmentSection.append(row);
  }
}

// ── Month navigator ─────────────────────────────────────────────────────────────

function buildMonthNav(year, month, onPrev, onNext) {
  const nav = document.createElement('div');
  nav.className = 'av2-month-nav';
  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'av2-btn av2-btn--icon av2-month-nav__btn';
  prevBtn.setAttribute('aria-label', 'חודש קודם');
  prevBtn.append(createIcon('chevron-right'));
  prevBtn.addEventListener('click', () => onPrev?.());
  const label = document.createElement('span');
  label.className = 'av2-month-nav__label';
  label.textContent = formatMonthLabel(year, month);
  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'av2-btn av2-btn--icon av2-month-nav__btn';
  nextBtn.setAttribute('aria-label', 'חודש הבא');
  const now = new Date();
  if (year >= now.getFullYear() && month >= now.getMonth() + 1) {
    nextBtn.disabled = true; nextBtn.style.opacity = '0.3';
  }
  nextBtn.append(createIcon('chevron-left'));
  nextBtn.addEventListener('click', () => onNext?.());
  nav.append(prevBtn, label, nextBtn);
  return nav;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function formatDateHeb(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
}

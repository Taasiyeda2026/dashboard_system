/**
 * my-reports-screen.js  —  Calendar + full report table
 *
 * Calendar: premium, shows activity summaries in day cells, TODAY highlighted.
 * Table:    11 columns — date, start, end, hours, activity type, activity name,
 *           school, authority, km, expenses, actions.
 * Sort:     date DESC, then start_time ASC within the same date.
 * Actions:  copy (blue), duplicate (purple), delete (red).
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { createTimePicker } from '../components/time-picker.js';
import { createMiniCalendar } from '../components/mini-calendar.js';
import { getMonthRecords, calcMonthSummary, updateRecord, deleteRecord,
         getMonthApproval, getActivityTypes, deleteAttachmentRecord } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel } from '../services/month-gate.service.js';
import { calcHours, ONLINE_REPORT_TYPE, OPERATIONS_REPORT_TYPE } from '../services/activities.service.js';
import { deleteAttachment, getSignedUrl } from '../services/storage.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

const COURSE_REPORT_TYPE = 'קורס';


export function renderMyReportsScreen(container, {
  instructor = {},
  year,
  month,
  onBack,
  onPrevMonth,
  onNextMonth,
  onNewReport,
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

  loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onDuplicate });
}

async function loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onDuplicate }) {
  const monthKey = getMonthKey(year, month);

  try {
    const [records, approval, activityTypes] = await Promise.all([
      getMonthRecords(instructor.empId, year, month),
      getMonthApproval(instructor.empId, monthKey),
      getActivityTypes()
    ]);

    const editable = canEditMonth(year, month, approval);
    const summary  = calcMonthSummary(records);

    contentArea.innerHTML = '';

    const onRefresh = () => loadAndRender({ instructor, year, month, contentArea, toolbar, onNewReport, onDuplicate });

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

    if (records.length > 0) {
      const xlBtn = document.createElement('button');
      xlBtn.type = 'button';
      xlBtn.className = 'av2-btn av2-btn--secondary';
      xlBtn.append(createIcon('download', { size: 15 }));
      const xlLabel = document.createElement('span');
      xlLabel.textContent = 'Excel';
      xlBtn.append(xlLabel);
      xlBtn.addEventListener('click', () => exportMonthToExcel(records, instructor, year, month));
      toolbar.append(xlBtn);
    }

    // ── Calendar ─────────────────────────────────────────────────────────
    let selectedDate = null;
    const rowEntries = [];

    const filterBar = document.createElement('div');
    filterBar.className = 'av2-reports__day-filter';
    filterBar.hidden = true;
    const filterText = document.createElement('span');
    const filterClearBtn = document.createElement('button');
    filterClearBtn.type = 'button';
    filterClearBtn.className = 'av2-btn av2-btn--link';
    filterClearBtn.textContent = 'כל החודש';
    filterBar.append(filterText, filterClearBtn);

    function applyFilter() {
      for (const { row, reportDate } of rowEntries) {
        row.hidden = selectedDate ? reportDate !== selectedDate : false;
      }
      filterBar.hidden = !selectedDate;
      filterText.textContent = selectedDate ? `דיווחים ליום ${formatDateHeb(selectedDate)}` : '';
    }

    const { wrap: calWrap, clearSelection } = createMiniCalendar({
      year, month, records,
      onDayClick: (dateStr) => { selectedDate = dateStr; applyFilter(); },
      onEmptyDayClick: editable ? () => onNewReport?.() : undefined
    });

    filterClearBtn.addEventListener('click', () => {
      selectedDate = null;
      clearSelection();
      applyFilter();
    });

    const calContainer = document.createElement('div');
    calContainer.className = 'av2-reports__calendar-wrap';
    calContainer.append(calWrap);
    contentArea.append(calContainer, filterBar);

    // ── Empty state ───────────────────────────────────────────────────────
    if (!records.length) {
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
    const sorted = [...records].sort((a, b) => {
      const dc = String(b.report_date).localeCompare(String(a.report_date));
      if (dc !== 0) return dc;
      return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });

    // ── Table ─────────────────────────────────────────────────────────────
    const listWrap = document.createElement('div');
    listWrap.className = 'av2-report-list';

    // Table header
    const listHead = document.createElement('div');
    listHead.className = 'av2-report-list__head';
    const colLabels = ['תאריך', 'התחלה', 'סיום', 'שעות', 'סוג', 'שם פעילות', 'בית ספר', 'רשות', 'ק״מ', 'הוצאות', 'פעולות'];
    for (const label of colLabels) {
      const cell = document.createElement('span');
      cell.textContent = label;
      listHead.append(cell);
    }
    listWrap.append(listHead);

    for (const record of sorted) {
      const row = buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh });
      row.dataset.reportDate = record.report_date;
      rowEntries.push({ row, reportDate: record.report_date });
      listWrap.append(row);
    }

    // ── Totals row ────────────────────────────────────────────────────────
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

  } catch (err) {
    contentArea.innerHTML = `<p class="av2-error">שגיאה בטעינת נתונים: ${err.message}</p>`;
  }
}

// ── Record row (11 columns on desktop) ────────────────────────────────────────

function buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh }) {
  const row = document.createElement('div');
  row.className = 'av2-report-row';
  row.dataset.recordId = record.id;

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
  hoursCell.textContent = Number(record.total_hours || 0).toFixed(2);

  // ── 5. Activity type ─────────────────────────────────────────────────────
  const typeCell = document.createElement('div');
  typeCell.className = 'av2-rr__type';
  typeCell.textContent = record.activity_type || '—';

  // ── 6. Activity name ─────────────────────────────────────────────────────
  const nameCell = document.createElement('div');
  nameCell.className = 'av2-rr__name';
  nameCell.textContent = record.activity_name_snapshot || '—';

  // ── 7. School ────────────────────────────────────────────────────────────
  const schoolCell = document.createElement('div');
  schoolCell.className = 'av2-rr__school';
  schoolCell.textContent = record.school_name_snapshot || '—';

  // ── 8. Authority ─────────────────────────────────────────────────────────
  const authCell = document.createElement('div');
  authCell.className = 'av2-rr__authority';
  authCell.textContent = record.authority_name_snapshot || '—';

  // ── 9. KM ────────────────────────────────────────────────────────────────
  const kmCell = document.createElement('div');
  kmCell.className = 'av2-rr__km';
  kmCell.textContent = Number(record.roundtrip_km || 0).toFixed(0);

  // ── 10. Expenses ─────────────────────────────────────────────────────────
  const expCell = document.createElement('div');
  expCell.className = 'av2-rr__expenses';
  const expenseAmount = Number(record.expenses || 0);
  if (expenseAmount > 0) {
    const expenseLabel = `הוצאות: ${expenseAmount.toLocaleString('he-IL', { maximumFractionDigits: 2 })} ₪`;
    const expenseBtn = document.createElement('button');
    expenseBtn.type = 'button';
    expenseBtn.className = 'av2-rr__expense-indicator';
    expenseBtn.title = expenseLabel;
    expenseBtn.setAttribute('aria-label', expenseLabel);
    expenseBtn.dataset.tooltip = expenseLabel;
    expenseBtn.append(createIcon('receipt', { size: 15 }));
    expenseBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      expenseBtn.classList.toggle('is-revealed');
    });
    expenseBtn.addEventListener('blur', () => expenseBtn.classList.remove('is-revealed'));
    expCell.append(expenseBtn);
  }

  // ── 11. Actions ───────────────────────────────────────────────────────────
  const actionsCell = document.createElement('div');
  actionsCell.className = 'av2-rr__actions';

  // Copy to clipboard (blue)
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'av2-btn av2-btn--icon av2-rr__action-copy';
  copyBtn.setAttribute('aria-label', 'העתק פרטי דיווח');
  copyBtn.title = 'העתק פרטי דיווח';
  copyBtn.append(createIcon('copy', { size: 14 }));
  copyBtn.addEventListener('click', (e) => { e.stopPropagation(); handleCopy(record, copyBtn); });
  actionsCell.append(copyBtn);

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

  // Edit + Delete (only when editable)
  if (editable) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'av2-btn av2-btn--icon';
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
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete({ record, instructor, row, onRefresh }); });

    actionsCell.append(editBtn, deleteBtn);
  }

  // Attachment indicator
  if (record.attendance_record_attachments?.length) {
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'av2-btn av2-btn--icon';
    attachBtn.setAttribute('aria-label', `${record.attendance_record_attachments.length} קבצים`);
    attachBtn.title = 'קבצים מצורפים';
    attachBtn.append(createIcon('paperclip', { size: 13 }));
    attachBtn.addEventListener('click', (e) => { e.stopPropagation(); viewAttachments(record.attendance_record_attachments); });
    actionsCell.append(attachBtn);
  }

  row.append(dateCell, startCell, endCell, hoursCell, typeCell, nameCell, schoolCell, authCell, kmCell, expCell, actionsCell);

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
    Number(record.total_hours || 0).toFixed(2) + ' שעות',
    record.activity_name_snapshot || record.activity_type || '',
    record.school_name_snapshot || '',
    record.authority_name_snapshot || '',
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

async function handleDelete({ record, instructor, row, onRefresh }) {
  const dateStr = formatDateHeb(record.report_date);
  if (!confirm(`למחוק את הדיווח מתאריך ${dateStr}?\nפעולה זו אינה הפיכה.`)) return;

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
    onRefresh();
  } catch (err) {
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

  const actNameField = createInputField({ id: 'edit-activity-name', label: 'שם פעילות', value: record.activity_name_snapshot || '', placeholder: 'שם התוכנית' });
  actNameField.wrap.classList.add('av2-field--full');
  const typeOpts = [{ value: '', label: 'בחר' }, ...typeOptions.map(t => typeof t === 'string' ? { value: t, label: t } : t)];
  const typeField = createSelectField({ id: 'edit-type', label: 'סוג פעילות', options: typeOpts, value: '' });
  typeField.input.value = record.activity_type || '';
  const meetField = createInputField({ id: 'edit-meeting', label: 'מפגש מס\'', type: 'number', value: record.meeting_no != null ? String(record.meeting_no) : '', attrs: { min: '0', max: '50' } });

  form.append(actNameField.wrap, typeField.wrap, meetField.wrap);

  const authField   = createInputField({ id: 'edit-authority', label: 'רשות',    value: record.authority_name_snapshot || '' });
  const schoolField = createInputField({ id: 'edit-school',    label: 'בית ספר', value: record.school_name_snapshot || '' });
  form.append(authField.wrap, schoolField.wrap);

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
    hoursValue.textContent = h > 0 ? h.toFixed(2) : '—';
  }
  startTimeField.hourSel.addEventListener('change', updateHours);
  startTimeField.minSel.addEventListener('change', updateHours);
  endTimeField.hourSel.addEventListener('change', updateHours);
  endTimeField.minSel.addEventListener('change', updateHours);
  updateHours();
  hoursDisplay.append(hoursLabel, hoursValue);
  form.append(startTimeField.wrap, endTimeField.wrap, hoursDisplay);

  const kmField  = createInputField({ id: 'edit-km',       label: 'ק"מ הלוך-חזור', type: 'number', value: String(record.roundtrip_km || 0), attrs: { min: '0', step: '1' } });
  const expField = createInputField({ id: 'edit-expenses', label: 'הוצאות (₪)',    type: 'number', value: String(record.expenses || 0),      attrs: { min: '0', step: '0.01' } });
  form.append(kmField.wrap, expField.wrap);

  let kmBeforeZoom = record.activity_type === ONLINE_REPORT_TYPE ? '' : kmField.input.value;
  function syncEditTypeUi() {
    const reportType = typeField.input.value;
    const isOperations = reportType === OPERATIONS_REPORT_TYPE;
    const isZoom = reportType === ONLINE_REPORT_TYPE;
    const isCourse = reportType === COURSE_REPORT_TYPE;

    const activityLabel = actNameField.wrap.querySelector('.av2-field__label');
    if (activityLabel) activityLabel.textContent = isOperations ? 'פרטי תפעול *' : 'שם פעילות';
    actNameField.input.placeholder = isOperations
      ? 'לדוגמה: פגישת צוות, הכנת ציוד או עבודה תפעולית'
      : 'שם התוכנית';

    meetField.wrap.hidden = !isCourse;
    if (!isCourse) meetField.input.value = '';
    authField.wrap.hidden = isOperations;
    schoolField.wrap.hidden = isOperations;

    if (isZoom) {
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
  typeField.input.addEventListener('change', syncEditTypeUi);
  syncEditTypeUi();

  form.append(sectionTitle('מידע נוסף'));
  const expDField  = createInputField({ id: 'edit-exp-detail', label: 'פירוט הוצאות', value: record.expense_details || '' });
  const notesField = createInputField({ id: 'edit-notes',      label: 'הערות',        value: record.notes || '' });
  expDField.wrap.classList.add('av2-field--full');
  notesField.wrap.classList.add('av2-field--full');
  form.append(expDField.wrap, notesField.wrap);

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

    const startTime  = startTimeField.getValue();
    const endTime    = endTimeField.getValue();
    const totalHours = calcHours(startTime, endTime);
    const reportType = typeField.input.value;
    const isOperations = reportType === OPERATIONS_REPORT_TYPE;
    const isZoom = reportType === ONLINE_REPORT_TYPE;
    const isCourse = reportType === COURSE_REPORT_TYPE;

    const missing = [];
    if (!startTime || !endTime) missing.push('שעות');
    if (startTime && endTime && totalHours <= 0) missing.push('שעת סיום חייבת להיות מאוחרת מהתחלה');
    if (!reportType) missing.push('סוג פעילות');
    if (!actNameField.input.value.trim()) missing.push(isOperations ? 'פרטי תפעול' : 'שם פעילות');
    if (!isOperations && !authField.input.value.trim()) missing.push('רשות');
    if (missing.length) {
      errorEl.textContent = `שדות חובה: ${missing.join(' · ')}`;
      errorEl.hidden = false;
      return;
    }

    saveBtn.disabled = true;
    saveBtnLabel.textContent = 'שומר…';

    try {
      await updateRecord(record.id, instructor.empId, {
        start_time:              startTime,
        end_time:                endTime,
        total_hours:             totalHours,
        activity_type:           reportType,
        activity_id:             isOperations ? null : (record.activity_id ?? null),
        activity_row_id:         isOperations ? null : (record.activity_row_id ?? null),
        activity_no:             isOperations ? null : (record.activity_no ?? null),
        activity_season:         isOperations ? null : (record.activity_season ?? null),
        activity_name_snapshot:  actNameField.input.value.trim() || null,
        authority_id:            isOperations ? null : (record.authority_id ?? null),
        authority_name_snapshot: isOperations ? null : (authField.input.value.trim() || null),
        school_id:               isOperations ? null : (record.school_id ?? null),
        school_name_snapshot:    isOperations ? null : (schoolField.input.value.trim() || null),
        semel_mosad:             isOperations ? null : (record.semel_mosad ?? null),
        meeting_no:              isCourse && meetField.input.value ? Number(meetField.input.value) : null,
        program_name:            isOperations ? null : (record.program_name ?? null),
        roundtrip_km:            isZoom ? 0 : (kmField.input.value ? Number(kmField.input.value) : 0),
        expenses:                expField.input.value ? Number(expField.input.value) : 0,
        expense_details:         expDField.input.value.trim() || null,
        notes:                   notesField.input.value.trim() || null
      });
      overlay.remove();
      onRefresh();
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

async function viewAttachments(attachments) {
  document.querySelector('.av2-modal-overlay')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'av2-modal-overlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const modal = document.createElement('div');
  modal.className = 'av2-modal';
  const mh = document.createElement('div');
  mh.className = 'av2-modal__header';
  const mt = document.createElement('h2');
  mt.className = 'av2-modal__title';
  mt.textContent = 'קבצים מצורפים';
  const cb = document.createElement('button');
  cb.type = 'button';
  cb.className = 'av2-btn av2-btn--icon';
  cb.append(createIcon('x'));
  cb.addEventListener('click', () => overlay.remove());
  mh.append(mt, cb);
  const list = document.createElement('div');
  list.className = 'av2-attach-list';
  list.innerHTML = '<p>טוען קישורים…</p>';
  modal.append(mh, list);
  overlay.append(modal);
  document.body.append(overlay);
  list.innerHTML = '';
  for (const att of attachments) {
    const row = document.createElement('div');
    row.className = 'av2-attach-item';
    try {
      const url = await getSignedUrl(att.storage_path);
      const link = document.createElement('a');
      link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = att.file_name;
      row.append(createIcon('paperclip', { size: 14 }), link);
    } catch {
      row.textContent = att.file_name + ' (שגיאה)';
    }
    list.append(row);
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

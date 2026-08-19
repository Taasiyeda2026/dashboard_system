/**
 * my-reports-screen.js  —  View / edit / delete monthly records
 *
 * Features:
 * - Month navigator (synced with app.js state)
 * - Compact calendar; clicking a day with records filters the list to that day
 * - Compact report rows (primary fields visible, secondary fields expandable)
 * - Edit modal (same field sections + shared time-picker as New Report)
 * - Delete with confirm
 * - Excel export
 * - Monthly approval status display
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { createTimePicker } from '../components/time-picker.js';
import { createMiniCalendar } from '../components/mini-calendar.js';
import { getMonthRecords, calcMonthSummary, updateRecord, deleteRecord,
         getMonthApproval, getActivityTypes, deleteAttachmentRecord } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel } from '../services/month-gate.service.js';
import { calcHours } from '../services/activities.service.js';
import { deleteAttachment, getSignedUrl } from '../services/storage.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

const DAY_NAMES_SHORT = ['א\'','ב\'','ג\'','ד\'','ה\'','ו\'','ש\''];

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

  // ── Month nav ──────────────────────────────────────────────────────────
  const monthNav = buildMonthNav(year, month, onPrevMonth, onNextMonth);

  // ── Loading area ───────────────────────────────────────────────────────
  const contentArea = document.createElement('div');
  contentArea.className = 'av2-reports__content';
  contentArea.innerHTML = '<p class="av2-reports__loading">טוען…</p>';

  inner.append(header, monthNav, contentArea);
  wrap.append(inner);
  container.append(wrap);

  // Load and render data
  loadAndRender({ instructor, year, month, contentArea, onNewReport, onDuplicate });
}

async function loadAndRender({ instructor, year, month, contentArea, onNewReport, onDuplicate }) {
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

    const onRefresh = () => loadAndRender({ instructor, year, month, contentArea, onNewReport, onDuplicate });

    // ── Status badge ──────────────────────────────────────────────────
    if (approval) {
      const statusMap = {
        submitted: ['אושר עובד / בבקרת מנהל','warning'],
        locked: ['אושר על ידי המנהל','success'],
        reopened: ['הוחזר לתיקון','neutral'],
        approved_for_payroll: ['אושר סופית','success']
      };
      const [statusLabel, tone] = statusMap[approval.status] || ['פתוח','neutral'];
      const badge = document.createElement('span');
      badge.className = `av2-badge av2-badge--${tone}`;
      badge.textContent = statusLabel;
      badge.style.marginBottom = '8px';
      badge.style.display = 'inline-block';
      contentArea.append(badge);
    }

    if (!editable) {
      const lockMsg = document.createElement('p');
      lockMsg.className = 'av2-reports__lock-msg';
      lockMsg.textContent = editBlockReason(year, month, approval);
      contentArea.append(lockMsg);
    }

    // ── Toolbar ────────────────────────────────────────────────────────
    const toolbar = document.createElement('div');
    toolbar.className = 'av2-reports__toolbar';

    if (editable) {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'av2-btn av2-btn--primary';
      addBtn.style.cssText = 'width:auto;align-self:flex-start;padding-inline:18px;';
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

    if (toolbar.children.length) contentArea.append(toolbar);

    // ── Calendar + day filter ────────────────────────────────────────────
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
      for (const row of rowEntries) {
        row.hidden = selectedDate ? row.dataset.reportDate !== selectedDate : false;
      }
      filterBar.hidden = !selectedDate;
      filterText.textContent = selectedDate ? `דיווחים ליום ${formatDateHeb(selectedDate)}` : '';
    }

    const { wrap: calWrap, clearSelection } = createMiniCalendar({
      year, month, records,
      onDayClick: (dateStr) => {
        selectedDate = dateStr;
        applyFilter();
      }
    });

    filterClearBtn.addEventListener('click', () => {
      selectedDate = null;
      clearSelection();
      applyFilter();
    });

    contentArea.append(calWrap, filterBar);

    // ── Records or empty state ─────────────────────────────────────────
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'av2-reports__empty';
      empty.textContent = `אין דיווחים לחודש ${formatMonthLabel(year, month)}.`;
      contentArea.append(empty);
      return;
    }

    // ── Report rows ────────────────────────────────────────────────────
    const listWrap = document.createElement('div');
    listWrap.className = 'av2-report-list';

    for (const record of records) {
      const row = buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh });
      row.dataset.reportDate = record.report_date;
      rowEntries.push(row);
      listWrap.append(row);
    }

    // ── Totals ─────────────────────────────────────────────────────────
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

// ── Record row ─────────────────────────────────────────────────────────────

function buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh }) {
  const row = document.createElement('div');
  row.className = 'av2-report-row';
  row.dataset.recordId = record.id;
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-expanded', 'false');

  const d = new Date(`${record.report_date}T12:00:00`);
  const dayName = Number.isNaN(d.getTime()) ? '' : DAY_NAMES_SHORT[d.getDay()];

  // ── Summary (always visible): date, activity, school, actual start/end, hours ──
  const summary = document.createElement('div');
  summary.className = 'av2-report-row__summary';

  const dateCol = document.createElement('div');
  dateCol.className = 'av2-report-row__date';
  const dateStrong = document.createElement('strong');
  dateStrong.textContent = formatDateHeb(record.report_date);
  const dateSpan = document.createElement('span');
  dateSpan.textContent = dayName;
  dateCol.append(dateStrong, dateSpan);

  const mainCol = document.createElement('div');
  mainCol.className = 'av2-report-row__main';
  const mainName = document.createElement('strong');
  mainName.textContent = record.activity_name_snapshot || record.activity_type || '—';
  const mainSchool = document.createElement('span');
  mainSchool.textContent = record.school_name_snapshot || record.authority_name_snapshot || '—';
  mainCol.append(mainName, mainSchool);

  const timeCol = document.createElement('div');
  timeCol.className = 'av2-report-row__time';
  const timeStrong = document.createElement('strong');
  timeStrong.textContent = `${formatTime(record.start_time)}–${formatTime(record.end_time)}`;
  const timeSpan = document.createElement('span');
  timeSpan.textContent = `${Number(record.total_hours || 0).toFixed(2)} שעות`;
  timeCol.append(timeStrong, timeSpan);

  const actionsCell = document.createElement('div');
  actionsCell.className = 'av2-report-row__actions';

  summary.append(dateCol, mainCol, timeCol, actionsCell);

  // ── Detail (expandable): authority, km, expenses, notes, attachments ──────
  const detail = document.createElement('div');
  detail.className = 'av2-report-row__detail';
  detail.hidden = true;
  detail.append(
    buildDetailField('רשות', record.authority_name_snapshot),
    buildDetailField('ק"מ', Number(record.roundtrip_km || 0).toFixed(0)),
    buildDetailField('הוצאות', '₪' + Number(record.expenses || 0).toFixed(2)),
    buildDetailField('הערות', record.notes)
  );
  if (record.attendance_record_attachments?.length) {
    detail.append(buildDetailField('קבצים מצורפים', `${record.attendance_record_attachments.length} קבצים`));
  }

  row.append(summary, detail);

  const toggle = () => {
    const expanded = detail.hidden;
    detail.hidden = !expanded;
    row.setAttribute('aria-expanded', String(expanded));
    row.classList.toggle('is-expanded', expanded);
  };
  row.addEventListener('click', (e) => { if (!e.target.closest('button,a')) toggle(); });
  row.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button,a')) { e.preventDefault(); toggle(); }
  });

  // ── Actions ────────────────────────────────────────────────────────────
  if (record.attendance_record_attachments?.length) {
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'av2-btn av2-btn--icon';
    attachBtn.setAttribute('aria-label', `${record.attendance_record_attachments.length} מסמכים`);
    attachBtn.append(createIcon('paperclip', { size: 14 }));
    attachBtn.addEventListener('click', (e) => { e.stopPropagation(); viewAttachments(record.attendance_record_attachments); });
    actionsCell.append(attachBtn);
  }

  // Duplicate — always available (not limited to editable months)
  if (onDuplicate) {
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'av2-btn av2-btn--icon';
    dupBtn.setAttribute('aria-label', 'שכפל דיווח');
    dupBtn.title = 'שכפל דיווח';
    dupBtn.append(createIcon('copy', { size: 14 }));
    dupBtn.addEventListener('click', (e) => { e.stopPropagation(); onDuplicate(record); });
    actionsCell.append(dupBtn);
  }

  if (editable) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'av2-btn av2-btn--icon';
    editBtn.setAttribute('aria-label', 'עריכה');
    editBtn.append(createIcon('edit', { size: 14 }));
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); showEditModal({ record, instructor, activityTypes, onRefresh }); });

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'av2-btn av2-btn--icon av2-btn--danger';
    deleteBtn.setAttribute('aria-label', 'מחיקה');
    deleteBtn.append(createIcon('trash', { size: 14 }));
    deleteBtn.addEventListener('click', (e) => { e.stopPropagation(); handleDelete({ record, instructor, row, onRefresh }); });

    actionsCell.append(editBtn, deleteBtn);
  }

  return row;
}

function buildDetailField(label, value) {
  const field = document.createElement('div');
  field.className = 'av2-report-row__detail-field';
  const l = document.createElement('span');
  l.textContent = label;
  const v = document.createElement('strong');
  v.textContent = value || '—';
  field.append(l, v);
  return field;
}

// ── Edit modal ─────────────────────────────────────────────────────────────
// Uses the same field-section grouping and the same shared time-picker as the
// New Report form (createTimePicker, .av2-report__form / .av2-form-section-title).

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

  const typeOptions = activityTypes.length ? activityTypes : ['קורס','סדנה','סיור','הכשרה','תפעול','ביטול זמן'];

  const form = document.createElement('form');
  form.className = 'av2-report__form';
  form.noValidate = true;

  function sectionTitle(text) {
    const el = document.createElement('div');
    el.className = 'av2-form-section-title av2-field--full';
    el.textContent = text;
    return el;
  }

  // ── פעילות ───────────────────────────────────────────────────────────
  form.append(sectionTitle('פעילות'));

  const actNameField = createInputField({ id: 'edit-activity-name', label: 'שם פעילות', value: record.activity_name_snapshot || '', placeholder: 'שם התוכנית או הפעילות' });
  actNameField.wrap.classList.add('av2-field--full');
  const typeOpts = [{ value: '', label: 'בחר' }, ...typeOptions.map(t => typeof t === 'string' ? { value: t, label: t } : t)];
  const typeField = createSelectField({ id: 'edit-type', label: 'סוג פעילות', options: typeOpts, value: '' });
  typeField.input.value = record.activity_type || '';
  const meetField = createInputField({ id: 'edit-meeting', label: 'מפגש מס\'', type: 'number', value: record.meeting_no != null ? String(record.meeting_no) : '', attrs: { min: '0', max: '50' } });

  form.append(actNameField.wrap, typeField.wrap, meetField.wrap);

  const authField   = createInputField({ id: 'edit-authority', label: 'רשות',    value: record.authority_name_snapshot || '' });
  const schoolField = createInputField({ id: 'edit-school',    label: 'בית ספר', value: record.school_name_snapshot || '' });
  form.append(authField.wrap, schoolField.wrap);

  // ── זמן ונסיעות ──────────────────────────────────────────────────────
  form.append(sectionTitle('זמן ונסיעות'));

  // minuteStep=1: edit must preserve exact stored minute values (unlike the
  // 5-minute-step New Report picker), so an untouched time never gets rounded.
  const startTimeField = createTimePicker('edit-start-time', 'שעת התחלה', record.start_time || '', 1);
  const endTimeField   = createTimePicker('edit-end-time',   'שעת סיום',  record.end_time || '', 1);

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

  // ── מידע נוסף ────────────────────────────────────────────────────────
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

    // ── Validation ──────────────────────────────────────────────────────
    const missing = [];
    if (!startTime || !endTime) missing.push('שעות');
    if (startTime && endTime && totalHours <= 0) missing.push('שעת סיום חייבת להיות מאוחרת מהתחלה');
    if (!typeField.input.value) missing.push('סוג פעילות');
    if (!actNameField.input.value.trim()) missing.push('שם פעילות');
    if (!authField.input.value.trim()) missing.push('רשות');
    if (missing.length) {
      errorEl.textContent = `שדות חובה: ${missing.join(' · ')}`;
      errorEl.hidden = false;
      if (!startTime || !endTime) startTimeField.hourSel.focus();
      else if (!typeField.input.value) typeField.input.focus();
      else if (!actNameField.input.value.trim()) actNameField.input.focus();
      else authField.input.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtnLabel.textContent = 'שומר…';

    try {
      await updateRecord(record.id, instructor.empId, {
        start_time:              startTime,
        end_time:                endTime,
        total_hours:             totalHours,
        activity_type:           typeField.input.value,
        activity_name_snapshot:  actNameField.input.value.trim() || null,
        authority_name_snapshot: authField.input.value.trim() || null,
        school_name_snapshot:    schoolField.input.value.trim() || null,
        meeting_no:              meetField.input.value ? Number(meetField.input.value) : null,
        roundtrip_km:            kmField.input.value ? Number(kmField.input.value) : 0,
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

// ── Delete ─────────────────────────────────────────────────────────────────

async function handleDelete({ record, instructor, row, onRefresh }) {
  const dateStr = formatDateHeb(record.report_date);
  if (!confirm(`למחוק את הדיווח מתאריך ${dateStr}?\nפעולה זו אינה הפיכה.`)) return;

  row.style.opacity = '0.5';
  try {
    // Delete storage files first
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

// ── Attachments viewer ─────────────────────────────────────────────────────

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
      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = att.file_name;
      row.append(createIcon('paperclip', { size: 14 }), link);
    } catch {
      row.textContent = att.file_name + ' (שגיאה בטעינת קישור)';
    }
    list.append(row);
  }
}

// ── Month navigator ────────────────────────────────────────────────────────

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
    nextBtn.disabled = true;
    nextBtn.style.opacity = '0.3';
  }
  nextBtn.append(createIcon('chevron-left'));
  nextBtn.addEventListener('click', () => onNext?.());

  nav.append(prevBtn, label, nextBtn);
  return nav;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDateHeb(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Strip seconds from a DB time string: 'HH:MM:SS' → 'HH:MM'. */
function formatTime(t) {
  if (!t) return '—';
  return String(t).slice(0, 5);
}

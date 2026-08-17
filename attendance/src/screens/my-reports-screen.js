/**
 * my-reports-screen.js  —  View / edit / delete monthly records
 *
 * Features:
 * - Month navigator (synced with app.js state)
 * - Mini calendar with dots for days that have records
 * - Horizontal-scrolling table: date | day | start | end | hours | type | school | authority | km | expenses | actions
 * - Month totals row
 * - Edit modal (full form, inline)
 * - Delete with confirm
 * - Excel export
 * - Monthly approval status display
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { getMonthRecords, calcMonthSummary, updateRecord, deleteRecord,
         getMonthApproval, getActivityTypes, deleteAttachmentRecord } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey, formatMonthLabel } from '../services/month-gate.service.js';
import { calcHours } from '../services/activities.service.js';
import { deleteAttachment, getSignedUrl } from '../services/storage.service.js';
import { exportMonthToExcel } from '../services/excel.service.js';

const DAY_NAMES_SHORT = ['א\'','ב\'','ג\'','ד\'','ה\'','ו\'','ש\''];
const DAY_NAMES_FULL  = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];

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

    // ── Status badge ──────────────────────────────────────────────────
    if (approval) {
      const statusMap = { submitted: ['ממתין לאישור','warning'], locked: ['נעול','success'], reopened: ['נפתח מחדש','neutral'] };
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

    // ── Mini calendar ─────────────────────────────────────────────────
    const calEl = buildMiniCalendar(year, month, records);
    contentArea.append(calEl);

    // ── Records or empty state ─────────────────────────────────────────
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'av2-reports__empty';
      empty.textContent = `אין דיווחים לחודש ${formatMonthLabel(year, month)}.`;
      contentArea.append(empty);
      return;
    }

    // ── Table ──────────────────────────────────────────────────────────
    const tableWrap = document.createElement('div');
    tableWrap.className = 'av2-reports__table-wrap';

    const table = document.createElement('table');
    table.className = 'av2-reports__table';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr>
      <th>תאריך</th><th>יום</th><th>התחלה</th><th>סיום</th><th>שעות</th>
      <th>סוג פעילות</th><th>שם פעילות</th><th>בית ספר</th><th>רשות</th><th>ק"מ</th><th>הוצאות</th>
      <th>פעולות</th>
    </tr>`;

    const tbody = document.createElement('tbody');

    for (const record of records) {
      const tr = buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh: () =>
        loadAndRender({ instructor, year, month, contentArea, onNewReport, onDuplicate })
      });
      tbody.append(tr);
    }

    // ── Totals row ─────────────────────────────────────────────────────
    const totalRow = document.createElement('tr');
    totalRow.className = 'av2-reports__total-row';
    totalRow.innerHTML = `
      <td colspan="4"><strong>סה"כ</strong></td>
      <td><strong>${summary.totalHours.toFixed(2)}</strong></td>
      <td colspan="4"></td>
      <td><strong>${summary.totalKm.toFixed(0)}</strong></td>
      <td><strong>${summary.totalExpenses.toFixed(2)}</strong></td>
      <td></td>
    `;
    tbody.append(totalRow);

    table.append(thead, tbody);
    tableWrap.append(table);
    contentArea.append(tableWrap);

  } catch (err) {
    contentArea.innerHTML = `<p class="av2-error">שגיאה בטעינת נתונים: ${err.message}</p>`;
  }
}

// ── Record row ─────────────────────────────────────────────────────────────

function buildRecordRow({ record, editable, instructor, activityTypes, onDuplicate, onRefresh }) {
  const tr = document.createElement('tr');
  tr.dataset.recordId = record.id;

  const d = new Date(record.report_date);
  const dayName = DAY_NAMES_SHORT[d.getDay()];

  tr.innerHTML = `
    <td>${formatDateHeb(record.report_date)}</td>
    <td>${dayName}</td>
    <td dir="ltr">${record.start_time || '—'}</td>
    <td dir="ltr">${record.end_time || '—'}</td>
    <td>${Number(record.total_hours || 0).toFixed(2)}</td>
    <td>${record.activity_type || '—'}</td>
    <td title="${record.activity_name_snapshot || ''}">${truncate(record.activity_name_snapshot, 16)}</td>
    <td title="${record.school_name_snapshot || ''}">${truncate(record.school_name_snapshot, 14)}</td>
    <td title="${record.authority_name_snapshot || ''}">${truncate(record.authority_name_snapshot, 12)}</td>
    <td>${Number(record.roundtrip_km || 0).toFixed(0)}</td>
    <td>${Number(record.expenses || 0).toFixed(0)}</td>
    <td></td>
  `;

  // Actions cell
  const actionsCell = tr.cells[tr.cells.length - 1];
  actionsCell.className = 'av2-reports__actions-cell';

  if (record.attendance_record_attachments?.length) {
    const attachBtn = document.createElement('button');
    attachBtn.type = 'button';
    attachBtn.className = 'av2-btn av2-btn--icon';
    attachBtn.setAttribute('aria-label', `${record.attendance_record_attachments.length} מסמכים`);
    attachBtn.append(createIcon('paperclip', { size: 14 }));
    attachBtn.addEventListener('click', () => viewAttachments(record.attendance_record_attachments));
    actionsCell.append(attachBtn);
  }

  if (record.notes) {
    const noteBtn = document.createElement('button');
    noteBtn.type = 'button';
    noteBtn.className = 'av2-btn av2-btn--icon';
    noteBtn.title = record.notes;
    noteBtn.append(createIcon('message-square', { size: 14 }));
    actionsCell.append(noteBtn);
  }

  // Duplicate — always available (not limited to editable months)
  if (onDuplicate) {
    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'av2-btn av2-btn--icon';
    dupBtn.setAttribute('aria-label', 'שכפל דיווח');
    dupBtn.title = 'שכפל דיווח';
    dupBtn.append(createIcon('copy', { size: 14 }));
    dupBtn.addEventListener('click', () => onDuplicate(record));
    actionsCell.append(dupBtn);
  }

  if (editable) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'av2-btn av2-btn--icon';
    editBtn.setAttribute('aria-label', 'עריכה');
    editBtn.append(createIcon('edit', { size: 14 }));
    editBtn.addEventListener('click', () => showEditModal({ record, instructor, activityTypes, onRefresh }));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'av2-btn av2-btn--icon av2-btn--danger';
    deleteBtn.setAttribute('aria-label', 'מחיקה');
    deleteBtn.append(createIcon('trash', { size: 14 }));
    deleteBtn.addEventListener('click', () => handleDelete({ record, instructor, tr, onRefresh }));

    actionsCell.append(editBtn, deleteBtn);
  }

  return tr;
}

// ── Edit modal ─────────────────────────────────────────────────────────────

function showEditModal({ record, instructor, activityTypes, onRefresh }) {
  // Remove any existing modal
  document.querySelector('.av2-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'av2-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'av2-modal';
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
  form.className = 'av2-modal__form';
  form.noValidate = true;

  const timeRow = document.createElement('div');
  timeRow.className = 'av2-report__time-row';
  const startTimeField = createInputField({ id: 'edit-start-time', label: 'שעת התחלה', type: 'time', value: record.start_time || '' });
  const endTimeField   = createInputField({ id: 'edit-end-time',   label: 'שעת סיום',  type: 'time', value: record.end_time || '' });
  const hoursDisplay = document.createElement('div');
  hoursDisplay.className = 'av2-report__hours-display';
  const hoursLabel = document.createElement('span');
  hoursLabel.className = 'av2-report__hours-label';
  hoursLabel.textContent = 'שעות:';
  const hoursValue = document.createElement('span');
  hoursValue.className = 'av2-report__hours-value';
  function updateHours() {
    const h = calcHours(startTimeField.input.value, endTimeField.input.value);
    hoursValue.textContent = h > 0 ? h.toFixed(2) : '—';
  }
  startTimeField.input.addEventListener('change', updateHours);
  endTimeField.input.addEventListener('change', updateHours);
  updateHours();
  hoursDisplay.append(hoursLabel, hoursValue);
  timeRow.append(startTimeField.wrap, endTimeField.wrap, hoursDisplay);
  form.append(timeRow);

  const actNameField = createInputField({ id: 'edit-activity-name', label: 'שם פעילות', value: record.activity_name_snapshot || '', placeholder: 'שם התוכנית או הפעילות' });
  const typeOpts = [{ value: '', label: 'בחר' }, ...typeOptions.map(t => typeof t === 'string' ? { value: t, label: t } : t)];
  const typeField   = createSelectField({ id: 'edit-type',      label: 'סוג פעילות', options: typeOpts, value: '' });
  const authField   = createInputField({ id: 'edit-authority',  label: 'רשות',        value: record.authority_name_snapshot || '' });
  const schoolField = createInputField({ id: 'edit-school',     label: 'בית ספר',     value: record.school_name_snapshot || '' });
  const meetField   = createInputField({ id: 'edit-meeting',    label: 'מפגש מס\'',   type: 'number', value: record.meeting_no != null ? String(record.meeting_no) : '', attrs: { min: '0', max: '50' } });
  const kmField     = createInputField({ id: 'edit-km',         label: 'ק"מ הלוך-חזור', type: 'number', value: String(record.roundtrip_km || 0), attrs: { min: '0', step: '1' } });
  const expField    = createInputField({ id: 'edit-expenses',   label: 'הוצאות (₪)', type: 'number', value: String(record.expenses || 0), attrs: { min: '0', step: '0.01' } });
  const expDField   = createInputField({ id: 'edit-exp-detail', label: 'פירוט הוצאות', value: record.expense_details || '' });
  const notesField  = createInputField({ id: 'edit-notes',      label: 'הערות',       value: record.notes || '' });

  typeField.input.value = record.activity_type || '';

  form.append(actNameField.wrap, typeField.wrap, authField.wrap, schoolField.wrap, meetField.wrap,
              kmField.wrap, expField.wrap, expDField.wrap, notesField.wrap);

  const errorEl = document.createElement('p');
  errorEl.className = 'av2-report__error';
  errorEl.hidden = true;
  form.append(errorEl);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'av2-btn av2-btn--primary';
  const saveBtnLabel = document.createElement('span');
  saveBtnLabel.textContent = 'שמירת שינויים';
  saveBtn.append(createIcon('check', { size: 15 }), saveBtnLabel);
  form.append(saveBtn);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;

    const startTime  = startTimeField.input.value;
    const endTime    = endTimeField.input.value;
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
      if (!startTime || !endTime) startTimeField.input.focus();
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
  startTimeField.input.focus();
}

// ── Delete ─────────────────────────────────────────────────────────────────

async function handleDelete({ record, instructor, tr, onRefresh }) {
  const dateStr = formatDateHeb(record.report_date);
  if (!confirm(`למחוק את הדיווח מתאריך ${dateStr}?\nפעולה זו אינה הפיכה.`)) return;

  tr.style.opacity = '0.5';
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
    tr.style.opacity = '1';
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

// ── Mini calendar ──────────────────────────────────────────────────────────

function buildMiniCalendar(year, month, records) {
  const datesWithRecords = new Set(records.map(r => r.report_date));

  const wrap = document.createElement('div');
  wrap.className = 'av2-cal';

  // Day headers (Sun–Sat, RTL: Sun first)
  const daysHeader = document.createElement('div');
  daysHeader.className = 'av2-cal__header';
  for (const d of DAY_NAMES_SHORT) {
    const cell = document.createElement('div');
    cell.className = 'av2-cal__day-name';
    cell.textContent = d;
    daysHeader.append(cell);
  }

  const grid = document.createElement('div');
  grid.className = 'av2-cal__grid';

  const firstDay = new Date(year, month - 1, 1);
  const lastDay  = new Date(year, month, 0);
  const startDow = firstDay.getDay(); // 0=Sun

  // Leading empty cells
  for (let i = 0; i < startDow; i++) {
    const empty = document.createElement('div');
    empty.className = 'av2-cal__cell av2-cal__cell--empty';
    grid.append(empty);
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const hasRecord = datesWithRecords.has(dateStr);

    const cell = document.createElement('div');
    cell.className = 'av2-cal__cell' + (hasRecord ? ' av2-cal__cell--has-record' : '');

    const num = document.createElement('span');
    num.className = 'av2-cal__day-num';
    num.textContent = String(day);

    cell.append(num);

    if (hasRecord) {
      const dot = document.createElement('span');
      dot.className = 'av2-cal__dot';
      cell.append(dot);
    }

    grid.append(cell);
  }

  wrap.append(daysHeader, grid);
  return wrap;
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

function truncate(str, max) {
  if (!str) return '—';
  return str.length <= max ? str : str.slice(0, max) + '…';
}

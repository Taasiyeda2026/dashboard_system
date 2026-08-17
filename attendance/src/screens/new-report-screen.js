/**
 * new-report-screen.js  —  Add a new attendance record
 *
 * Flow:
 *   1. User picks a date
 *   2. System fetches instructor's scheduled activities for that date (RPC)
 *   3a. If activities found → show picker cards → user selects one → form auto-fills
 *   3b. If no activities → show manual form
 *   4. User fills remaining fields (km, expenses, notes, attachments)
 *   5. Save to attendance_records
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { getInstructorActivitiesForDate, getSchoolOptions, calcHours } from '../services/activities.service.js';
import { createRecord, getMonthApproval, getActivityTypes } from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey } from '../services/month-gate.service.js';
import { uploadAttachment } from '../services/storage.service.js';
import { createAttachmentRecord } from '../services/attendance.service.js';

export function renderNewReportScreen(container, {
  instructor = {},
  defaultDate = new Date().toISOString().slice(0, 10),
  onBack,
  onSaved
} = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-report';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-report__inner';

  // ── Header ─────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'av2-report__header';
  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'av2-btn av2-btn--icon';
  backBtn.setAttribute('aria-label', 'חזרה');
  backBtn.append(createIcon('chevron-right'));
  backBtn.addEventListener('click', () => onBack?.());
  const title = document.createElement('h1');
  title.className = 'av2-report__title';
  title.textContent = 'דיווח חדש';
  header.append(backBtn, title);

  // ── Date picker ────────────────────────────────────────────────────────
  const dateSection = document.createElement('div');
  dateSection.className = 'av2-report__section';

  const dateField = createInputField({
    id: 'av2-report-date',
    label: 'תאריך הדיווח',
    type: 'date',
    value: defaultDate
  });
  dateSection.append(dateField.wrap);

  // ── Activity picker area (populated after date change) ─────────────────
  const pickerArea = document.createElement('div');
  pickerArea.className = 'av2-activity-picker';

  // ── Form area (hidden until activity is selected or manual chosen) ─────
  const formArea = document.createElement('div');
  formArea.className = 'av2-report__form-area';
  formArea.hidden = true;

  inner.append(header, dateSection, pickerArea, formArea);
  wrap.append(inner);
  container.append(wrap);

  // State for the current form
  let selectedActivity = null;
  let pendingFiles = [];
  let activityTypes = [];

  // Load activity types (non-blocking)
  getActivityTypes().then(types => { activityTypes = types; }).catch(() => {});

  // ── Date change handler ────────────────────────────────────────────────
  async function onDateChange() {
    const dateStr = dateField.input.value;
    if (!dateStr) return;

    // Check if this month is editable
    const [y, m] = dateStr.split('-').map(Number);
    const monthKey = getMonthKey(y, m);
    try {
      const approval = await getMonthApproval(instructor.empId, monthKey);
      if (!canEditMonth(y, m, approval)) {
        pickerArea.innerHTML = `
          <div class="av2-activity-picker__locked">
            <p>${editBlockReason(y, m, approval)}</p>
          </div>`;
        formArea.hidden = true;
        return;
      }
    } catch {}

    pickerArea.innerHTML = '<div class="av2-activity-picker__loading">מחפש פעילויות מתוכננות…</div>';
    formArea.hidden = true;
    selectedActivity = null;

    try {
      const activities = await getInstructorActivitiesForDate(instructor.empId, dateStr);
      renderActivityPicker(activities, dateStr);
    } catch (err) {
      pickerArea.innerHTML = `<div class="av2-activity-picker__error">שגיאה בטעינת פעילויות: ${err.message}</div>`;
    }
  }

  function renderActivityPicker(activities, dateStr) {
    pickerArea.innerHTML = '';

    if (activities.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'av2-activity-picker__empty';
      msg.innerHTML = `
        <p>לא נמצאו פעילויות מתוכננות ליום זה.</p>
      `;
      const manualBtn = document.createElement('button');
      manualBtn.type = 'button';
      manualBtn.className = 'av2-btn av2-btn--secondary';
      manualBtn.textContent = 'מילוי ידני';
      manualBtn.addEventListener('click', () => {
        pickerArea.innerHTML = '';
        renderForm(null, dateStr);
      });
      msg.append(manualBtn);
      pickerArea.append(msg);
      return;
    }

    const header = document.createElement('p');
    header.className = 'av2-activity-picker__header';
    header.textContent = activities.length === 1
      ? 'נמצאה פעילות מתוכננת ליום זה:'
      : `נמצאו ${activities.length} פעילויות מתוכננות ליום זה — בחר/י:`;
    pickerArea.append(header);

    for (const act of activities) {
      const card = buildActivityCard(act, () => {
        pickerArea.innerHTML = '';
        renderForm(act, dateStr);
      });
      pickerArea.append(card);
    }

    // Always allow manual override
    const manualLink = document.createElement('button');
    manualLink.type = 'button';
    manualLink.className = 'av2-btn av2-btn--link';
    manualLink.textContent = 'מילוי ידני (ללא פעילות מתוכננת)';
    manualLink.addEventListener('click', () => {
      pickerArea.innerHTML = '';
      renderForm(null, dateStr);
    });
    pickerArea.append(manualLink);

    // Auto-select if only one activity
    if (activities.length === 1) {
      pickerArea.innerHTML = '';
      renderForm(activities[0], dateStr);
    }
  }

  function renderForm(activity, dateStr) {
    selectedActivity = activity;
    formArea.innerHTML = '';
    formArea.hidden = false;

    // ── Section: activity details ──────────────────────────────────────
    if (activity) {
      const activityBanner = document.createElement('div');
      activityBanner.className = 'av2-report__activity-banner';
      activityBanner.innerHTML = `
        <div class="av2-report__activity-banner-title">${activity.activity_name || activity.activity_no || 'פעילות'}</div>
        <div class="av2-report__activity-banner-meta">
          ${activity.activity_type ? `<span>${activity.activity_type}</span>` : ''}
          ${activity.program_name ? `<span>${activity.program_name}</span>` : ''}
          ${activity.meeting_no ? `<span>מפגש ${activity.meeting_no}</span>` : ''}
        </div>
        <button type="button" class="av2-btn av2-btn--link av2-report__activity-banner-change">שנה פעילות</button>
      `;
      activityBanner.querySelector('.av2-report__activity-banner-change').addEventListener('click', () => {
        formArea.hidden = true;
        onDateChange(); // re-fetch picker
      });
      formArea.append(activityBanner);
    }

    const form = document.createElement('form');
    form.className = 'av2-report__form';
    form.noValidate = true;

    // ── Time fields ──────────────────────────────────────────────────
    const timeRow = document.createElement('div');
    timeRow.className = 'av2-report__time-row';

    const startTimeField = createInputField({
      id: 'av2-start-time', label: 'שעת התחלה', type: 'time',
      value: activity?.start_time || ''
    });
    const endTimeField = createInputField({
      id: 'av2-end-time', label: 'שעת סיום', type: 'time',
      value: activity?.end_time || ''
    });

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

    // ── Activity type ────────────────────────────────────────────────
    const typeOptions = activityTypes.length ? activityTypes : ['קורס','סדנה','סיור','הכשרה','תפעול','ביטול זמן','חדר בריחה','סדנאות קיץ'];
    const typeField = createSelectField({
      id: 'av2-activity-type', label: 'סוג פעילות',
      options: typeOptions,
      value: activity?.activity_type || ''
    });
    if (activity) typeField.input.value = activity.activity_type || '';
    form.append(typeField.wrap);

    // ── Authority ────────────────────────────────────────────────────
    const authField = createInputField({
      id: 'av2-authority', label: 'רשות',
      value: activity?.authority_name || '',
      placeholder: 'שם הרשות'
    });
    if (activity?.authority_name) authField.input.readOnly = true;
    form.append(authField.wrap);

    // ── School ───────────────────────────────────────────────────────
    let schoolFieldEl = null;
    let schoolId = activity?.single_school_id || null;
    let schoolName = activity?.single_school_name || '';
    let semelMosad = activity?.single_semel_mosad || null;

    if (activity?.school_link_status === 'multiple_schools') {
      const schoolOptions = getSchoolOptions(activity);
      const selectEl = document.createElement('div');
      selectEl.className = 'av2-field';
      const selectLabel = document.createElement('label');
      selectLabel.className = 'av2-field__label';
      selectLabel.textContent = 'בית ספר';
      selectLabel.htmlFor = 'av2-school-select';
      const selectInput = document.createElement('select');
      selectInput.id = 'av2-school-select';
      selectInput.className = 'av2-field__select';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'בחר בית ספר...';
      selectInput.append(defaultOpt);
      for (const s of schoolOptions) {
        const opt = document.createElement('option');
        opt.value = String(s.id);
        opt.dataset.name = s.name;
        opt.dataset.semel = s.semel_mosad || '';
        opt.textContent = s.name + (s.semel_mosad ? ` (${s.semel_mosad})` : '');
        selectInput.append(opt);
      }
      selectInput.addEventListener('change', () => {
        const opt = selectInput.selectedOptions[0];
        if (opt?.value) {
          schoolId = Number(opt.value);
          schoolName = opt.dataset.name;
          semelMosad = opt.dataset.semel ? Number(opt.dataset.semel) : null;
        } else {
          schoolId = null; schoolName = ''; semelMosad = null;
        }
      });
      selectEl.append(selectLabel, selectInput);
      schoolFieldEl = selectEl;
    } else {
      const sf = createInputField({
        id: 'av2-school', label: 'בית ספר',
        value: activity?.school_link_status === 'single_school' ? (activity.single_school_name || '') : '',
        placeholder: activity?.school_link_status === 'authority_or_place_only' ? 'רשות / מקום בלבד' : 'שם בית הספר'
      });
      if (activity?.school_link_status === 'single_school') sf.input.readOnly = true;
      sf.input.addEventListener('input', () => { schoolName = sf.input.value; });
      schoolFieldEl = sf.wrap;
    }
    form.append(schoolFieldEl);

    // ── Meeting no ───────────────────────────────────────────────────
    const meetingField = createInputField({
      id: 'av2-meeting-no', label: 'מפגש מס\'',
      type: 'number',
      value: activity?.meeting_no != null ? String(activity.meeting_no) : '',
      attrs: { min: '0', max: '50', step: '1' }
    });
    form.append(meetingField.wrap);

    // ── Km ───────────────────────────────────────────────────────────
    const kmField = createInputField({
      id: 'av2-km', label: 'ק"מ הלוך-חזור',
      type: 'number',
      value: '',
      attrs: { min: '0', step: '1', placeholder: '0' }
    });
    form.append(kmField.wrap);

    // ── Expenses ─────────────────────────────────────────────────────
    const expField = createInputField({
      id: 'av2-expenses', label: 'הוצאות (₪)',
      type: 'number',
      value: '',
      attrs: { min: '0', step: '0.01', placeholder: '0' }
    });
    const expDetailField = createInputField({
      id: 'av2-expense-detail', label: 'פירוט הוצאות',
      placeholder: 'לדוגמה: חניה, כיבוד, חומרים'
    });
    form.append(expField.wrap, expDetailField.wrap);

    // ── Notes ─────────────────────────────────────────────────────────
    const notesField = createInputField({
      id: 'av2-notes', label: 'הערות',
      placeholder: 'הערות נוספות (אופציונלי)'
    });
    form.append(notesField.wrap);

    // ── Attachments ───────────────────────────────────────────────────
    const attachSection = buildAttachmentSection(pendingFiles);
    form.append(attachSection);

    // ── Save button ───────────────────────────────────────────────────
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'av2-btn av2-btn--primary av2-report__save';
    const saveLabel = document.createElement('span');
    saveLabel.textContent = 'שמירת דיווח';
    saveBtn.append(createIcon('check'), saveLabel);
    form.append(saveBtn);

    // ── Error area ────────────────────────────────────────────────────
    const errorEl = document.createElement('p');
    errorEl.className = 'av2-report__error';
    errorEl.hidden = true;
    form.append(errorEl);

    // ── Submit ─────────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const startTime = startTimeField.input.value;
      const endTime   = endTimeField.input.value;
      const totalHours = calcHours(startTime, endTime);

      errorEl.hidden = true;

      if (!startTime || !endTime) {
        errorEl.textContent = 'יש להזין שעת התחלה וסיום';
        errorEl.hidden = false;
        return;
      }
      if (!typeField.input.value) {
        errorEl.textContent = 'יש לבחור סוג פעילות';
        errorEl.hidden = false;
        return;
      }

      saveBtn.disabled = true;
      saveBtn.querySelector('span').textContent = 'שומר…';

      try {
        const [y, m] = dateStr.split('-').map(Number);
        const payload = {
          report_date:             dateStr,
          start_time:              startTime,
          end_time:                endTime,
          total_hours:             totalHours,
          activity_type:           typeField.input.value,
          activity_id:             activity?.id || null,
          activity_row_id:         activity?.row_id || null,
          activity_no:             activity?.activity_no || null,
          activity_season:         activity?.activity_season || null,
          activity_name_snapshot:  activity?.activity_name || null,
          meeting_no:              meetingField.input.value ? Number(meetingField.input.value) : null,
          authority_id:            activity?.authority_id || null,
          authority_name_snapshot: activity?.authority_name || authField.input.value.trim() || null,
          school_id:               schoolId || null,
          school_name_snapshot:    schoolName || null,
          semel_mosad:             semelMosad || null,
          program_name:            activity?.program_name || null,
          program_name_snapshot:   activity?.program_name || null,
          roundtrip_km:            kmField.input.value ? Number(kmField.input.value) : 0,
          expenses:                expField.input.value ? Number(expField.input.value) : 0,
          expense_details:         expDetailField.input.value.trim() || null,
          notes:                   notesField.input.value.trim() || null
        };

        const record = await createRecord(instructor.empId, payload);

        // Upload pending files
        for (const file of pendingFiles) {
          try {
            const storagePath = await uploadAttachment(file, instructor.empId, record.id);
            await createAttachmentRecord(instructor.empId, record.id, {
              storagePath,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size
            });
          } catch (uploadErr) {
            console.warn('File upload failed:', uploadErr.message);
          }
        }

        onSaved?.(record);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
        saveBtn.disabled = false;
        saveBtn.querySelector('span').textContent = 'שמירת דיווח';
      }
    });

    formArea.append(form);
  }

  // Trigger initial date fetch
  dateField.input.addEventListener('change', onDateChange);
  onDateChange();
}

// ── Activity picker card ──────────────────────────────────────────────────

function buildActivityCard(activity, onClick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'av2-activity-card';

  const nameEl = document.createElement('div');
  nameEl.className = 'av2-activity-card__name';
  nameEl.textContent = activity.activity_name || activity.activity_no || 'פעילות';

  const meta = document.createElement('div');
  meta.className = 'av2-activity-card__meta';
  const parts = [];
  if (activity.activity_type) parts.push(activity.activity_type);
  if (activity.start_time && activity.end_time) parts.push(`${activity.start_time}–${activity.end_time}`);
  if (activity.authority_name) parts.push(activity.authority_name);
  if (activity.single_school_name) parts.push(activity.single_school_name);
  if (activity.meeting_no) parts.push(`מפגש ${activity.meeting_no}`);
  meta.textContent = parts.join(' · ');

  card.append(nameEl, meta, createIcon('chevron-left', { size: 16 }));
  card.addEventListener('click', onClick);
  return card;
}

// ── Attachment section ─────────────────────────────────────────────────────

function buildAttachmentSection(pendingFiles) {
  const section = document.createElement('div');
  section.className = 'av2-attach-section';

  const label = document.createElement('p');
  label.className = 'av2-field__label';
  label.textContent = 'מסמכים מצורפים (אופציונלי)';

  const fileList = document.createElement('div');
  fileList.className = 'av2-attach-list';

  function renderFileList() {
    fileList.innerHTML = '';
    for (let i = 0; i < pendingFiles.length; i++) {
      const row = document.createElement('div');
      row.className = 'av2-attach-item';
      const name = document.createElement('span');
      name.textContent = pendingFiles[i].name;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'av2-btn av2-btn--icon';
      delBtn.setAttribute('aria-label', 'הסר קובץ');
      delBtn.append(createIcon('x', { size: 14 }));
      delBtn.addEventListener('click', () => {
        pendingFiles.splice(i, 1);
        renderFileList();
      });
      row.append(name, delBtn);
      fileList.append(row);
    }
  }

  const uploadBtn = document.createElement('label');
  uploadBtn.className = 'av2-attach-upload-btn';
  uploadBtn.textContent = '+ הוסף קובץ';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*,.pdf';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => {
    for (const f of fileInput.files) pendingFiles.push(f);
    renderFileList();
    fileInput.value = '';
  });
  uploadBtn.append(fileInput);

  renderFileList();
  section.append(label, fileList, uploadBtn);
  return section;
}

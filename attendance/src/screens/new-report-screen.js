/**
 * new-report-screen.js  —  Add a new attendance record
 *
 * UX revision:
 *  • 2-column compact grid layout
 *  • Custom narrow time-picker (hour select + minute select, 5-min steps)
 *    – after start-minutes chosen → auto-focus end-time hour
 *    – end-time hours start from the selected start hour
 *  • Activity type: Hebrew labels, empty default
 *  • Authority + School: dropdowns from DB (av2_get_authority_school_list)
 *    – authority → filters school list
 *  • Meeting no: dropdown 1-20
 *  • KM label: "קילומטר"
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { createSearchableSelect } from '../components/searchable-select.js';
import {
  getInstructorActivitiesForDate,
  getSchoolOptions,
  calcHours,
  getAuthoritySchoolList,
  HEBREW_ACTIVITY_TYPES,
  toHebrewType,
} from '../services/activities.service.js';
import {
  createRecord,
  getMonthApproval,
} from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey } from '../services/month-gate.service.js';
import { uploadAttachment } from '../services/storage.service.js';
import { createAttachmentRecord } from '../services/attendance.service.js';

// ── Time-picker component ──────────────────────────────────────────────────
/**
 * Creates a compact two-select time picker (hour + minute).
 * Returns { wrap, hourSel, minSel, getValue(), setMinHour(h) }
 *
 * @param {string} id            Base id (suffixed with -h / -m)
 * @param {string} label         Field label text
 * @param {string} defaultValue  "HH:MM" or ""
 */
function createTimePicker(id, label, defaultValue = '') {
  const defMatch = defaultValue.match(/^(\d{1,2}):(\d{2})$/);
  const defH = defMatch ? parseInt(defMatch[1], 10) : null;
  const defM = defMatch ? parseInt(defMatch[2], 10) : null;

  const wrap = document.createElement('div');
  wrap.className = 'av2-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'av2-field__label';
  labelEl.textContent = label;

  const row = document.createElement('div');
  row.className = 'av2-time-picker';

  const hourSel = document.createElement('select');
  hourSel.id = `${id}-h`;
  hourSel.className = 'av2-time-picker__sel av2-time-picker__hour';
  hourSel.setAttribute('aria-label', `${label} — שעה`);

  const sep = document.createElement('span');
  sep.className = 'av2-time-picker__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ':';

  const minSel = document.createElement('select');
  minSel.id = `${id}-m`;
  minSel.className = 'av2-time-picker__sel av2-time-picker__min';
  minSel.setAttribute('aria-label', `${label} — דקות`);

  function buildHours(minHour = 0) {
    const prev = hourSel.value;
    hourSel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'שע׳'; ph.disabled = true;
    hourSel.append(ph);
    for (let h = minHour; h <= 23; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = String(h).padStart(2, '0');
      hourSel.append(opt);
    }
    // Restore previous if still in range
    if (prev !== '' && parseInt(prev, 10) >= minHour) {
      hourSel.value = prev;
    } else {
      hourSel.value = '';
    }
  }

  function buildMinutes() {
    minSel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'דק׳'; ph.disabled = true;
    minSel.append(ph);
    for (let m = 0; m < 60; m += 5) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = String(m).padStart(2, '0');
      minSel.append(opt);
    }
  }

  buildHours();
  buildMinutes();

  if (defH !== null) hourSel.value = String(defH);
  if (defM !== null) {
    // Round to nearest 5-min slot
    const rounded = Math.round(defM / 5) * 5;
    minSel.value = String(rounded < 60 ? rounded : 55);
  }

  function getValue() {
    if (hourSel.value === '' || minSel.value === '') return '';
    return String(hourSel.value).padStart(2, '0') + ':' + String(minSel.value).padStart(2, '0');
  }

  row.append(hourSel, sep, minSel);
  wrap.append(labelEl, row);

  return {
    wrap,
    hourSel,
    minSel,
    getValue,
    setMinHour: buildHours,
  };
}

// ── Main screen ────────────────────────────────────────────────────────────

export function renderNewReportScreen(container, {
  instructor = {},
  defaultDate = new Date().toISOString().slice(0, 10),
  onBack,
  onSaved,
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
    value: defaultDate,
  });
  dateSection.append(dateField.wrap);

  // ── Activity picker area ────────────────────────────────────────────────
  const pickerArea = document.createElement('div');
  pickerArea.className = 'av2-activity-picker';

  // ── Form area ──────────────────────────────────────────────────────────
  const formArea = document.createElement('div');
  formArea.className = 'av2-report__form-area';
  formArea.hidden = true;

  inner.append(header, dateSection, pickerArea, formArea);
  wrap.append(inner);
  container.append(wrap);

  // ── Shared state ────────────────────────────────────────────────────────
  let selectedActivity = null;
  let pendingFiles     = [];
  let authoritySchoolData = [];

  // Pre-load authority/school data (non-blocking, ready well before manual form needed)
  getAuthoritySchoolList(instructor.empId)
    .then(d => { authoritySchoolData = d; })
    .catch(() => {});

  // ── Date change handler ─────────────────────────────────────────────────
  async function onDateChange() {
    const dateStr = dateField.input.value;
    if (!dateStr) return;

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

  // ── Activity picker renderer ─────────────────────────────────────────────
  function renderActivityPicker(activities, dateStr) {
    pickerArea.innerHTML = '';

    if (activities.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'av2-activity-picker__empty';
      msg.innerHTML = '<p>לא נמצאו פעילויות מתוכננות ליום זה.</p>';
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

    const hdr = document.createElement('p');
    hdr.className = 'av2-activity-picker__header';
    hdr.textContent = activities.length === 1
      ? 'נמצאה פעילות מתוכננת ליום זה:'
      : `נמצאו ${activities.length} פעילויות מתוכננות ליום זה — בחר/י:`;
    pickerArea.append(hdr);

    for (const act of activities) {
      const card = buildActivityCard(act, () => {
        pickerArea.innerHTML = '';
        renderForm(act, dateStr);
      });
      pickerArea.append(card);
    }

    const manualLink = document.createElement('button');
    manualLink.type = 'button';
    manualLink.className = 'av2-btn av2-btn--link';
    manualLink.textContent = 'מילוי ידני (ללא פעילות מתוכננת)';
    manualLink.addEventListener('click', () => {
      pickerArea.innerHTML = '';
      renderForm(null, dateStr);
    });
    pickerArea.append(manualLink);

    // Auto-select single activity
    if (activities.length === 1) {
      pickerArea.innerHTML = '';
      renderForm(activities[0], dateStr);
    }
  }

  // ── Form renderer ────────────────────────────────────────────────────────
  function renderForm(activity, dateStr) {
    selectedActivity = activity;
    formArea.innerHTML = '';
    formArea.hidden = false;

    // Activity banner (shown when pre-filled from a scheduled activity)
    if (activity) {
      const banner = document.createElement('div');
      banner.className = 'av2-report__activity-banner';
      banner.innerHTML = `
        <div class="av2-report__activity-banner-title">${activity.activity_name || activity.activity_no || 'פעילות'}</div>
        <div class="av2-report__activity-banner-meta">
          ${activity.activity_type ? `<span>${toHebrewType(activity.activity_type)}</span>` : ''}
          ${activity.program_name  ? `<span>${activity.program_name}</span>`                : ''}
          ${activity.meeting_no    ? `<span>מפגש ${activity.meeting_no}</span>`             : ''}
        </div>
        <button type="button" class="av2-btn av2-btn--link av2-report__activity-banner-change">שנה פעילות</button>
      `;
      banner.querySelector('.av2-report__activity-banner-change').addEventListener('click', () => {
        formArea.hidden = true;
        onDateChange();
      });
      formArea.append(banner);
    }

    const form = document.createElement('form');
    form.className = 'av2-report__form';
    form.noValidate = true;

    // ── ROW 1: Activity type + Meeting no ──────────────────────────────
    const hebrewType = activity ? toHebrewType(activity.activity_type) : '';

    const typeField = createSelectField({
      id: 'av2-activity-type',
      label: 'סוג פעילות',
      options: [
        { value: '', label: 'בחר' },
        ...HEBREW_ACTIVITY_TYPES.map(t => ({ value: t, label: t })),
      ],
      value: hebrewType,
    });

    const meetingOptions = [{ value: '', label: '—' }];
    for (let i = 1; i <= 20; i++) meetingOptions.push({ value: String(i), label: String(i) });
    const meetingField = createSelectField({
      id: 'av2-meeting-no',
      label: 'מפגש מס׳',
      options: meetingOptions,
      value: activity?.meeting_no != null ? String(activity.meeting_no) : '',
    });
    meetingField.wrap.classList.add('av2-field--narrow');

    form.append(typeField.wrap, meetingField.wrap);

    // ── ROW 2: Authority + School ───────────────────────────────────────
    // Mutable state for submit handler
    let schoolId       = activity?.single_school_id || null;
    let schoolName     = activity?.single_school_name || '';
    let semelMosad     = activity?.single_semel_mosad || null;
    let manualAuthId   = activity?.authority_id || null;
    let manualAuthName = activity?.authority_name || '';
    let manualSchoolId   = null;
    let manualSchoolName = '';

    let authorityEl, schoolEl;

    if (activity) {
      // ── Pre-filled from activity: read-only authority, school depends on link status
      const authInput = createInputField({
        id: 'av2-authority', label: 'רשות',
        value: activity.authority_name || '',
      });
      authInput.input.readOnly = true;
      authorityEl = authInput.wrap;

      if (activity.school_link_status === 'multiple_schools') {
        const schoolOptions = getSchoolOptions(activity);
        const schoolWrap  = document.createElement('div');
        schoolWrap.className = 'av2-field';
        const schoolLbl   = document.createElement('label');
        schoolLbl.className = 'av2-field__label';
        schoolLbl.textContent = 'בית ספר';
        schoolLbl.htmlFor = 'av2-school-select';
        const schoolSel   = document.createElement('select');
        schoolSel.id = 'av2-school-select';
        schoolSel.className = 'av2-field__select';
        const defOpt = document.createElement('option');
        defOpt.value = ''; defOpt.textContent = 'בחר בית ספר…';
        schoolSel.append(defOpt);
        for (const s of schoolOptions) {
          const opt = document.createElement('option');
          opt.value = String(s.id);
          opt.dataset.name = s.name;
          opt.dataset.semel = s.semel_mosad || '';
          opt.textContent = s.name + (s.semel_mosad ? ` (${s.semel_mosad})` : '');
          schoolSel.append(opt);
        }
        schoolSel.addEventListener('change', () => {
          const opt = schoolSel.selectedOptions[0];
          if (opt?.value) {
            schoolId   = Number(opt.value);
            schoolName = opt.dataset.name;
            semelMosad = opt.dataset.semel ? Number(opt.dataset.semel) : null;
          } else { schoolId = null; schoolName = ''; semelMosad = null; }
        });
        schoolWrap.append(schoolLbl, schoolSel);
        schoolEl = schoolWrap;
      } else {
        const sf = createInputField({
          id: 'av2-school', label: 'בית ספר',
          value: activity.school_link_status === 'single_school' ? (activity.single_school_name || '') : '',
          placeholder: activity.school_link_status === 'authority_or_place_only' ? 'רשות / מקום בלבד' : 'שם בית הספר',
        });
        if (activity.school_link_status === 'single_school') sf.input.readOnly = true;
        sf.input.addEventListener('input', () => { schoolName = sf.input.value; });
        schoolEl = sf.wrap;
      }
    } else {
      // ── Manual mode: searchable dropdowns from DB ──────────────────
      // Flat list of all schools (all authorities) for pre-authority selection
      const allSchoolsFlat = authoritySchoolData.flatMap(a =>
        (a.schools || []).map(s => ({
          value:          String(s.id),
          label:          s.name || String(s.id),
          authority_id:   a.authority_id,
          authority_name: a.authority_name,
          semel_mosad:    s.semel_mosad ?? null,
        }))
      );

      // Helper: build school option list for a given authority (or all)
      function schoolOptsFor(authorityId) {
        if (!authorityId) return allSchoolsFlat;
        return allSchoolsFlat.filter(s => s.authority_id === authorityId);
      }

      // ── School searchable select (declared first; referenced by authSel onChange)
      const schoolSel = createSearchableSelect({
        id: 'av2-school',
        label: 'בית ספר',
        options: allSchoolsFlat,
        placeholder: 'בחר בית ספר…',
        searchPlaceholder: 'חיפוש בית ספר…',
        onChange(value, lbl, opt) {
          if (value) {
            manualSchoolId   = Number(value);
            manualSchoolName = lbl || '';
            semelMosad       = opt?.semel_mosad ?? null;
            // Auto-set authority when school is chosen first
            if (opt?.authority_id && opt.authority_id !== manualAuthId) {
              manualAuthId   = opt.authority_id;
              manualAuthName = opt.authority_name || '';
              authSel.setValue(String(opt.authority_id), opt.authority_name || '');
              // Narrow school list to the auto-set authority
              schoolSel.setOptions(schoolOptsFor(manualAuthId));
            }
          } else {
            manualSchoolId = null; manualSchoolName = ''; semelMosad = null;
          }
        },
      });

      // ── Authority searchable select
      const authSel = createSearchableSelect({
        id: 'av2-authority',
        label: 'רשות',
        options: authoritySchoolData.map(a => ({
          value: String(a.authority_id),
          label: a.authority_name,
        })),
        placeholder: 'בחר רשות…',
        searchPlaceholder: 'חיפוש רשות…',
        onChange(value, lbl) {
          manualAuthId   = value ? Number(value) : null;
          manualAuthName = lbl || '';
          // Filter school list; reset school if it no longer belongs here
          schoolSel.setOptions(schoolOptsFor(manualAuthId));
          if (manualSchoolId) {
            const stillValid = schoolOptsFor(manualAuthId).some(
              s => s.value === String(manualSchoolId)
            );
            if (!stillValid) {
              manualSchoolId = null; manualSchoolName = ''; semelMosad = null;
              schoolSel.reset();
            }
          }
        },
      });

      authorityEl = authSel.wrap;
      schoolEl    = schoolSel.wrap;
    }

    form.append(authorityEl, schoolEl);

    // ── ROW 3: Time pickers ────────────────────────────────────────────
    const startPicker = createTimePicker('av2-start-time', 'שעת התחלה', activity?.start_time || '');
    const endPicker   = createTimePicker('av2-end-time',   'שעת סיום',  activity?.end_time   || '');

    // Hours-calculated display (spans full width)
    const hoursDisplay = document.createElement('div');
    hoursDisplay.className = 'av2-report__hours-display av2-field--full';
    const hoursLbl = document.createElement('span');
    hoursLbl.className = 'av2-report__hours-label';
    hoursLbl.textContent = 'סה״כ שעות:';
    const hoursVal = document.createElement('span');
    hoursVal.className = 'av2-report__hours-value';

    function updateHours() {
      const h = calcHours(startPicker.getValue(), endPicker.getValue());
      hoursVal.textContent = h > 0 ? h.toFixed(2) : '—';
    }

    // Auto-flow: start minutes → focus end time + restrict end hours
    startPicker.minSel.addEventListener('change', () => {
      const startH = parseInt(startPicker.hourSel.value, 10);
      if (!isNaN(startH)) endPicker.setMinHour(startH);
      if (startPicker.hourSel.value !== '' && startPicker.minSel.value !== '') {
        endPicker.hourSel.focus();
      }
      updateHours();
    });
    startPicker.hourSel.addEventListener('change', updateHours);
    endPicker.hourSel.addEventListener('change', updateHours);
    endPicker.minSel.addEventListener('change', () => {
      endPicker.minSel.blur();
      updateHours();
    });

    updateHours();
    hoursDisplay.append(hoursLbl, hoursVal);
    form.append(startPicker.wrap, endPicker.wrap, hoursDisplay);

    // ── ROW 4: KM + Expenses ──────────────────────────────────────────
    const kmField = createInputField({
      id: 'av2-km', label: 'קילומטר',
      type: 'number', value: '',
      attrs: { min: '0', step: '1', placeholder: '0' },
    });
    const expField = createInputField({
      id: 'av2-expenses', label: 'הוצאות (₪)',
      type: 'number', value: '',
      attrs: { min: '0', step: '0.01', placeholder: '0' },
    });
    form.append(kmField.wrap, expField.wrap);

    // ── Full-width: Expense detail ─────────────────────────────────────
    const expDetailField = createInputField({
      id: 'av2-expense-detail', label: 'פירוט הוצאות',
      placeholder: 'לדוגמה: חניה, כיבוד, חומרים',
    });
    expDetailField.wrap.classList.add('av2-field--full');
    form.append(expDetailField.wrap);

    // ── Full-width: Notes ──────────────────────────────────────────────
    const notesField = createInputField({
      id: 'av2-notes', label: 'הערות',
      placeholder: 'הערות נוספות (אופציונלי)',
    });
    notesField.wrap.classList.add('av2-field--full');
    form.append(notesField.wrap);

    // ── Full-width: Attachments ────────────────────────────────────────
    const attachSection = buildAttachmentSection(pendingFiles);
    attachSection.classList.add('av2-field--full');
    form.append(attachSection);

    // ── Full-width: Save button ────────────────────────────────────────
    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'av2-btn av2-btn--primary av2-report__save av2-field--full';
    const saveLbl = document.createElement('span');
    saveLbl.textContent = 'שמירת דיווח';
    saveBtn.append(createIcon('check'), saveLbl);
    form.append(saveBtn);

    // ── Full-width: Error ──────────────────────────────────────────────
    const errorEl = document.createElement('p');
    errorEl.className = 'av2-report__error av2-field--full';
    errorEl.hidden = true;
    form.append(errorEl);

    // ── Submit ─────────────────────────────────────────────────────────
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const startTime  = startPicker.getValue();
      const endTime    = endPicker.getValue();
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
        const finalAuthorityId   = activity?.authority_id   ?? manualAuthId   ?? null;
        const finalAuthorityName = activity?.authority_name ?? manualAuthName  ?? null;
        const finalSchoolId      = activity ? (schoolId || null)      : (manualSchoolId   || null);
        const finalSchoolName    = activity ? (schoolName || null)    : (manualSchoolName || null);

        const payload = {
          report_date:             dateStr,
          start_time:              startTime,
          end_time:                endTime,
          total_hours:             totalHours,
          activity_type:           typeField.input.value,
          activity_id:             activity?.id              ?? null,
          activity_row_id:         activity?.row_id          ?? null,
          activity_no:             activity?.activity_no     ?? null,
          activity_season:         activity?.activity_season ?? null,
          activity_name_snapshot:  activity?.activity_name   ?? null,
          meeting_no:              meetingField.input.value ? Number(meetingField.input.value) : null,
          authority_id:            finalAuthorityId,
          authority_name_snapshot: finalAuthorityName,
          school_id:               finalSchoolId,
          school_name_snapshot:    finalSchoolName,
          semel_mosad:             semelMosad || null,
          program_name:            activity?.program_name    ?? null,
          program_name_snapshot:   activity?.program_name    ?? null,
          roundtrip_km:            kmField.input.value ? Number(kmField.input.value) : 0,
          expenses:                expField.input.value ? Number(expField.input.value) : 0,
          expense_details:         expDetailField.input.value.trim() || null,
          notes:                   notesField.input.value.trim() || null,
        };

        const record = await createRecord(instructor.empId, payload);

        for (const file of pendingFiles) {
          try {
            const storagePath = await uploadAttachment(file, instructor.empId, record.id);
            await createAttachmentRecord(instructor.empId, record.id, {
              storagePath,
              fileName: file.name,
              fileType: file.type,
              fileSize: file.size,
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

  // Init
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
  if (activity.activity_type)    parts.push(toHebrewType(activity.activity_type));
  if (activity.start_time && activity.end_time) parts.push(`${activity.start_time}–${activity.end_time}`);
  if (activity.authority_name)   parts.push(activity.authority_name);
  if (activity.single_school_name) parts.push(activity.single_school_name);
  if (activity.meeting_no)       parts.push(`מפגש ${activity.meeting_no}`);
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

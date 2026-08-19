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
import { createCompactSelect } from '../components/compact-select.js';
import { createTimePicker } from '../components/time-picker.js';
import {
  getInstructorActivitiesForDate,
  getSchoolOptions,
  calcHours,
  getAllAuthoritySchoolList,
  getActivityNamesByType,
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

const INDEPENDENT_REPORT_TYPES = ['הכשרה', 'תפעול', 'ביטול זמן'];

function activityChoiceKey(activity) {
  return [
    'planned',
    activity?.row_id || activity?.id || activity?.activity_no || activity?.activity_name || '',
    activity?.meeting_no || '',
    activity?.single_school_id || activity?.school_id || ''
  ].join('::');
}

function activityChoiceLabel(activity) {
  const name = activity?.activity_name || toHebrewType(activity?.activity_type) || 'פעילות';
  const school = activity?.single_school_name
    || (activity?.school_link_status === 'multiple_schools' ? 'מספר בתי ספר' : '');
  return school ? `${name} – ${school}` : name;
}

function buildReportSummaryRows(summary = {}) {
  const filesText = Array.isArray(summary.attachments) && summary.attachments.length
    ? summary.attachments.join(', ')
    : 'ללא קבצים';
  return [
    ['תאריך', summary.reportDate || '—'],
    ['סוג פעילות', summary.activityType || '—'],
    ['רשות', summary.authority || '—'],
    ['בית ספר', summary.school || '—'],
    ['שם התוכנית', summary.program || '—'],
    ['מספר מפגש', summary.meetingNo || '—'],
    ['שעת התחלה בפועל', summary.startTime || '—'],
    ['שעת סיום בפועל', summary.endTime || '—'],
    ['סך שעות', summary.totalHours || '—'],
    ['קילומטרים', summary.km || '0'],
    ['הוצאות', summary.expenses || '0'],
    ['הערה', summary.notes || '—'],
    ['קבצים מצורפים', filesText],
  ];
}

function showReportSummaryDialog(summary = {}) {
  return new Promise((resolve) => {
    document.querySelector('.av2-modal-overlay')?.remove();
    const rows = buildReportSummaryRows(summary);

    const overlay = document.createElement('div');
    overlay.className = 'av2-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'av2-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const header = document.createElement('div');
    header.className = 'av2-modal__header';
    const title = document.createElement('h2');
    title.className = 'av2-modal__title';
    title.textContent = 'סיכום לפני שמירה';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'av2-btn av2-btn--icon';
    closeBtn.setAttribute('aria-label', 'חזרה לעריכה');
    closeBtn.append(createIcon('x'));
    header.append(title, closeBtn);

    // Compact key-value summary — not a table.
    const summaryEl = document.createElement('div');
    summaryEl.className = 'av2-summary';
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'av2-summary__row';
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = String(value || '—');
      row.append(l, v);
      summaryEl.append(row);
    }

    const actions = document.createElement('div');
    actions.className = 'av2-summary__actions';
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'av2-btn av2-btn--secondary';
    backBtn.textContent = 'חזרה לעריכה';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'av2-btn av2-btn--primary';
    saveBtn.textContent = 'אישור ושמירת הדיווח';
    actions.append(backBtn, saveBtn);

    const done = (ok) => {
      overlay.remove();
      resolve(ok);
    };

    closeBtn.addEventListener('click', () => done(false));
    backBtn.addEventListener('click', () => done(false));
    saveBtn.addEventListener('click', () => done(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });

    modal.append(header, summaryEl, actions);
    overlay.append(modal);
    document.body.append(overlay);
    saveBtn.focus();
  });
}

// ── Main screen ────────────────────────────────────────────────────────────

export function renderNewReportScreen(container, {
  instructor = {},
  defaultDate = new Date().toISOString().slice(0, 10),
  prefillRecord = null,
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

  const dateField = createInputField({
    id: 'av2-report-date',
    label: 'תאריך *',
    type: 'date',
    value: defaultDate,
  });

  const initialTypeField = createSelectField({
    id: 'av2-initial-activity-type',
    label: 'סוג פעילות *',
    options: [
      { value: '', label: 'בחר' },
      ...HEBREW_ACTIVITY_TYPES.map((t) => ({ value: t, label: t })),
    ],
    value: '',
  });
  initialTypeField.wrap.classList.add('av2-field--full');

  const pickerArea = document.createElement('div');
  pickerArea.className = 'av2-activity-picker';

  const formArea = document.createElement('div');
  formArea.className = 'av2-report__form-area';
  formArea.hidden = true;

  const dateSection = document.createElement('div');
  dateSection.className = 'av2-report__section';
  dateSection.append(dateField.wrap, initialTypeField.wrap);

  inner.append(header, dateSection, pickerArea, formArea);
  wrap.append(inner);
  container.append(wrap);

  // ── Shared state ────────────────────────────────────────────────────────
  let selectedActivity = null;
  let pendingFiles     = [];
  let authoritySchoolData = [];

  // Pre-load authority/school data (non-blocking, ready well before manual form needed)
  getAllAuthoritySchoolList(instructor.empId)
    .then(d => { authoritySchoolData = d; })
    .catch(() => {});

  // ── Entry flow: date + activity type, then existing logic ───────────────
  async function proceedIfReady() {
    const dateStr = dateField.input.value;
    const selectedType = initialTypeField.input.value;
    if (!dateStr || !selectedType) {
      pickerArea.innerHTML = '';
      formArea.hidden = true;
      selectedActivity = null;
      pendingFiles.length = 0;
      return;
    }

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

    formArea.hidden = true;
    selectedActivity = null;
    pendingFiles.length = 0;

    if (INDEPENDENT_REPORT_TYPES.includes(selectedType)) {
      pickerArea.innerHTML = '';
      renderForm(null, dateStr, null, { independentType: selectedType });
      return;
    }

    pickerArea.innerHTML = '<div class="av2-activity-picker__loading">מחפש פעילויות מתוכננות…</div>';

    try {
      const [activities, authorityList] = await Promise.all([
        getInstructorActivitiesForDate(instructor.empId, dateStr).catch(() => []),
        getAllAuthoritySchoolList(instructor.empId).catch(() => authoritySchoolData),
      ]);
      authoritySchoolData = authorityList;
      const matchingActivities = activities.filter(
        (activity) => toHebrewType(activity.activity_type) === selectedType,
      );
      if (matchingActivities.length) {
        renderActivityChoices(matchingActivities, dateStr, { hideIndependent: true });
        return;
      }

      pickerArea.innerHTML = '';
      const note = document.createElement('p');
      note.className = 'av2-activity-picker__no-activity';
      note.textContent = `לא נמצאו פעילויות מתוכננות מסוג "${selectedType}" ליום זה. ניתן להמשיך לדיווח ידני.`;
      pickerArea.append(note);
      renderForm(null, dateStr, null, { lockedType: selectedType });
    } catch {
      pickerArea.innerHTML = '';
      renderForm(null, dateStr, null, { lockedType: selectedType });
    }
  }

  function renderActivityChoices(activities, dateStr, { hideIndependent = false } = {}) {
    pickerArea.innerHTML = '';
    const choiceField = createSelectField({
      id: 'av2-activity-choice',
      label: 'איזו פעילות בוצעה?',
      options: [
        { value: '', label: 'בחר' },
        ...activities.map((activity) => ({
          value: activityChoiceKey(activity),
          label: activityChoiceLabel(activity),
        })),
        ...(hideIndependent ? [] : INDEPENDENT_REPORT_TYPES.map((type) => ({
          value: `independent::${type}`,
          label: type,
        }))),
      ],
      value: '',
    });
    choiceField.wrap.classList.add('av2-field--full');
    pickerArea.append(choiceField.wrap);

    if (!activities.length && !hideIndependent) {
      const note = document.createElement('p');
      note.className = 'av2-activity-picker__no-activity';
      note.textContent = 'לא נמצאו פעילויות מתוכננות ליום זה. ניתן לבחור הכשרה / תפעול / ביטול זמן.';
      pickerArea.append(note);
    }

    choiceField.input.addEventListener('change', () => {
      const value = choiceField.input.value;
      if (!value) {
        formArea.hidden = true;
        return;
      }
      pendingFiles.length = 0;
      if (value.startsWith('independent::')) {
        const type = value.split('::')[1] || '';
        renderForm(null, dateStr, null, { independentType: type });
        return;
      }
      const activity = activities.find((item) => activityChoiceKey(item) === value) || null;
      renderForm(activity, dateStr);
    });
  }

  // ── Form renderer ────────────────────────────────────────────────────────
  function renderForm(activity, dateStr, prefillRecord = null, { independentType = '', lockedType = '' } = {}) {
    selectedActivity = activity;
    formArea.innerHTML = '';
    formArea.hidden = false;
    const isIndependentType = !activity && Boolean(independentType);
    const isLockedType = !activity && Boolean(lockedType) && !isIndependentType;

    // Duplicate-source note (only when pre-filling from an existing record)
    if (prefillRecord && !activity) {
      const dupNote = document.createElement('p');
      dupNote.className = 'av2-report__no-activity-note';
      dupNote.textContent = `שכפול מדיווח מ-${prefillRecord.report_date || ''} — ניתן לערוך לפני השמירה`;
      formArea.append(dupNote);
    }

    const form = document.createElement('form');
    form.className = 'av2-report__form';
    form.noValidate = true;

    function makeSectionTitle(text, variant = '') {
      const el = document.createElement('div');
      el.className = 'av2-form-section-title' + (variant ? ` av2-form-section-title--${variant}` : '');
      el.textContent = text;
      return el;
    }

    function makeCard(headerText, variant, fields) {
      const card = document.createElement('div');
      card.className = 'av2-form-card';
      card.append(makeSectionTitle(headerText, variant));
      const body = document.createElement('div');
      body.className = 'av2-form-card__body';
      for (const f of fields) body.append(f);
      card.append(body);
      return card;
    }

    // ── Card 1: פרטי פעילות ────────────────────────────────────────────

    const activityNameSel = createSearchableSelect({
      id: 'av2-activity-name',
      label: 'שם פעילות',
      options: [],
      placeholder: 'בחר לאחר בחירת סוג פעילות',
      searchPlaceholder: 'חיפוש שם פעילות…',
      emptyText: 'לא נמצאו פעילויות מסוג זה',
      onChange() {},
    });
    activityNameSel.wrap.classList.add('av2-field--full');
    form.append(activityNameSel.wrap);

    // ── ROW 2: Activity type + Meeting no ──────────────────────────────
    // Determine initial Hebrew type from planned activity or duplicate source
    const initialHebrewType = independentType
      || lockedType
      || prefillRecord?.activity_type
      || (activity ? toHebrewType(activity.activity_type) : '')
      || '';

    const typeOptions = [
      { value: '', label: 'בחר' },
      ...HEBREW_ACTIVITY_TYPES.map(t => ({ value: t, label: t })),
    ];
    if (initialHebrewType && !typeOptions.some((opt) => opt.value === initialHebrewType)) {
      typeOptions.push({ value: initialHebrewType, label: initialHebrewType });
    }
    const typeField = createSelectField({
      id: 'av2-activity-type',
      label: 'סוג פעילות',
      options: typeOptions,
      value: initialHebrewType,
    });

    const meetingVal = prefillRecord?.meeting_no != null ? String(prefillRecord.meeting_no)
                     : activity?.meeting_no   != null ? String(activity.meeting_no) : '';
    const meetingOptions = [{ value: '', label: '—' }];
    for (let i = 1; i <= 20; i++) meetingOptions.push({ value: String(i), label: String(i) });
    const meetingField = createCompactSelect({
      id: 'av2-meeting-no',
      options: meetingOptions,
      placeholder: '—',
      value: meetingVal,
      maxHeight: 260,
    });
    const meetingWrap = document.createElement('div');
    meetingWrap.className = 'av2-field';
    const meetingLbl = document.createElement('label');
    meetingLbl.className = 'av2-field__label';
    meetingLbl.textContent = 'מפגש מס׳';
    meetingLbl.htmlFor = 'av2-meeting-no-trigger';
    meetingWrap.append(meetingLbl, meetingField.wrap);

    form.append(typeField.wrap, meetingWrap);

    // ── Type change → reload activity name options ──────────────────────
    typeField.input.addEventListener('change', async () => {
      activityNameSel.reset();
      const hebrewType = typeField.input.value;
      if (!hebrewType) { activityNameSel.setOptions([]); return; }
      const names = await getActivityNamesByType(hebrewType);
      activityNameSel.setOptions(names);
    });

    // Eagerly load options when type is already known (pre-fill / duplicate)
    if (initialHebrewType) {
      const initialNameStr = prefillRecord?.activity_name_snapshot || activity?.activity_name || '';
      getActivityNamesByType(initialHebrewType)
        .then(names => {
          activityNameSel.setOptions(names);
          if (initialNameStr) activityNameSel.setValue(initialNameStr, initialNameStr);
        })
        .catch(() => {
          const s = prefillRecord?.activity_name_snapshot || activity?.activity_name || '';
          if (s) activityNameSel.setValue(s, s);
        });
    }

    if (activity || isIndependentType) {
      const fixedName = activity?.activity_name || prefillRecord?.activity_name_snapshot || independentType || '';
      if (fixedName) activityNameSel.setValue(fixedName, fixedName);
      const trigger = activityNameSel.wrap.querySelector('.av2-ssel__trigger');
      if (trigger) trigger.disabled = true;
      typeField.input.disabled = true;
      if (activity?.meeting_no != null) meetingField.select.disabled = true;
    } else if (isLockedType) {
      typeField.input.disabled = true;
    }

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

      // ── Apply prefill for authority/school (duplicate mode) ────────
      if (prefillRecord) {
        const prefAuthName = prefillRecord.authority_name_snapshot || '';
        const prefSchoolName = prefillRecord.school_name_snapshot || '';
        if (prefAuthName) {
          const matchAuth = authoritySchoolData.find(a => a.authority_name === prefAuthName);
          if (matchAuth) {
            authSel.setValue(String(matchAuth.authority_id), matchAuth.authority_name);
            manualAuthId = matchAuth.authority_id;
            manualAuthName = matchAuth.authority_name;
            schoolSel.setOptions(schoolOptsFor(manualAuthId));
          } else {
            authSel.setValue('', prefAuthName);
            manualAuthName = prefAuthName;
          }
        }
        if (prefSchoolName) {
          const flatSchools = schoolOptsFor(manualAuthId);
          const matchSchool = flatSchools.find(s => s.label === prefSchoolName);
          if (matchSchool) {
            schoolSel.setValue(matchSchool.value, matchSchool.label);
            manualSchoolId = Number(matchSchool.value);
            manualSchoolName = matchSchool.label;
            semelMosad = matchSchool.semel_mosad ?? null;
          } else {
            schoolSel.setValue('', prefSchoolName);
            manualSchoolName = prefSchoolName;
          }
        }
      }
    }

    const activityCard = makeCard('פרטי פעילות', 'activity', [
      typeField.wrap, meetingWrap, authorityEl, schoolEl, activityNameSel.wrap,
    ]);
    activityCard.querySelector('.av2-form-card__body').classList.add('av2-form-card__body--2col');
    activityNameSel.wrap.style.gridColumn = '1 / -1';

    // ── Card 2: זמנים ──────────────────────────────────────────────────

    const startPicker = createTimePicker('av2-start-time', 'שעת התחלה', prefillRecord?.start_time || '');
    const endPicker   = createTimePicker('av2-end-time',   'שעת סיום',  prefillRecord?.end_time   || '');

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

    const dateDisplay = createInputField({
      id: 'av2-time-date',
      label: 'תאריך *',
      type: 'date',
      value: dateStr,
    });
    dateDisplay.input.readOnly = true;
    const timeFields = [dateDisplay.wrap];
    if (activity?.start_time && activity?.end_time) {
      const plannedNote = document.createElement('p');
      plannedNote.className = 'av2-report__no-activity-note';
      plannedNote.style.gridColumn = '1 / -1';
      plannedNote.textContent = `שעות מתוכננות: ${activity.start_time}–${activity.end_time}. הזן נוכחות בפועל.`;
      timeFields.push(plannedNote);
    }
    timeFields.push(startPicker.wrap, endPicker.wrap, hoursDisplay);

    // ── ROW 4: KM + Expenses ──────────────────────────────────────────
    const kmField = createInputField({
      id: 'av2-km', label: 'קילומטר',
      type: 'number', value: prefillRecord?.roundtrip_km ? String(prefillRecord.roundtrip_km) : '',
      attrs: { min: '0', step: '1', placeholder: '0' },
    });

    const timeCard = makeCard('זמנים', 'time', [...timeFields, kmField.wrap]);
    timeCard.querySelector('.av2-form-card__body').classList.add('av2-form-card__body--2col');
    hoursDisplay.style.gridColumn = '1 / -1';

    // ── Card 3: הוצאות ומסמכים ──────────────────────────────────────────
    const expField = createInputField({
      id: 'av2-expenses', label: 'סה"כ הוצאות (₪)',
      type: 'number', value: prefillRecord?.expenses ? String(prefillRecord.expenses) : '',
      attrs: { min: '0', step: '0.01', placeholder: '0.00' },
    });
    const expDetailField = createInputField({
      id: 'av2-expense-detail', label: 'פירוט הוצאות',
      placeholder: 'פרט את ההוצאות',
      value: prefillRecord?.expense_details || '',
    });
    const attachmentUi = buildAttachmentSection(pendingFiles);
    const expensesCard = makeCard('הוצאות', 'expenses', [
      expField.wrap, expDetailField.wrap, attachmentUi.section,
    ]);

    // ── Card 4: הערות ──────────────────────────────────────────────────
    const notesField = createInputField({
      id: 'av2-notes', label: 'הערות נוספות',
      placeholder: 'הערות נוספות (אופציונלי)',
      value: prefillRecord?.notes || '',
    });
    const notesCard = makeCard('הערות', 'notes', [notesField.wrap]);

    // Grid order (RTL): row1=[timeCard(right), activityCard(left)], row2=[expensesCard(right), notesCard(left)]
    form.append(timeCard, activityCard, expensesCard, notesCard);

    // ── Save + Error (full-width below cards) ──────────────────────────
    const actionsRow = document.createElement('div');
    actionsRow.className = 'av2-field--full';
    actionsRow.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'av2-btn av2-btn--primary av2-report__save';
    const saveLbl = document.createElement('span');
    saveLbl.textContent = 'שמירת דיווח';
    saveBtn.append(createIcon('check'), saveLbl);
    actionsRow.append(saveBtn);
    form.append(actionsRow);

    const errorEl = document.createElement('p');
    errorEl.className = 'av2-report__error av2-field--full';
    errorEl.hidden = true;
    form.append(errorEl);

    // ── Submit ─────────────────────────────────────────────────────────
    let savedRecordForAttachmentRetry = null;

    async function uploadPendingFiles(recordId) {
      const queue = [...pendingFiles];
      pendingFiles.length = 0;
      const failedFiles = [];
      for (const file of queue) {
        try {
          const storagePath = await uploadAttachment(file, instructor.empId, recordId);
          await createAttachmentRecord(instructor.empId, recordId, {
            storagePath,
            fileName: file.name,
            fileType: file.type,
            fileSize: file.size,
          });
        } catch (uploadErr) {
          console.warn('File upload failed:', uploadErr.message);
          failedFiles.push(file);
        }
      }
      pendingFiles.push(...failedFiles);
      attachmentUi.refresh();
      return failedFiles;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (savedRecordForAttachmentRetry) {
        saveBtn.disabled = true;
        saveBtn.querySelector('span').textContent = 'מעלה קבצים…';
        const failedFiles = await uploadPendingFiles(savedRecordForAttachmentRetry.id);
        if (failedFiles.length) {
          errorEl.textContent = `הדיווח נשמר, אך ${failedFiles.length} קבצים עדיין לא עלו. אפשר לנסות שוב.`;
          errorEl.hidden = false;
          saveBtn.disabled = false;
          saveBtn.querySelector('span').textContent = 'נסה שוב העלאת קבצים';
          return;
        }
        onSaved?.(savedRecordForAttachmentRetry);
        return;
      }

      const startTime  = startPicker.getValue();
      const endTime    = endPicker.getValue();
      const totalHours = calcHours(startTime, endTime);

      // ── Full validation — clear then re-mark ──────────────────────
      errorEl.hidden = true;
      [activityNameSel.wrap, typeField.wrap, startPicker.wrap, endPicker.wrap, authorityEl]
        .forEach(w => w?.classList.remove('av2-field--invalid'));

      const missing = [];
      let firstInvalid = null;

      function markInvalid(wrap, msg) {
        wrap?.classList.add('av2-field--invalid');
        missing.push(msg);
        if (!firstInvalid) firstInvalid = wrap;
      }

      if (!activityNameSel.getLabel().trim())       markInvalid(activityNameSel.wrap, 'שם פעילות');
      if (!typeField.input.value)                   markInvalid(typeField.wrap, 'סוג פעילות');
      if (!startTime)                               markInvalid(startPicker.wrap, 'שעת התחלה');
      if (!endTime)                                 markInvalid(endPicker.wrap, 'שעת סיום');
      if (startTime && endTime && totalHours <= 0) markInvalid(endPicker.wrap, 'שעת סיום חייבת להיות מאוחרת מהתחלה');

      // Authority required in manual mode (except independent types)
      if (!activity && !isIndependentType) {
        const authLabel = manualAuthName?.trim() || '';
        if (!authLabel) markInvalid(authorityEl, 'רשות');
      }

      if (missing.length) {
        errorEl.textContent = `שדות חובה חסרים: ${[...new Set(missing)].join(' · ')}`;
        errorEl.hidden = false;
        firstInvalid?.querySelector('input,select,button,.av2-csel__trigger,.av2-ssel__trigger')?.focus();
        return;
      }

      const finalAuthorityId   = activity?.authority_id   ?? manualAuthId   ?? null;
      const finalAuthorityName = activity?.authority_name ?? manualAuthName  ?? null;
      const finalSchoolId      = activity ? (schoolId || null)      : (manualSchoolId   || null);
      const finalSchoolName    = activity ? (schoolName || null)    : (manualSchoolName || null);
      const programName = activity?.program_name || activityNameSel.getLabel().trim() || null;
      const summaryConfirmed = await showReportSummaryDialog({
        reportDate: dateStr,
        activityType: typeField.input.value || '—',
        authority: finalAuthorityName || '—',
        school: finalSchoolName || '—',
        program: programName || '—',
        meetingNo: meetingField.getValue() || '—',
        startTime,
        endTime,
        totalHours: totalHours > 0 ? totalHours.toFixed(2) : '—',
        km: kmField.input.value || '0',
        expenses: expField.input.value || '0',
        notes: notesField.input.value.trim() || '—',
        attachments: pendingFiles.map((file) => file.name),
      });
      if (!summaryConfirmed) return;

      saveBtn.disabled = true;
      saveBtn.querySelector('span').textContent = 'שומר…';

      try {
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
          activity_name_snapshot:  activityNameSel.getLabel().trim() || (activity?.activity_name ?? null),
          meeting_no:              meetingField.getValue() ? Number(meetingField.getValue()) : null,
          authority_id:            finalAuthorityId,
          authority_name_snapshot: finalAuthorityName,
          school_id:               finalSchoolId,
          school_name_snapshot:    finalSchoolName,
          semel_mosad:             semelMosad || null,
          program_name:            activity?.program_name    ?? null,
          program_name_snapshot:   programName,
          roundtrip_km:            kmField.input.value ? Number(kmField.input.value) : 0,
          expenses:                expField.input.value ? Number(expField.input.value) : 0,
          expense_details:         expDetailField.input.value.trim() || null,
          notes:                   notesField.input.value.trim() || null,
        };

        const record = await createRecord(instructor.empId, payload);
        const failedFiles = await uploadPendingFiles(record.id);
        if (failedFiles.length) {
          savedRecordForAttachmentRetry = record;
          errorEl.textContent = `הדיווח נשמר, אבל ${failedFiles.length} קבצים לא עלו. אפשר לנסות לצרף שוב ואז ללחוץ "נסה שוב העלאת קבצים".`;
          errorEl.hidden = false;
          saveBtn.disabled = false;
          saveBtn.querySelector('span').textContent = 'נסה שוב העלאת קבצים';
          return;
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
  if (prefillRecord) {
    // Duplicate mode: skip activity picker, go straight to form
    const prefillDate = prefillRecord.report_date || defaultDate;
    dateField.input.value = prefillDate;
    pickerArea.innerHTML = '';
    getAllAuthoritySchoolList(instructor.empId)
      .then(d => { authoritySchoolData = d; })
      .catch(() => {})
      .finally(() => {
        pickerArea.innerHTML = '';
        renderForm(null, prefillDate, prefillRecord);
      });
    dateField.input.addEventListener('change', proceedIfReady);
  } else {
    dateField.input.addEventListener('change', proceedIfReady);
    initialTypeField.input.addEventListener('change', proceedIfReady);
  }
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
  return { section, refresh: renderFileList };
}

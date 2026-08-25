/**
 * new-report-screen.js — Add a new attendance record
 *
 * Flow: date → activity type → activity name (filtered by canonical DB type).
 * Instructor assignments load once (not per date). Extended search is lazy.
 */

import { createIcon } from '../components/icon.js';
import { createInputField, createSelectField } from '../components/field.js';
import { createSearchableSelect } from '../components/searchable-select.js';
import { createCompactSelect } from '../components/compact-select.js';
import { createTimePicker } from '../components/time-picker.js';
import {
  getInstructorActivities,
  getMeetingNoForActivityOnDate,
  getSchoolOptions,
  calcHours,
  getAllAuthoritySchoolList,
  deriveAuthoritySchoolListFromActivities,
  instructorActivitySelectOptions,
  searchCanonicalActivities,
  activityMatchesReportType,
  activitySearchHaystack,
  HEBREW_ACTIVITY_TYPES,
  ONLINE_REPORT_TYPE,
  TRAINING_REPORT_TYPE,
  NO_ACTIVITY_NAME_REPORT_TYPES,
  OPEN_FIELD_REPORT_TYPES,
} from '../services/activities.service.js';
import {
  createRecord,
  getMonthApproval,
  createAttachmentRecord,
} from '../services/attendance.service.js';
import { canEditMonth, editBlockReason, getMonthKey } from '../services/month-gate.service.js';
import { uploadAttachment } from '../services/storage.service.js';

const TIME_MINUTE_STEP = 5;

function activityRowId(activity) {
  return String(activity?.row_id || activity?.id || '').trim();
}

function nextMinuteStepTime(startTime) {
  const match = String(startTime || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return '';
  const total = parseInt(match[1], 10) * 60 + parseInt(match[2], 10) + TIME_MINUTE_STEP;
  if (total >= 24 * 60) return '23:59';
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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

function makeFormSection(title, variant, bodyClass, fields) {
  const section = document.createElement('section');
  section.className = `av2-form-section av2-form-section--${variant}`;
  const heading = document.createElement('h2');
  heading.className = 'av2-form-section__title';
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = `av2-form-section__body ${bodyClass || ''}`.trim();
  for (const field of fields) body.append(field);
  section.append(heading, body);
  return section;
}

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

  const lockBanner = document.createElement('div');
  lockBanner.className = 'av2-report__lock-banner';
  lockBanner.hidden = true;

  const formArea = document.createElement('div');
  formArea.className = 'av2-report__form-area';

  inner.append(header, lockBanner, formArea);
  wrap.append(inner);
  container.append(wrap);

  let selectedActivity = null;
  let instructorActivities = [];
  /** @type {Map<string, object>} */
  const extendedActivityByRowId = new Map();
  let assignmentAuthoritySchoolData = [];
  let allAuthoritySchoolData = [];
  let pendingFiles = [];
  let formLocked = false;
  let previousReportType = '';

  let schoolId = null;
  let schoolName = '';
  let semelMosad = null;
  let manualAuthId = null;
  let manualAuthName = '';
  let manualSchoolId = null;
  let manualSchoolName = '';

  let authSel = null;
  let schoolSel = null;
  let schoolMount = null;
  let typeField = null;
  let activityNameSel = null;
  let activityNameWrap = null;
  let trainingDescField = null;
  let trainingDescWrap = null;
  let meetingField = null;
  let dateField = null;
  let startPicker = null;
  let endPicker = null;
  let saveBtn = null;
  let errorEl = null;
  let hoursVal = null;
  let kmField = null;
  let expField = null;
  let expDetailField = null;
  let notesField = null;
  let attachmentUi = null;

  function getReportDate() {
    return dateField?.input?.value || defaultDate;
  }

  function getReportType() {
    return typeField?.input?.value || '';
  }

  function isOnlineReportType(reportType = getReportType()) {
    return reportType === ONLINE_REPORT_TYPE;
  }

  function isNoActivityNameType(reportType = getReportType()) {
    return NO_ACTIVITY_NAME_REPORT_TYPES.includes(reportType);
  }

  function isOpenFieldType(reportType = getReportType()) {
    return OPEN_FIELD_REPORT_TYPES.includes(reportType);
  }

  function requiresActivityName(reportType = getReportType()) {
    return reportType && !isNoActivityNameType(reportType) && !isOpenFieldType(reportType);
  }

  function findActivityByRowId(rowId) {
    const id = String(rowId || '').trim();
    if (!id) return null;
    return instructorActivities.find((item) => activityRowId(item) === id)
      || extendedActivityByRowId.get(id)
      || null;
  }

  function rememberExtendedActivity(activity) {
    const id = activityRowId(activity);
    if (id) extendedActivityByRowId.set(id, activity);
  }

  function flatSchoolOptions(sourceData, authorityId = null) {
    const allSchoolsFlat = sourceData.flatMap((a) =>
      (a.schools || []).map((s) => ({
        value: String(s.id),
        label: a.authority_name ? `${s.name} — ${a.authority_name}` : (s.name || String(s.id)),
        authority_id: a.authority_id,
        authority_name: a.authority_name,
        semel_mosad: s.semel_mosad ?? null,
        searchText: [s.name, a.authority_name, s.semel_mosad].filter(Boolean).join(' ').toLowerCase(),
      })),
    );
    return authorityId
      ? allSchoolsFlat.filter((s) => s.authority_id === authorityId)
      : allSchoolsFlat;
  }

  function defaultAuthorityOptions() {
    const source = isOpenFieldType() ? allAuthoritySchoolData : assignmentAuthoritySchoolData;
    return source.map((a) => ({
      value: String(a.authority_id),
      label: a.authority_name,
      searchText: String(a.authority_name || '').toLowerCase(),
    }));
  }

  function setActivityNameVisible(visible) {
    if (activityNameWrap) activityNameWrap.hidden = !visible;
  }

  function setTrainingDescVisible(visible) {
    if (trainingDescWrap) trainingDescWrap.hidden = !visible;
  }

  function setActivityNameEnabled(enabled) {
    activityNameSel?.setDisabled(!enabled);
  }

  function setMeetingEnabled(enabled) {
    if (meetingField?.select) meetingField.select.disabled = !enabled;
  }

  function syncKmForReportType(newType, prevType) {
    if (!kmField?.input) return;
    if (newType === ONLINE_REPORT_TYPE) {
      kmField.input.value = '0';
      kmField.input.readOnly = true;
      kmField.input.disabled = true;
      return;
    }
    if (prevType === ONLINE_REPORT_TYPE) {
      kmField.input.readOnly = false;
      kmField.input.disabled = false;
      kmField.input.value = '';
    }
  }

  function mountManualSchoolSelect() {
    schoolMount.innerHTML = '';
    const source = isOpenFieldType() ? allAuthoritySchoolData : assignmentAuthoritySchoolData;

    function schoolOptsFor(authorityId) {
      return flatSchoolOptions(source, authorityId);
    }

    schoolSel = createSearchableSelect({
      id: 'av2-school',
      label: 'בית ספר',
      options: schoolOptsFor(manualAuthId),
      placeholder: 'בחר בית ספר…',
      searchPlaceholder: 'חיפוש בית ספר…',
      filterFn: (option, q) => String(option.searchText || option.label || '').includes(q),
      extendedSearch: {
        label: 'חיפוש מורחב',
        loadOptions: async (query) => {
          const opts = flatSchoolOptions(allAuthoritySchoolData, manualAuthId);
          const q = query.trim().toLowerCase();
          if (!q) return opts;
          return opts.filter((o) => String(o.searchText || o.label || '').includes(q));
        },
      },
      onChange(value, lbl, opt) {
        if (selectedActivity && !isOpenFieldType()) {
          clearLinkedActivity({ keepManualLocation: true });
        }
        if (value) {
          manualSchoolId = Number(value);
          manualSchoolName = (opt?.label || lbl || '').split(' — ')[0]?.trim() || lbl || '';
          semelMosad = opt?.semel_mosad ?? null;
          if (opt?.authority_id && opt.authority_id !== manualAuthId) {
            manualAuthId = opt.authority_id;
            manualAuthName = opt.authority_name || '';
            authSel?.setValue(String(opt.authority_id), opt.authority_name || '');
            schoolSel.setOptions(schoolOptsFor(manualAuthId));
          }
        } else {
          manualSchoolId = null;
          manualSchoolName = '';
          semelMosad = null;
        }
      },
    });
    schoolMount.append(schoolSel.wrap);
    return { schoolOptsFor };
  }

  function mountMultiSchoolSelect(activity) {
    schoolMount.innerHTML = '';
    schoolId = null;
    schoolName = '';
    semelMosad = null;
    const schoolOptions = getSchoolOptions(activity);
    const schoolWrap = document.createElement('div');
    schoolWrap.className = 'av2-field';
    const schoolLbl = document.createElement('label');
    schoolLbl.className = 'av2-field__label';
    schoolLbl.textContent = 'בית ספר';
    schoolLbl.htmlFor = 'av2-school-select';
    const schoolSelect = document.createElement('select');
    schoolSelect.id = 'av2-school-select';
    schoolSelect.className = 'av2-field__select';
    const defOpt = document.createElement('option');
    defOpt.value = '';
    defOpt.textContent = 'בחר בית ספר…';
    schoolSelect.append(defOpt);
    for (const s of schoolOptions) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.dataset.name = s.name;
      opt.dataset.semel = s.semel_mosad || '';
      opt.textContent = s.name + (s.semel_mosad ? ` (${s.semel_mosad})` : '');
      schoolSelect.append(opt);
    }
    schoolSelect.addEventListener('change', () => {
      const opt = schoolSelect.selectedOptions[0];
      if (opt?.value) {
        schoolId = Number(opt.value);
        schoolName = opt.dataset.name;
        semelMosad = opt.dataset.semel ? Number(opt.dataset.semel) : null;
      } else {
        schoolId = null;
        schoolName = '';
        semelMosad = null;
      }
    });
    schoolWrap.append(schoolLbl, schoolSelect);
    schoolMount.append(schoolWrap);
  }

  function mountReadonlySchool(activity) {
    schoolMount.innerHTML = '';
    const sf = createInputField({
      id: 'av2-school-readonly',
      label: 'בית ספר',
      value: activity.school_link_status === 'single_school' ? (activity.single_school_name || '') : '',
      placeholder: activity.school_link_status === 'authority_or_place_only' ? 'רשות / מקום בלבד' : 'שם בית הספר',
    });
    if (activity.school_link_status === 'single_school') sf.input.readOnly = true;
    schoolId = activity.single_school_id || null;
    schoolName = activity.single_school_name || '';
    semelMosad = activity.single_semel_mosad || null;
    schoolMount.append(sf.wrap);
  }

  function clearLinkedActivity({ keepManualLocation = false } = {}) {
    selectedActivity = null;
    schoolId = null;
    schoolName = '';
    if (!keepManualLocation) {
      semelMosad = null;
      manualAuthId = null;
      manualAuthName = '';
      manualSchoolId = null;
      manualSchoolName = '';
      authSel?.setValue('', '');
      authSel?.setDisabled(false);
      const { schoolOptsFor } = mountManualSchoolSelect();
      schoolSel?.setOptions(schoolOptsFor(manualAuthId));
    }
    activityNameSel?.reset();
    setMeetingEnabled(true);
    meetingField?.setValue('');
  }

  function refreshActivityNameOptions({ preserveSelection = true } = {}) {
    if (!activityNameSel) return;
    const reportType = getReportType();
    if (!requiresActivityName(reportType)) return;

    const options = instructorActivitySelectOptions(instructorActivities, { reportType });
    const current = preserveSelection ? activityNameSel.getValue() : '';
    activityNameSel.setOptions(options);

    if (current && options.some((opt) => opt.value === current)) {
      const match = options.find((opt) => opt.value === current);
      activityNameSel.setValue(current, match?.label || '');
      selectedActivity = findActivityByRowId(current);
    } else if (preserveSelection && current) {
      clearLinkedActivity();
    }
  }

  async function syncMeetingForSelectedDate() {
    if (!selectedActivity) return;
    const meetingNo = await getMeetingNoForActivityOnDate(
      instructor.empId,
      activityRowId(selectedActivity),
      getReportDate(),
    );
    if (meetingNo != null) {
      meetingField.setValue(String(meetingNo));
      setMeetingEnabled(false);
    } else {
      setMeetingEnabled(true);
    }
  }

  function syncAuthoritySchoolFromActivity(activity) {
    manualAuthId = activity.authority_id || null;
    manualAuthName = activity.authority_name || activity.authority || '';
    authSel.setValue(
      activity.authority_id ? String(activity.authority_id) : '',
      manualAuthName,
    );
    authSel.setDisabled(true);

    if (activity.school_link_status === 'multiple_schools') {
      mountMultiSchoolSelect(activity);
    } else if (activity.school_link_status === 'single_school') {
      mountReadonlySchool(activity);
    } else {
      mountReadonlySchool(activity);
    }
  }

  async function applySelectedActivity(activity) {
    if (!activity) {
      clearLinkedActivity();
      return;
    }

    rememberExtendedActivity(activity);
    selectedActivity = activity;

    const rowId = activityRowId(activity);
    const reportType = getReportType();
    const options = instructorActivitySelectOptions(instructorActivities, { reportType });
    const match = options.find((opt) => opt.value === rowId)
      || instructorActivitySelectOptions([activity], { reportType })[0];
    if (match) {
      activityNameSel.setOptions([
        ...options.filter((opt) => opt.value !== rowId),
        match,
      ].sort((a, b) => a.label.localeCompare(b.label, 'he')));
      activityNameSel.setValue(rowId, match.label);
    }

    syncAuthoritySchoolFromActivity(activity);
    await syncMeetingForSelectedDate();
  }

  function onActivityTypeChange() {
    const newType = getReportType();
    const prevType = previousReportType;
    previousReportType = newType;

    syncKmForReportType(newType, prevType);

    if (isNoActivityNameType(newType)) {
      clearLinkedActivity();
      setActivityNameVisible(false);
      setTrainingDescVisible(false);
      authSel?.setDisabled(false);
      mountManualSchoolSelect();
      return;
    }

    if (isOpenFieldType(newType)) {
      clearLinkedActivity();
      setActivityNameVisible(false);
      setTrainingDescVisible(true);
      authSel?.setOptions(defaultAuthorityOptions());
      authSel?.setDisabled(false);
      mountManualSchoolSelect();
      return;
    }

    setActivityNameVisible(true);
    setTrainingDescVisible(false);

    if (selectedActivity) {
      if (newType === ONLINE_REPORT_TYPE) {
        const stillAssigned = instructorActivities.some(
          (item) => activityRowId(item) === activityRowId(selectedActivity),
        ) || extendedActivityByRowId.has(activityRowId(selectedActivity));
        if (!stillAssigned) clearLinkedActivity();
      } else if (!activityMatchesReportType(selectedActivity, newType)) {
        clearLinkedActivity();
      }
    }

    authSel?.setOptions(defaultAuthorityOptions());
    refreshActivityNameOptions({ preserveSelection: true });
    setActivityNameEnabled(!!newType);

    if (selectedActivity) {
      syncAuthoritySchoolFromActivity(selectedActivity);
    } else {
      authSel?.setDisabled(false);
      mountManualSchoolSelect();
    }
  }

  async function onReportDateChange() {
    const dateStr = getReportDate();
    if (!dateStr) return;

    const [y, m] = dateStr.split('-').map(Number);
    const monthKey = getMonthKey(y, m);
    try {
      const approval = await getMonthApproval(instructor.empId, monthKey);
      if (!canEditMonth(y, m, approval)) {
        lockBanner.innerHTML = `<p>${editBlockReason(y, m, approval)}</p>`;
        lockBanner.hidden = false;
        formArea.querySelector('form')?.querySelectorAll('input,select,button,.av2-ssel__trigger,.av2-csel__trigger')
          .forEach((el) => { el.disabled = true; });
        formLocked = true;
        return;
      }
    } catch {}

    lockBanner.hidden = true;
    formLocked = false;
    formArea.querySelector('form')?.querySelectorAll('input,select,button,.av2-ssel__trigger,.av2-csel__trigger')
      .forEach((el) => {
        if (el === kmField?.input && isOnlineReportType()) {
          el.disabled = true;
          return;
        }
        el.disabled = false;
      });

    await syncMeetingForSelectedDate();
  }

  function syncEndTimeConstraints() {
    const startTime = startPicker.getValue();
    if (!startTime) {
      endPicker.setMinTime('');
      return;
    }
    endPicker.setMinTime(nextMinuteStepTime(startTime));
  }

  function updateHoursDisplay() {
    const h = calcHours(startPicker.getValue(), endPicker.getValue());
    hoursVal.textContent = h > 0 ? h.toFixed(2) : '—';
  }

  function buildForm(prefill = null) {
    formArea.innerHTML = '';
    selectedActivity = null;
    pendingFiles.length = 0;
    previousReportType = prefill?.activity_type || '';

    if (prefill) {
      const dupNote = document.createElement('p');
      dupNote.className = 'av2-report__dup-note';
      dupNote.textContent = `שכפול מדיווח מ-${prefill.report_date || ''} — ניתן לערוך לפני השמירה`;
      formArea.append(dupNote);
    }

    const form = document.createElement('form');
    form.className = 'av2-report__form';
    form.noValidate = true;

    const initialReportType = prefill?.activity_type || '';

    dateField = createInputField({
      id: 'av2-report-date',
      label: 'תאריך *',
      type: 'date',
      value: prefill?.report_date || defaultDate,
    });

    const typeOptions = [
      { value: '', label: 'בחר' },
      ...HEBREW_ACTIVITY_TYPES.map((t) => ({ value: t, label: t })),
    ];
    if (initialReportType && !typeOptions.some((opt) => opt.value === initialReportType)) {
      typeOptions.push({ value: initialReportType, label: initialReportType });
    }
    typeField = createSelectField({
      id: 'av2-activity-type',
      label: 'סוג פעילות *',
      options: typeOptions,
      value: initialReportType,
    });

    activityNameWrap = document.createElement('div');
    activityNameSel = createSearchableSelect({
      id: 'av2-activity-name',
      label: 'שם פעילות *',
      options: instructorActivitySelectOptions(instructorActivities, { reportType: initialReportType }),
      placeholder: 'בחר פעילות מהשיבוצים שלך',
      searchPlaceholder: 'חיפוש פעילות…',
      emptyText: 'לא נמצאו פעילויות',
      filterFn: (option, q) => String(option.searchText || option.label || '').includes(q),
      extendedSearch: {
        label: 'חיפוש מורחב',
        loadOptions: async (query) => {
          const rows = await searchCanonicalActivities({
            query,
            reportType: getReportType(),
            referenceDateStr: getReportDate(),
          });
          for (const row of rows) rememberExtendedActivity(row);
          return instructorActivitySelectOptions(rows, { reportType: getReportType() });
        },
      },
      onChange(value) {
        if (!value) {
          clearLinkedActivity();
          return;
        }
        const activity = findActivityByRowId(value);
        if (activity) void applySelectedActivity(activity);
      },
    });
    activityNameWrap.append(activityNameSel.wrap);

    trainingDescWrap = document.createElement('div');
    trainingDescWrap.hidden = true;
    trainingDescField = createInputField({
      id: 'av2-training-desc',
      label: 'תיאור ההכשרה',
      placeholder: 'תיאור ההכשרה (אופציונלי)',
      value: prefill?.activity_type === TRAINING_REPORT_TYPE
        ? (prefill.activity_name_snapshot || '')
        : '',
    });
    trainingDescWrap.append(trainingDescField.wrap);

    authSel = createSearchableSelect({
      id: 'av2-authority',
      label: 'רשות *',
      options: defaultAuthorityOptions(),
      placeholder: 'בחר רשות…',
      searchPlaceholder: 'חיפוש רשות…',
      filterFn: (option, q) => String(option.searchText || option.label || '').includes(q),
      extendedSearch: {
        label: 'חיפוש מורחב',
        loadOptions: async (query) => {
          const q = query.trim().toLowerCase();
          const opts = allAuthoritySchoolData.map((a) => ({
            value: String(a.authority_id),
            label: a.authority_name,
            searchText: String(a.authority_name || '').toLowerCase(),
          }));
          if (!q) return opts;
          return opts.filter((o) => o.searchText.includes(q));
        },
      },
      onChange(value, lbl) {
        if (selectedActivity) clearLinkedActivity({ keepManualLocation: true });
        manualAuthId = value ? Number(value) : null;
        manualAuthName = lbl || '';
        if (schoolSel) {
          const source = isOpenFieldType() ? allAuthoritySchoolData : assignmentAuthoritySchoolData;
          schoolSel.setOptions(flatSchoolOptions(source, manualAuthId));
          if (manualSchoolId) {
            const filtered = flatSchoolOptions(source, manualAuthId);
            const stillValid = filtered.some((s) => s.value === String(manualSchoolId));
            if (!stillValid) {
              manualSchoolId = null;
              manualSchoolName = '';
              semelMosad = null;
              schoolSel.reset();
            }
          }
        }
      },
    });

    schoolMount = document.createElement('div');
    schoolMount.className = 'av2-report__school-mount';
    mountManualSchoolSelect();

    const meetingVal = prefill?.meeting_no != null ? String(prefill.meeting_no) : '';
    const meetingOptions = [{ value: '', label: '—' }];
    for (let i = 1; i <= 20; i++) meetingOptions.push({ value: String(i), label: String(i) });
    meetingField = createCompactSelect({
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

    const activitySection = makeFormSection(
      'פרטי פעילות',
      'activity',
      'av2-form-section__body--activity',
      [
        dateField.wrap,
        typeField.wrap,
        activityNameWrap,
        trainingDescWrap,
        authSel.wrap,
        schoolMount,
        meetingWrap,
      ],
    );

    startPicker = createTimePicker('av2-start-time', 'שעת התחלה', prefill?.start_time || '', TIME_MINUTE_STEP);
    endPicker = createTimePicker('av2-end-time', 'שעת סיום', prefill?.end_time || '', TIME_MINUTE_STEP);

    const hoursDisplay = document.createElement('div');
    hoursDisplay.className = 'av2-report__hours-display av2-field';
    const hoursLbl = document.createElement('span');
    hoursLbl.className = 'av2-report__hours-label';
    hoursLbl.textContent = 'סה״כ שעות';
    hoursVal = document.createElement('span');
    hoursVal.className = 'av2-report__hours-value';
    hoursDisplay.append(hoursLbl, hoursVal);

    kmField = createInputField({
      id: 'av2-km',
      label: 'קילומטר',
      type: 'number',
      value: prefill?.roundtrip_km ? String(prefill.roundtrip_km) : '',
      attrs: { min: '0', step: '1', placeholder: '0' },
    });

    const timesSection = makeFormSection(
      'זמנים ונסיעות',
      'times',
      'av2-form-section__body--times',
      [startPicker.wrap, endPicker.wrap, hoursDisplay, kmField.wrap],
    );

    expField = createInputField({
      id: 'av2-expenses',
      label: 'סה"כ הוצאות (₪)',
      type: 'number',
      value: prefill?.expenses ? String(prefill.expenses) : '',
      attrs: { min: '0', step: '0.01', placeholder: '0.00' },
    });
    expDetailField = createInputField({
      id: 'av2-expense-detail',
      label: 'פירוט הוצאות',
      placeholder: 'פרט את ההוצאות',
      value: prefill?.expense_details || '',
    });
    attachmentUi = buildAttachmentSection(pendingFiles);

    notesField = createInputField({
      id: 'av2-notes',
      label: 'הערות נוספות',
      placeholder: 'הערות נוספות (אופציונלי)',
      value: prefill?.notes || '',
    });

    const expensesHeading = document.createElement('h3');
    expensesHeading.className = 'av2-form-section__subtitle';
    expensesHeading.textContent = 'הוצאות';
    const expensesInner = document.createElement('div');
    expensesInner.className = 'av2-form-section__sub av2-form-section__sub--expenses';
    expensesInner.append(expensesHeading, expField.wrap, expDetailField.wrap, attachmentUi.section);

    const notesHeading = document.createElement('h3');
    notesHeading.className = 'av2-form-section__subtitle';
    notesHeading.textContent = 'הערות';
    const notesInner = document.createElement('div');
    notesInner.className = 'av2-form-section__sub av2-form-section__sub--notes';
    notesInner.append(notesHeading, notesField.wrap);

    const bottomSection = makeFormSection(
      'הוצאות והערות',
      'bottom',
      'av2-form-section__body--bottom',
      [expensesInner, notesInner],
    );
    bottomSection.querySelector('.av2-form-section__title').remove();

    form.append(activitySection, timesSection, bottomSection);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'av2-report__actions';
    saveBtn = document.createElement('button');
    saveBtn.type = 'submit';
    saveBtn.className = 'av2-btn av2-btn--primary av2-report__save';
    const saveLbl = document.createElement('span');
    saveLbl.textContent = 'שמירת דיווח';
    saveBtn.append(createIcon('check'), saveLbl);
    actionsRow.append(saveBtn);
    form.append(actionsRow);

    errorEl = document.createElement('p');
    errorEl.className = 'av2-report__error';
    errorEl.hidden = true;
    form.append(errorEl);

    typeField.input.addEventListener('change', () => { onActivityTypeChange(); });
    dateField.input.addEventListener('change', () => { void onReportDateChange(); });

    startPicker.hourSel.addEventListener('change', () => {
      syncEndTimeConstraints();
      updateHoursDisplay();
    });
    startPicker.minSel.addEventListener('change', () => {
      syncEndTimeConstraints();
      updateHoursDisplay();
      if (startPicker.hourSel.value !== '' && startPicker.minSel.value !== '') {
        endPicker.hourSel.focus();
      }
    });
    endPicker.hourSel.addEventListener('change', updateHoursDisplay);
    endPicker.minSel.addEventListener('change', () => {
      endPicker.minSel.blur();
      updateHoursDisplay();
    });

    syncEndTimeConstraints();
    updateHoursDisplay();

    if (initialReportType) {
      onActivityTypeChange();
    } else {
      setActivityNameVisible(false);
      setTrainingDescVisible(false);
      setActivityNameEnabled(false);
    }

    if (prefill) {
      const prefAuthName = prefill.authority_name_snapshot || '';
      const prefSchoolName = prefill.school_name_snapshot || '';
      if (prefAuthName) {
        const matchAuth = [...assignmentAuthoritySchoolData, ...allAuthoritySchoolData]
          .find((a) => a.authority_name === prefAuthName);
        if (matchAuth) {
          authSel.setValue(String(matchAuth.authority_id), matchAuth.authority_name);
          manualAuthId = matchAuth.authority_id;
          manualAuthName = matchAuth.authority_name;
        } else {
          authSel.setValue('', prefAuthName);
          manualAuthName = prefAuthName;
        }
      }
      if (prefSchoolName && schoolSel) {
        const source = isOpenFieldType() ? allAuthoritySchoolData : assignmentAuthoritySchoolData;
        const filtered = flatSchoolOptions(source, manualAuthId);
        schoolSel.setOptions(filtered);
        const matchSchool = filtered.find((s) => s.label.startsWith(prefSchoolName) || s.label.includes(prefSchoolName));
        if (matchSchool) {
          schoolSel.setValue(matchSchool.value, matchSchool.label);
          manualSchoolId = Number(matchSchool.value);
          manualSchoolName = prefSchoolName;
          semelMosad = matchSchool.semel_mosad ?? null;
        } else {
          schoolSel.setValue('', prefSchoolName);
          manualSchoolName = prefSchoolName;
        }
      }
      if (prefill.activity_row_id) {
        const match = findActivityByRowId(prefill.activity_row_id);
        if (match) void applySelectedActivity(match);
      }
    }

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
      if (formLocked) return;

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

      const dateStr = getReportDate();
      const startTime = startPicker.getValue();
      const endTime = endPicker.getValue();
      const totalHours = calcHours(startTime, endTime);
      const activity = selectedActivity;
      const reportType = getReportType();
      const isNoActivity = isNoActivityNameType(reportType);
      const isOpen = isOpenFieldType(reportType);
      const isOnline = isOnlineReportType(reportType);

      errorEl.hidden = true;
      [activityNameSel?.wrap, typeField.wrap, startPicker.wrap, endPicker.wrap, authSel.wrap]
        .forEach((w) => w?.classList.remove('av2-field--invalid'));

      const missing = [];
      let firstInvalid = null;
      function markInvalid(wrap, msg) {
        wrap?.classList.add('av2-field--invalid');
        missing.push(msg);
        if (!firstInvalid) firstInvalid = wrap;
      }

      if (!reportType) markInvalid(typeField.wrap, 'סוג פעילות');
      if (requiresActivityName(reportType) && !activityNameSel.getLabel().trim()) {
        markInvalid(activityNameSel.wrap, 'שם פעילות');
      }
      if (!dateStr) markInvalid(dateField.wrap, 'תאריך');
      if (!startTime) markInvalid(startPicker.wrap, 'שעת התחלה');
      if (!endTime) markInvalid(endPicker.wrap, 'שעת סיום');
      if (startTime && endTime && totalHours <= 0) {
        markInvalid(endPicker.wrap, 'שעת סיום חייבת להיות מאוחרת מהתחלה');
      }
      if (!activity && !isNoActivity && !isOpen) {
        const authLabel = manualAuthName?.trim() || '';
        if (!authLabel) markInvalid(authSel.wrap, 'רשות');
      }
      if (isOpen) {
        const authLabel = manualAuthName?.trim() || '';
        if (!authLabel) markInvalid(authSel.wrap, 'רשות');
      }

      if (missing.length) {
        errorEl.textContent = `שדות חובה חסרים: ${[...new Set(missing)].join(' · ')}`;
        errorEl.hidden = false;
        firstInvalid?.querySelector('input,select,button,.av2-csel__trigger,.av2-ssel__trigger')?.focus();
        return;
      }

      const finalAuthorityId = activity?.authority_id ?? manualAuthId ?? null;
      const finalAuthorityName = activity?.authority_name ?? activity?.authority ?? manualAuthName ?? null;
      const finalSchoolId = activity ? (schoolId || null) : (manualSchoolId || null);
      const finalSchoolName = activity ? (schoolName || null) : (manualSchoolName || null);

      let activityNameSnapshot = null;
      if (isOpen) {
        activityNameSnapshot = trainingDescField.input.value.trim() || TRAINING_REPORT_TYPE;
      } else if (requiresActivityName(reportType)) {
        activityNameSnapshot = activityNameSel.getLabel().trim() || (activity?.activity_name ?? null);
      } else if (isNoActivity) {
        activityNameSnapshot = reportType;
      }

      const programName = activity?.program_name || activityNameSnapshot || null;

      let kmValue = 0;
      if (isOnline) {
        kmValue = 0;
      } else {
        kmValue = kmField.input.value ? Number(kmField.input.value) : 0;
      }
      if (isOnline && kmValue > 0) kmValue = 0;

      const summaryConfirmed = await showReportSummaryDialog({
        reportDate: dateStr,
        activityType: reportType || '—',
        authority: finalAuthorityName || '—',
        school: finalSchoolName || '—',
        program: programName || '—',
        meetingNo: meetingField.getValue() || '—',
        startTime,
        endTime,
        totalHours: totalHours > 0 ? totalHours.toFixed(2) : '—',
        km: String(kmValue),
        expenses: expField.input.value || '0',
        notes: notesField.input.value.trim() || '—',
        attachments: pendingFiles.map((file) => file.name),
      });
      if (!summaryConfirmed) return;

      saveBtn.disabled = true;
      saveBtn.querySelector('span').textContent = 'שומר…';

      try {
        const payload = {
          report_date: dateStr,
          start_time: startTime,
          end_time: endTime,
          total_hours: totalHours,
          activity_type: reportType,
          activity_id: activity?.id ?? null,
          activity_row_id: activity?.row_id ?? null,
          activity_no: activity?.activity_no ?? null,
          activity_season: activity?.activity_season ?? null,
          activity_name_snapshot: activityNameSnapshot,
          meeting_no: meetingField.getValue() ? Number(meetingField.getValue()) : null,
          authority_id: finalAuthorityId,
          authority_name_snapshot: finalAuthorityName,
          school_id: finalSchoolId,
          school_name_snapshot: finalSchoolName,
          semel_mosad: semelMosad || null,
          program_name: activity?.program_name ?? null,
          program_name_snapshot: programName,
          roundtrip_km: kmValue,
          expenses: expField.input.value ? Number(expField.input.value) : 0,
          expense_details: expDetailField.input.value.trim() || null,
          notes: notesField.input.value.trim() || null,
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
    void onReportDateChange();
  }

  Promise.all([
    getInstructorActivities(instructor.empId, defaultDate),
    getAllAuthoritySchoolList(instructor.empId),
  ])
    .then(([activities, allAuthorities]) => {
      instructorActivities = activities;
      assignmentAuthoritySchoolData = deriveAuthoritySchoolListFromActivities(activities);
      if (!assignmentAuthoritySchoolData.length) {
        assignmentAuthoritySchoolData = allAuthorities;
      }
      allAuthoritySchoolData = allAuthorities;
    })
    .catch(() => {})
    .finally(() => {
      buildForm(prefillRecord);
    });
}

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

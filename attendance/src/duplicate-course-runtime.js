import { supabase } from './api/client.js';
import {
  getPreviewRecords,
  isAdminPreviewRequested,
} from './preview/preview-mode.js';

const DUPLICATE_RECORD_KEY = 'av2_duplicate_record_id';
const EDIT_RECORD_KEY = 'av2_edit_record_id';
const COURSE_REPORT_TYPE = 'קורס';
const ENHANCED_ATTR = 'data-duplicate-course-enhanced';

function clean(value) {
  return String(value ?? '').trim();
}

function formatDateHe(dateStr) {
  const match = clean(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : clean(dateStr);
}

function localDateShift(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isEditFlow() {
  try {
    return !!clean(sessionStorage.getItem(EDIT_RECORD_KEY));
  } catch {
    return false;
  }
}

function rememberDuplicateRecordId(event) {
  const button = event.target.closest?.('.av2-rr__action-dup');
  if (!button) return;
  if (button.dataset.av2EditForward === '1') return;

  const row = button.closest?.('.av2-report-row');
  const recordId = clean(row?.dataset?.recordId);
  if (!recordId) return;
  try {
    sessionStorage.removeItem(EDIT_RECORD_KEY);
    sessionStorage.setItem(DUPLICATE_RECORD_KEY, recordId);
  } catch {}
}

async function loadSourceRecord(recordId, sourceDate) {
  if (isAdminPreviewRequested()) {
    const match = clean(sourceDate).match(/^(\d{4})-(\d{2})/);
    if (!match) return null;
    const rows = getPreviewRecords(Number(match[1]), Number(match[2]));
    return rows.find((row) => clean(row?.id) === recordId) || null;
  }

  const { data, error } = await supabase
    .from('attendance_records')
    .select('*')
    .eq('id', recordId)
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : data;
}

async function loadCourseSchedule(record) {
  if (isAdminPreviewRequested()) {
    const sourceMeeting = Math.max(1, Number(record?.meeting_no) || 1);
    const totalMeetings = Math.max(sourceMeeting, 10);
    return Array.from({ length: totalMeetings }, (_, index) => {
      const meetingNo = index + 1;
      return {
        meeting_no: meetingNo,
        date: localDateShift(record.report_date, (meetingNo - sourceMeeting) * 7),
      };
    }).filter((item) => item.date);
  }

  const { data, error } = await supabase.rpc('av2_get_activity_meeting_dates', {
    p_emp_id: Number(record.emp_id),
    p_activity_row_id: clean(record.activity_row_id),
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : [])
    .map((item) => ({
      meeting_no: Number(item?.meeting_no),
      date: clean(item?.date),
      start_time: clean(item?.start_time),
      end_time: clean(item?.end_time),
    }))
    .filter((item) => Number.isInteger(item.meeting_no) && item.meeting_no > 0 && /^\d{4}-\d{2}-\d{2}$/.test(item.date))
    .sort((a, b) => a.meeting_no - b.meeting_no);
}

async function loadExistingCourseReports(record, schedule) {
  if (isAdminPreviewRequested()) {
    const months = new Set(schedule.map((item) => item.date.slice(0, 7)));
    const rows = [];
    for (const monthKey of months) {
      const [year, month] = monthKey.split('-').map(Number);
      rows.push(...getPreviewRecords(year, month));
    }
    return rows.filter((row) => clean(row.activity_row_id) === clean(record.activity_row_id));
  }

  const { data, error } = await supabase
    .from('attendance_records')
    .select('id,report_date,meeting_no,activity_row_id')
    .eq('emp_id', Number(record.emp_id))
    .eq('activity_row_id', clean(record.activity_row_id));
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function chooseInitialMeeting(available) {
  return available[0] || null;
}

function setMeetingNumberThroughUi(meetingNo) {
  const trigger = document.getElementById('av2-meeting-no-trigger');
  if (!trigger || !meetingNo) return;

  const wrap = trigger.closest('.av2-csel');
  if (!wrap) return;

  const wasDisabled = trigger.disabled;
  trigger.disabled = false;
  trigger.click();
  const option = [...wrap.querySelectorAll('.av2-csel__option')]
    .find((item) => clean(item.textContent) === String(meetingNo));
  option?.click();
  trigger.disabled = wasDisabled;
}

function ensureStyles() {
  if (document.getElementById('av2-duplicate-course-runtime-style')) return;
  const style = document.createElement('style');
  style.id = 'av2-duplicate-course-runtime-style';
  style.textContent = `
    .av2-report__form--duplicate-course #av2-activity-type,
    .av2-report__form--duplicate-course #av2-activity-name-trigger,
    .av2-report__form--duplicate-course #av2-authority-trigger,
    .av2-report__form--duplicate-course #av2-school-trigger,
    .av2-report__form--duplicate-course #av2-school-select,
    .av2-report__form--duplicate-course #av2-meeting-no-trigger,
    .av2-report__form--duplicate-course .av2-time-picker .av2-csel__trigger {
      pointer-events: none !important;
      cursor: default !important;
      opacity: .78;
    }
    .av2-report__form--duplicate-course #av2-report-date {
      display: none !important;
    }
    .av2-duplicate-course-date {
      width: 100%;
      min-height: 42px;
      border: 1px solid var(--av2-border, #cbd5e1);
      border-radius: 9px;
      background: #fff;
      color: inherit;
      padding: 8px 10px;
      font: inherit;
    }
    .av2-duplicate-course-empty {
      margin: 8px 0 0;
      padding: 8px 10px;
      border-radius: 8px;
      background: #fff7ed;
      color: #9a3412;
      font-size: 12px;
      font-weight: 700;
    }
  `;
  document.head.append(style);
}

function lockDashboardFields(form) {
  form.classList.add('av2-report__form--duplicate-course');
  const selectors = [
    '#av2-activity-type',
    '#av2-activity-name-trigger',
    '#av2-authority-trigger',
    '#av2-school-trigger',
    '#av2-school-select',
    '#av2-meeting-no-trigger',
    '.av2-time-picker .av2-csel__trigger',
  ];
  form.querySelectorAll(selectors.join(',')).forEach((el) => { el.tabIndex = -1; });
}

async function enhanceDuplicateCourseForm() {
  if (isEditFlow()) return;

  const form = document.querySelector('.av2-report__form');
  const duplicateNote = document.querySelector('.av2-report__dup-note');
  const dateInput = document.getElementById('av2-report-date');
  if (!form || !duplicateNote || !dateInput || form.hasAttribute(ENHANCED_ATTR)) return;

  let recordId = '';
  try {
    recordId = clean(sessionStorage.getItem(DUPLICATE_RECORD_KEY));
  } catch {}
  if (!recordId) return;

  form.setAttribute(ENHANCED_ATTR, 'loading');

  try {
    const sourceRecord = await loadSourceRecord(recordId, dateInput.value);
    if (!sourceRecord || clean(sourceRecord.activity_type) !== COURSE_REPORT_TYPE || !clean(sourceRecord.activity_row_id)) {
      form.setAttribute(ENHANCED_ATTR, 'skipped');
      try { sessionStorage.removeItem(DUPLICATE_RECORD_KEY); } catch {}
      return;
    }

    const schedule = await loadCourseSchedule(sourceRecord);
    if (!schedule.length) {
      form.setAttribute(ENHANCED_ATTR, 'no-schedule');
      duplicateNote.textContent = 'לא נמצא מפגש הבא בדשבורד. לא ניתן ליצור שכפול.';
      const save = form.querySelector('button[type="submit"]');
      if (save) save.disabled = true;
      try { sessionStorage.removeItem(DUPLICATE_RECORD_KEY); } catch {}
      return;
    }

    const existingReports = await loadExistingCourseReports(sourceRecord, schedule).catch(() => []);
    const usedKeys = new Set(existingReports.map((row) => `${Number(row.meeting_no) || 0}|${clean(row.report_date)}`));
    const usedMeetingNos = new Set(existingReports.map((row) => Number(row.meeting_no)).filter((value) => Number.isInteger(value) && value > 0));
    const usedDates = new Set(existingReports.map((row) => clean(row.report_date)).filter(Boolean));

    const sourceMeetingNo = Number(sourceRecord.meeting_no) || 0;
    const nextMeeting = schedule.find((item) => item.meeting_no > sourceMeetingNo) || null;
    const nextMeetingAlreadyReported = !!nextMeeting && (
      usedKeys.has(`${nextMeeting.meeting_no}|${nextMeeting.date}`)
      || usedMeetingNos.has(nextMeeting.meeting_no)
      || usedDates.has(nextMeeting.date)
    );
    const available = nextMeeting && !nextMeetingAlreadyReported ? [nextMeeting] : [];

    ensureStyles();
    duplicateNote.textContent = 'שכפול חכם — הדיווח נפתח רק עבור המפגש הבא בדשבורד, גם אם הוא בחודש הבא; נסיעות והוצאות הועתקו מהדיווח הקודם.';

    const fieldWrap = dateInput.closest('.av2-field');
    const label = fieldWrap?.querySelector('.av2-field__label');
    if (label) label.textContent = 'מפגש / תאריך *';

    const dateSelect = document.createElement('select');
    dateSelect.className = 'av2-duplicate-course-date';
    dateSelect.setAttribute('aria-label', 'בחירת מפגש ותאריך לשכפול');

    if (!available.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = nextMeetingAlreadyReported ? 'המפגש הבא כבר דווח' : 'אין מפגש הבא בדשבורד';
      dateSelect.append(option);
      dateSelect.disabled = true;
      const empty = document.createElement('p');
      empty.className = 'av2-duplicate-course-empty';
      empty.textContent = nextMeetingAlreadyReported ? 'המפגש הבא בדשבורד כבר דווח ולכן לא ניתן לדלג למפגש מאוחר יותר.' : 'לא נמצא מפגש הבא בדשבורד. לא ניתן ליצור שכפול נוסף.';
      fieldWrap?.append(dateSelect, empty);
      const save = form.querySelector('button[type="submit"]');
      if (save) save.disabled = true;
      lockDashboardFields(form);
      form.setAttribute(ENHANCED_ATTR, 'yes');
      try { sessionStorage.removeItem(DUPLICATE_RECORD_KEY); } catch {}
      return;
    }

    for (const item of available) {
      const option = document.createElement('option');
      option.value = item.date;
      option.dataset.meetingNo = String(item.meeting_no);
      option.textContent = `מפגש ${item.meeting_no} — ${formatDateHe(item.date)}`;
      dateSelect.append(option);
    }

    fieldWrap?.append(dateSelect);

    const applySelection = () => {
      const option = dateSelect.selectedOptions[0];
      const selected = available.find((item) => item.date === dateSelect.value) || null;
      const meetingNo = Number(option?.dataset?.meetingNo) || selected?.meeting_no || null;
      dateInput.value = dateSelect.value;
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      form.dispatchEvent(new CustomEvent('av2:dashboard-duplicate-meeting', {
        bubbles: true,
        detail: {
          date: dateSelect.value,
          meeting_no: meetingNo,
          start_time: selected?.start_time || '',
          end_time: selected?.end_time || '',
        },
      }));
      window.setTimeout(() => {
        dateSelect.disabled = false;
        setMeetingNumberThroughUi(meetingNo);
        lockDashboardFields(form);
      }, 250);
      window.setTimeout(() => {
        dateSelect.disabled = false;
        setMeetingNumberThroughUi(meetingNo);
        lockDashboardFields(form);
      }, 900);
    };

    dateSelect.addEventListener('change', applySelection);

    const initial = chooseInitialMeeting(available);
    if (initial) dateSelect.value = initial.date;
    lockDashboardFields(form);
    applySelection();

    form.setAttribute(ENHANCED_ATTR, 'yes');
    try { sessionStorage.removeItem(DUPLICATE_RECORD_KEY); } catch {}
  } catch (error) {
    console.warn('[attendance duplicate course] enhancement failed', error);
    form.setAttribute(ENHANCED_ATTR, 'failed');
    duplicateNote.textContent = 'שכפול הדיווח נטען. לא ניתן היה לטעון אוטומטית את לוח מפגשי הקורס.';
    try { sessionStorage.removeItem(DUPLICATE_RECORD_KEY); } catch {}
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', rememberDuplicateRecordId, true);
  const observer = new MutationObserver(() => { void enhanceDuplicateCourseForm(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  void enhanceDuplicateCourseForm();
}

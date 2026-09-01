import { state } from '../../state.js';
import { formatDateHe } from './format-date.js';
import { showToast } from './toast.js';
import {
  addCalendarDays,
  blockingSchoolCalendarEvent,
  isSummerActivitySeason,
  shortenedSchoolDayConflict
} from './school-calendar-logic.js';
import { getCachedSchoolCalendarRows, loadSchoolCalendarRows } from './school-calendar-data.js';

const saveBypass = new WeakSet();
const EDEN_HOLIDAY_OVERRIDE_DATE = '2026-09-30';
const EDEN_USER_ID = '6000';
const EDEN_EMAIL = 'edenc@think.org.il';

function currentUserCanUseEdenHolidayOverride(isoDate) {
  if (String(isoDate || '').trim() !== EDEN_HOLIDAY_OVERRIDE_DATE) return false;
  const user = state?.user || {};
  const userId = String(user.user_id || '').trim();
  const email = String(user.auth_email || user.email || '').trim().toLowerCase();
  return userId === EDEN_USER_ID || email === EDEN_EMAIL;
}

function blockingEventForFormDate(form, rows, isoDate) {
  if (currentUserCanUseEdenHolidayOverride(isoDate)) return null;
  return blockingSchoolCalendarEvent(rows, isoDate);
}

function nextAllowedWeeklyDateForForm(form, rows, isoDate, maxSkips = 20) {
  let candidate = String(isoDate || '').trim();
  let skips = 0;
  while (candidate && blockingEventForFormDate(form, rows, candidate) && skips < maxSkips) {
    candidate = addCalendarDays(candidate, 7);
    skips += 1;
  }
  return candidate;
}

function meetingPickers(form) {
  return Array.from(form.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')).sort(
    (a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx)
  );
}

function activitySeason(form) {
  return String(form.querySelector('[name="activity_season"]')?.value || form.dataset.activitySeason || '').trim();
}

function chainModeActive(form) {
  return !!form.querySelector('[data-chain-toggle] [data-date-mode="chain"].is-active');
}

function refreshMeetingDateDisplay(form) {
  const pickers = meetingPickers(form);
  pickers.forEach((picker) => {
    const weekday = picker.closest('.activity-drawer__date-card')?.querySelector('.activity-drawer__weekday');
    if (!weekday) return;
    const date = new Date(`${picker.value}T12:00:00`);
    weekday.textContent = Number.isNaN(date.getTime()) ? '' : (['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][date.getDay()] || '');
  });

  const finalDate = pickers.length ? String(pickers[pickers.length - 1].value || '') : '';
  const display = form.querySelector('[data-computed-end-display]');
  if (display) display.textContent = finalDate ? (formatDateHe(finalDate) || finalDate) : '—';
  form.dataset.autoEndDate = finalDate;
}

function clearDeferralNotes(form) {
  form.querySelectorAll('[data-session-deferral-note]').forEach((note) => note.remove());
}

function setDeferralNote(picker, skippedWeeks) {
  if (!skippedWeeks) return;
  const card = picker.closest('.activity-drawer__date-card');
  if (!card) return;
  const note = document.createElement('small');
  note.dataset.sessionDeferralNote = 'true';
  note.className = 'ds-muted activity-drawer__date-deferral';
  note.textContent = skippedWeeks === 1
    ? 'נדחה בשבוע עקב חג או חופשה'
    : `נדחה ב־${skippedWeeks} שבועות עקב חג או חופשה`;
  card.appendChild(note);
}

export function generateSessionDatesFromFirstMeeting(form, blockedDatesContext = []) {
  const pickers = meetingPickers(form);
  const isOneDay = form?.dataset?.isOnce === 'yes';
  const configuredTotal = Number(form.querySelector('[name="sessions"]')?.value
    || form.querySelector('[data-session-total]')?.dataset?.sessionTotal
    || pickers.length);
  const total = isOneDay ? 1 : Math.min(pickers.length, Math.max(1, Math.floor(configuredTotal || pickers.length)));
  const firstDate = String(pickers[0]?.value || '').trim();
  const result = { dates: [], deferred: [], exhausted: false };

  clearDeferralNotes(form);
  if (!firstDate) {
    pickers.slice(1).forEach((picker) => {
      picker.value = '';
      picker.dataset.prevValue = '';
    });
    form.dataset.autoStartDate = '';
    refreshMeetingDateDisplay(form);
    return result;
  }

  let candidate = firstDate;
  for (let index = 0; index < total; index += 1) {
    if (index > 0) candidate = addCalendarDays(candidate, 7);
    let skippedWeeks = 0;
    while (blockingEventForFormDate(form, blockedDatesContext, candidate) && skippedWeeks < 52) {
      candidate = addCalendarDays(candidate, 7);
      skippedWeeks += 1;
    }
    if (!candidate || blockingEventForFormDate(form, blockedDatesContext, candidate)) {
      result.exhausted = true;
      break;
    }
    pickers[index].value = candidate;
    pickers[index].dataset.prevValue = candidate;
    result.dates.push(candidate);
    if (skippedWeeks) {
      result.deferred.push({ meeting: index + 1, skippedWeeks });
      setDeferralNote(pickers[index], skippedWeeks);
    }
  }
  pickers.slice(total).forEach((picker) => {
    picker.value = '';
    picker.dataset.prevValue = '';
  });
  form.dataset.autoStartDate = result.dates[0] || '';
  refreshMeetingDateDisplay(form);
  return result;
}

async function skipHolidaysInChain(form, changedIndex) {
  if (isSummerActivitySeason(activitySeason(form))) return false;
  const rows = await loadSchoolCalendarRows();
  const pickers = meetingPickers(form);
  const startPosition = pickers.findIndex((picker) => Number(picker.dataset.meetingIdx) === Number(changedIndex));
  if (startPosition < 0) return false;

  let candidate = String(pickers[startPosition].value || '').trim();
  if (!candidate) return false;
  let changed = false;

  for (let position = startPosition; position < pickers.length; position += 1) {
    if (position > startPosition) candidate = addCalendarDays(candidate, 7);
    const allowedDate = nextAllowedWeeklyDateForForm(form, rows, candidate);
    if (allowedDate !== String(pickers[position].value || '')) changed = true;
    pickers[position].value = allowedDate;
    pickers[position].dataset.prevValue = allowedDate;
    candidate = allowedDate;
  }

  refreshMeetingDateDisplay(form);
  return changed;
}

function validationMessage(form, rows) {
  if (isSummerActivitySeason(activitySeason(form))) return '';
  const endTime = String(form.querySelector('[name="end_time"]')?.value || '').trim();
  const dates = meetingPickers(form).map((picker) => String(picker.value || '').trim()).filter(Boolean);

  for (const isoDate of dates) {
    const holiday = blockingEventForFormDate(form, rows, isoDate);
    if (holiday) {
      return `לא ניתן לשמור פעילות ב־${formatDateHe(isoDate) || isoDate}: ${holiday.title}.`;
    }

    if (currentUserCanUseEdenHolidayOverride(isoDate)) continue;

    const shortDay = shortenedSchoolDayConflict(rows, isoDate, endTime);
    if (shortDay) {
      const limit = String(shortDay.school_day_end_time || '').slice(0, 5);
      return `לא ניתן לשמור פעילות ב־${formatDateHe(isoDate) || isoDate}: הלימודים מסתיימים בשעה ${limit}.`;
    }
  }

  return '';
}

function showValidationError(form, message) {
  const status = form.querySelector('.ds-activity-edit-status');
  if (status) {
    status.textContent = message;
    status.classList.remove('is-pending', 'is-success', 'is-warning');
    status.classList.add('is-error');
  }
  showToast(message, 'error', 4200);
}

function suppressCurrentSave(button) {
  const action = button.getAttribute('data-action');
  if (!action) return;
  button.removeAttribute('data-action');
  queueMicrotask(() => button.setAttribute('data-action', action));
}

async function validateThenResume(button, form) {
  const rows = await loadSchoolCalendarRows();
  const message = validationMessage(form, rows);
  if (message) {
    showValidationError(form, message);
    return;
  }
  saveBypass.add(form);
  button.click();
}

export function startSchoolCalendarFormGuard() {
  document.addEventListener('change', (event) => {
    const picker = event.target.closest('input[data-meeting-idx]');
    if (!picker) return;
    const form = picker.closest('[data-drawer-form]');
    if (!form) return;
    const index = Number(picker.dataset.meetingIdx);
    if (index === 0) {
      const requestedFirstDate = String(picker.value || '');
      if (!requestedFirstDate) {
        generateSessionDatesFromFirstMeeting(form, []);
        return;
      }
      form.dataset.sessionGenerationRequest = requestedFirstDate;
      void loadSchoolCalendarRows().then((rows) => {
        if (form.dataset.sessionGenerationRequest !== requestedFirstDate || String(picker.value || '') !== requestedFirstDate) return;
        const result = generateSessionDatesFromFirstMeeting(form, isSummerActivitySeason(activitySeason(form)) ? [] : rows);
        if (result.deferred.length) showToast('רצף המפגשים עודכן ודילג על ימי חופשה', 'info', 2600);
      });
      return;
    }
    if (!chainModeActive(form)) return;
    void skipHolidaysInChain(form, index).then((changed) => {
      if (changed) showToast('רצף המפגשים עודכן ודילג על ימי חופשה', 'info', 2600);
    });
  });

  document.addEventListener('click', (event) => {
    const addButton = event.target.closest('[data-action="add-meeting"]');
    if (!addButton) return;
    const form = addButton.closest('[data-drawer-form]');
    if (!form || !chainModeActive(form)) return;
    setTimeout(() => {
      const pickers = meetingPickers(form);
      const last = pickers[pickers.length - 1];
      if (!last) return;
      void skipHolidaysInChain(form, Number(last.dataset.meetingIdx));
    }, 0);
  });

  document.addEventListener('click', (event) => {
    const saveButton = event.target.closest('[data-action="save-edit"]');
    if (!saveButton) return;
    const form = saveButton.closest('[data-drawer-form]');
    if (!form) return;

    if (saveBypass.has(form)) {
      saveBypass.delete(form);
      return;
    }

    const rows = getCachedSchoolCalendarRows();
    if (!rows) {
      event.preventDefault();
      suppressCurrentSave(saveButton);
      void validateThenResume(saveButton, form);
      return;
    }

    const message = validationMessage(form, rows);
    if (!message) return;
    event.preventDefault();
    suppressCurrentSave(saveButton);
    showValidationError(form, message);
  }, true);
}

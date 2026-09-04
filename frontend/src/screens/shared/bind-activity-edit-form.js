import { translateApiErrorForUser } from './ui-hebrew.js';
import { showToast } from './toast.js';
import { formatDateHe } from './format-date.js';
import { escapeHtml } from './html.js';
import { syncActivityEndTimeOptions } from './activity-time-options.js';
import { applyActivityDrawerLayoutPipeline } from '../../activity-drawer-layout-pipeline.js';
import { guardInitialValueRefreshWhileEditing } from '../../activity-drawer-edit-dedup.js';
import { applyApprovedDrawerFixes } from '../../activity-drawer-approved-fixes.js';
import { activityTypeMatches, getValidInstructorUsers, humanDisplayText, INSTRUCTOR_CONTACTS_MISSING_ERROR_MESSAGE, INSTRUCTOR_IDENTITY_ERROR_MESSAGE, isCanonicalActivityTypeKey, normalizeActivityTypeKey, normalizeOneDayActivityType, resolveInstructorSelectionByEmpId, validateInstructorIdentityPayload } from './activity-options.js';
import { catalogActivityChangesFromSelection, selectedActivityCatalogIdentity, syncActivityCatalogIdentityFromName } from '../../activity-catalog-identity.js';
import { validateCourseFundingSplit } from '../../activity-funding-picker-compact.js';
import { generateSessionDatesFromFirstMeeting } from './school-calendar-form-guard.js';
import { loadSchoolCalendarRows } from './school-calendar-data.js';
import { isSummerActivitySeason } from './school-calendar-logic.js';
import { resolveAuthorityRecord, resolveSchoolRecord, schoolsForAuthority } from './activity-form-rules.js';
import {
  READ_ONLY_ACTIVITY_PERIOD_MESSAGE,
  isActivityMutationBlocked
} from './activity-readonly-period.js';

/**
 * Event-level guard for the historical 2026 period: even a direct click handler call
 * must not be able to start an edit, save, or delete a read-only activity.
 */
function isReadOnlyActivityForm(form, appState = {}) {
  if (!form) return false;
  if (String(form.dataset.activityReadOnly || '') === 'yes') return true;
  return isActivityMutationBlocked({
    activityPeriod: String(appState?.activityPeriodTab || ''),
    activitySeason: String(form.getAttribute('data-activity-season') || '')
  });
}

function blockReadOnlyActivityMutation(form, appState = {}) {
  if (!isReadOnlyActivityForm(form, appState)) return false;
  setStatus(form?.querySelector?.('.ds-activity-edit-status'), 'is-error', READ_ONLY_ACTIVITY_PERIOD_MESSAGE);
  showToast(READ_ONLY_ACTIVITY_PERIOD_MESSAGE, 'error', 3200);
  return true;
}

function setEditMode(form, editing) {
  form.dataset.editing = editing ? 'yes' : 'no';
  form.querySelectorAll('[data-mode="view"]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-mode="edit"]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-view-only]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-edit-only]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-edit-actions]').forEach((el) => el.toggleAttribute('hidden', !editing));
  const editBtn = form.querySelector('[data-action="start-edit"]');
  if (editBtn) editBtn.toggleAttribute('hidden', editing);
  const existsInGefen = form.querySelector('[data-gefen-exists-checkbox]');
  if (existsInGefen) existsInGefen.disabled = !editing;
  syncMeetingRemoveButtons(form);
}

function setStatus(statusEl, kind, text) {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.classList.remove('is-pending', 'is-error', 'is-success', 'is-warning');
  if (kind) statusEl.classList.add(kind);
}

const HUMAN_DISPLAY_FIELDS = new Set([
  'instructor_name',
  'instructor_name_2',
  'activity_manager',
  'previous_activity_manager',
  'school',
  'school_name',
  'authority',
  'activity_name',
  'program_name',
  'name',
  'title'
]);

function decodeFormRecords(value) {
  try {
    const parsed = JSON.parse(decodeURIComponent(String(value || '')));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function syncActivityEditLocation(form, { resetInvalidSchool = false } = {}) {
  const authorityInput = form?.querySelector?.('[data-role="activity-authority"]');
  const authorityIdInput = form?.querySelector?.('[data-role="activity-authority-id"]');
  const schoolInput = form?.querySelector?.('[data-role="activity-school"]');
  const schoolIdInput = form?.querySelector?.('[data-role="activity-school-id"]');
  const schoolList = form?.querySelector?.('[data-role="activity-school-options"]');
  if (!authorityInput || !authorityIdInput || !schoolInput || !schoolIdInput) return { valid: true, values: null };

  const authorityRecords = decodeFormRecords(form.dataset.authorityRecords);
  const schoolRecords = decodeFormRecords(form.dataset.schoolRecords);
  const authority = resolveAuthorityRecord(authorityRecords, authorityInput.value);
  const authorityId = String(authority?.id || '').trim();
  authorityIdInput.value = authorityId;

  const filteredSchools = schoolsForAuthority(schoolRecords, authorityId);
  if (schoolList) {
    schoolList.innerHTML = filteredSchools
      .map((school) => `<option value="${escapeHtml(humanDisplayText(school?.name || school?.value))}"></option>`)
      .join('');
  }

  let school = resolveSchoolRecord(schoolRecords, schoolInput.value || schoolIdInput.value, authorityId);
  if (!school && resetInvalidSchool) {
    schoolInput.value = '';
    schoolIdInput.value = '';
  } else {
    schoolIdInput.value = String(school?.school_id ?? school?.id ?? '').trim();
    if (school) schoolInput.value = humanDisplayText(school?.name || school?.value);
  }

  school = resolveSchoolRecord(schoolRecords, schoolInput.value || schoolIdInput.value, authorityId);
  const hasAuthorityText = Boolean(humanDisplayText(authorityInput.value));
  const hasSchoolText = Boolean(humanDisplayText(schoolInput.value));
  return {
    valid: (!hasAuthorityText || Boolean(authority)) && (!hasSchoolText || Boolean(school)),
    values: {
      authority: authority ? humanDisplayText(authority?.name || authority?.value) : '',
      authority_id: authorityId,
      school: school ? humanDisplayText(school?.name || school?.value) : '',
      school_id: String(school?.school_id ?? school?.id ?? '').trim(),
    },
  };
}

export function activityEditLocationChanges(initialValues = {}, values = null) {
  if (!values) return {};
  const keys = ['authority', 'authority_id', 'school', 'school_id'];
  const changed = keys.some((key) => String(values[key] || '') !== String(initialValues[key] || ''));
  return changed ? Object.fromEntries(keys.map((key) => [key, values[key] || ''])) : {};
}

export function captureActivityEditLocationValues(form) {
  return Object.fromEntries(['authority', 'authority_id', 'school', 'school_id'].map((name) => [
    name,
    String(form?.querySelector?.(`[name="${name}"]`)?.value ?? '').trim(),
  ]));
}

function drawerExportRow(form) {
  try {
    return JSON.parse(form?.dataset?.exportRow || '{}') || {};
  } catch {
    return {};
  }
}

export function ensureExistingActivityNameSelected(form) {
  const select = form?.querySelector?.('[data-role="activity-name-select"]');
  if (!select) return false;

  const row = drawerExportRow(form);
  const storedName = humanDisplayText(
    row.activity_name
    || row.program_name
    || row.title
    || row.name
    || form?._initialValues?.activity_name
  );
  if (!storedName) return false;

  const activityNoInput = form.querySelector('[data-activity-no], [name="activity_no"]');
  const gefenNumberInput = form.querySelector('[data-gefen-number], [name="gefen_number"]');
  const storedActivityNo = String(row.activity_no || activityNoInput?.value || '').trim();
  const storedGefenNumber = String(row.gefen_number || gefenNumberInput?.value || '').trim();
  const storedType = normalizeActivityTypeKey(row.activity_type || row.item_type || form.querySelector('[name="activity_type"]')?.value || '');
  const storedMeetings = String(row.sessions ?? '').trim();

  const candidates = Array.from(select.options).filter((option) => String(option.value || '').trim() === storedName);
  let selectedOption = candidates.find((option) => {
    const optionActivityNo = String(option.dataset.activityNo || '').trim();
    const optionGefenNumber = String(option.dataset.gefenNumber || '').trim();
    if (!storedActivityNo && !storedGefenNumber) return true;
    return (storedActivityNo && optionActivityNo === storedActivityNo)
      || (storedGefenNumber && optionGefenNumber === storedGefenNumber);
  }) || null;

  if (!selectedOption) {
    selectedOption = form.ownerDocument.createElement('option');
    selectedOption.value = storedName;
    selectedOption.textContent = storedName;
    select.appendChild(selectedOption);
  }

  if (storedActivityNo && !String(selectedOption.dataset.activityNo || '').trim()) {
    selectedOption.dataset.activityNo = storedActivityNo;
  }
  if (storedGefenNumber && !String(selectedOption.dataset.gefenNumber || '').trim()) {
    selectedOption.dataset.gefenNumber = storedGefenNumber;
  }
  if (storedMeetings && !String(selectedOption.dataset.meetingsCount || '').trim()) {
    selectedOption.dataset.meetingsCount = storedMeetings;
  }
  if (storedType && !String(selectedOption.dataset.activityType || '').trim()) {
    selectedOption.dataset.activityType = storedType;
  }

  Array.from(select.options).forEach((option) => {
    option.selected = option === selectedOption;
  });
  select.value = storedName;
  if (activityNoInput && storedActivityNo) activityNoInput.value = storedActivityNo;
  if (gefenNumberInput && storedGefenNumber) gefenNumberInput.value = storedGefenNumber;
  return select.value === storedName;
}

function normalizeActivityStatusForSave(value) {
  const clean = String(value || '').trim();
  if (clean === 'סגור' || clean.toLowerCase() === 'closed') return 'סגור';
  return 'פתוח';
}

const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);

function activityNameOptionsForType(allOptions, activityType) {
  const sourceOptions = Array.isArray(allOptions) ? allOptions : [];
  const normalizedType = normalizeActivityTypeKey(activityType);
  if (!normalizedType) return { filtered: [], hasTagged: sourceOptions.some((o) => String(o?.parent_value || o?.activity_type || '').trim()) };
  const hasTagged = sourceOptions.some((o) => String(o?.parent_value || o?.activity_type || '').trim());
  let filtered = sourceOptions.filter((o) => activityTypeMatches(o?.parent_value || o?.activity_type, normalizedType));
  if (!filtered.length && !hasTagged) filtered = sourceOptions;
  return { filtered, hasTagged };
}

function renderActivityNameOptions(options, activityType = '') {
  const normalizedType = normalizeActivityTypeKey(activityType);
  if (!normalizedType) return '<option value="">בחרו קודם סוג פעילות</option>';
  return ['<option value="">—</option>']
    .concat((Array.isArray(options) ? options : []).map((o) => {
      const label = String(o?.label || '').trim();
      const actNo = String(o?.activity_no || '').trim();
      const gefenNumber = String(o?.gefen_number || '').trim();
      const meetingsCount = String(o?.meetings_count ?? '').trim();
      const actType = String(o?.parent_value || o?.activity_type || '').trim();
      return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(actNo)}" data-gefen-number="${escapeHtml(gefenNumber)}" data-meetings-count="${escapeHtml(meetingsCount)}" data-activity-type="${escapeHtml(actType)}">${escapeHtml(label)}</option>`;
    }))
    .join('');
}

function validateActivityTypeAndName(form, statusEl) {
  const typeEl = form.querySelector('[name="activity_type"]');
  const nameSel = form.querySelector('[data-role="activity-name-select"]');
  if (!typeEl || !nameSel) return true;
  const selectedType = normalizeActivityTypeKey(typeEl.value);
  if (!selectedType || !isCanonicalActivityTypeKey(selectedType)) {
    setStatus(statusEl, 'is-error', 'יש לבחור סוג פעילות חוקי');
    showToast('יש לבחור סוג פעילות חוקי', 'error', 2600);
    return false;
  }
  const optionList = Array.from(nameSel.options).filter((opt) => String(opt.value || '').trim());
  if (!optionList.length) return true;
  const selectedName = String(nameSel.value || '').trim();
  const selectedOption = selectedName ? optionList.find((opt) => opt.value === selectedName) : null;
  const hasTagged = optionList.some((opt) => String(opt.dataset.activityType || '').trim());
  const isMatchingType = selectedOption && (!hasTagged || activityTypeMatches(selectedOption.dataset.activityType, selectedType));
  if (selectedName && isMatchingType) return true;
  setStatus(statusEl, 'is-error', 'יש לבחור שם פעילות מתוך הרשימה המתאימה לסוג הפעילות');
  showToast('יש לבחור שם פעילות מתוך הרשימה המתאימה לסוג הפעילות', 'error', 2600);
  return false;
}

function addDays(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function updateEndDateDisplay(form) {
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]'));
  const first = pickers[0];
  const last = pickers[pickers.length - 1];
  const startDate = first ? String(first.value || '') : '';
  const maxDate = last ? String(last.value || '') : '';
  const startDisplay = form.querySelector('[data-computed-start-display]');
  if (startDisplay) startDisplay.textContent = startDate ? (formatDateHe(startDate) || startDate) : '—';
  const display = form.querySelector('[data-computed-end-display]');
  if (display) display.textContent = maxDate ? (formatDateHe(maxDate) || maxDate) : '—';
  form.dataset.autoEndDate = maxDate;
}

function applyChainShift(form, changedIdx, _oldDate, newDate) {
  if (!newDate) return;
  const pickers = Array.from(form.querySelectorAll('input[data-meeting-idx]')).sort(
    (a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx)
  );
  if (!pickers.length) return;
  pickers.forEach((p) => {
    const idx = Number(p.dataset.meetingIdx);
    if (idx <= changedIdx) return;
    const daysAfterChanged = (idx - changedIdx) * 7;
    p.value = addDays(newDate, daysAfterChanged) || p.value;
  });
}

function getChainMode(form) {
  const active = form.querySelector('[data-chain-toggle] [data-date-mode].is-active');
  return active ? String(active.dataset.dateMode || 'single') : 'single';
}

function buildMeetingPickerCell(form, idx, dateValue) {
  const cell = form.ownerDocument.createElement('div');
  cell.className = 'activity-drawer__date-card';
  cell.dataset.meetingIndex = String(idx);
  const dayLetter = (() => {
    if (!dateValue) return '';
    const d = new Date(`${dateValue}T12:00:00`);
    return Number.isNaN(d.getTime()) ? '' : ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][d.getDay()] || '';
  })();
  const isOnce = form?.dataset?.isOnce === 'yes';
  const removeBtn = isOnce
    ? ''
    : `<button type="button" class="activity-drawer__date-remove" data-action="remove-meeting" aria-label="הסר מפגש">🗑</button>`;
  cell.innerHTML = `
    <div class="activity-drawer__date-card-top">
      <span class="activity-drawer__meeting-index">מפגש ${idx + 1}</span>
      <span class="activity-drawer__date-card-top-aside">
        ${removeBtn}
        <span class="activity-drawer__weekday">${dayLetter}</span>
      </span>
    </div>
    <input class="ds-input" type="date" name="meeting_date_${idx}" data-role="meeting-date" data-meeting-index="${idx}" data-meeting-idx="${idx}" value="${escapeHtml(String(dateValue || ''))}">
    <input type="hidden" name="meeting_performed_${idx}" value="no">`;
  return cell;
}

function resizeMeetingDateCardsToSessionCount(form, targetCount) {
  const grid = form?.querySelector?.('[data-meeting-dates-edit]');
  if (!grid || form?.dataset?.isOnce === 'yes') return 0;

  const parsedTotal = Number.parseInt(String(targetCount ?? ''), 10);
  if (!Number.isFinite(parsedTotal) || parsedTotal < 1) return 0;
  const total = Math.min(35, parsedTotal);

  let cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  while (cards.length > total) {
    cards[cards.length - 1]?.remove();
    cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  }

  while (cards.length < total) {
    grid.appendChild(buildMeetingPickerCell(form, cards.length, ''));
    cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  }

  const datesSection = grid.closest('[data-dates-section]');
  if (datesSection) datesSection.dataset.sessionTotal = String(total);
  reindexMeetingDateCards(form);
  updateMeetingWeekdays(form);
  updateMoreDatesToggle(form);
  return total;
}

export function syncMeetingDatesToSessionCount(form, targetCount, blockedDatesContext = []) {
  const total = resizeMeetingDateCardsToSessionCount(form, targetCount);
  if (!total) return false;

  generateSessionDatesFromFirstMeeting(form, blockedDatesContext);
  updateMeetingWeekdays(form);
  updateMoreDatesToggle(form);
  updateEndDateDisplay(form);
  return true;
}

async function syncCatalogMeetingDates(form, catalogIdentity) {
  if (!catalogIdentity?.isCatalogSelection || !Number.isFinite(Number(catalogIdentity.meetings_count))) return false;
  const total = resizeMeetingDateCardsToSessionCount(form, catalogIdentity.meetings_count);
  if (!total) return false;

  const season = String(form.getAttribute('data-activity-season') || form.dataset.activitySeason || '').trim();
  const calendarRows = isSummerActivitySeason(season) ? [] : await loadSchoolCalendarRows();
  return syncMeetingDatesToSessionCount(form, total, calendarRows);
}

function updateMeetingWeekdays(form) {
  form.querySelectorAll('.activity-drawer__date-card').forEach((cell) => {
    const picker = cell.querySelector('input[data-meeting-idx]');
    const label = cell.querySelector('.activity-drawer__date-card-top .activity-drawer__weekday');
    if (!picker || !label) return;
    if (!picker.value) {
      label.textContent = '';
      return;
    }
    const d = new Date(`${picker.value}T12:00:00`);
    label.textContent = Number.isNaN(d.getTime()) ? '' : (['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][d.getDay()] || '');
  });
}

function syncMeetingRemoveButtons(form) {
  const grid = form.querySelector('[data-meeting-dates-edit]');
  if (!grid) return;
  const cards = grid.querySelectorAll(':scope > .activity-drawer__date-card');
  const hideRemove = form.dataset.isOnce === 'yes' || cards.length <= 1;
  cards.forEach((card) => {
    const btn = card.querySelector('[data-action="remove-meeting"]');
    if (btn) btn.toggleAttribute('hidden', hideRemove);
  });
}

function reindexMeetingDateCards(form) {
  const grid = form.querySelector('[data-meeting-dates-edit]');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  cards.forEach((card, i) => {
    card.dataset.meetingIndex = String(i);
    const idxLabel = card.querySelector('.activity-drawer__meeting-index');
    if (idxLabel) idxLabel.textContent = `מפגש ${i + 1}`;
    const dateInput = card.querySelector('input[data-meeting-idx]');
    const perfInput = card.querySelector('input[type="hidden"][name^="meeting_performed_"]');
    if (dateInput) {
      dateInput.name = `meeting_date_${i}`;
      dateInput.setAttribute('data-meeting-index', String(i));
      dateInput.dataset.meetingIndex = String(i);
      dateInput.dataset.meetingIdx = String(i);
    }
    if (perfInput) perfInput.name = `meeting_performed_${i}`;
  });
  syncMeetingRemoveButtons(form);
}

function updateMoreDatesToggle(form) {
  const editCards = Array.from(form.querySelectorAll('[data-meeting-dates-edit] .activity-drawer__date-card'));

  editCards.forEach((card) => {
    card.hidden = false;
  });

  syncMeetingRemoveButtons(form);
}

function readMeetingDatePickerValues(form) {
  const values = Array.from({ length: 35 }, () => '');
  const pickers = Array.from(form.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')).sort(
    (a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx)
  );
  pickers.forEach((picker) => {
    const idx = Number(picker.dataset.meetingIdx);
    if (!Number.isFinite(idx) || idx < 0 || idx >= 35) return;
    values[idx] = String(picker?.value || '').trim();
  });
  return values;
}

function initialMeetingDateValue(initialValues = {}, index = 0) {
  return String(initialValues[`meeting_date_${index}`] ?? initialValues[`date_${index + 1}`] ?? '').trim();
}

function buildMeetingDatesSnapshot(form) {
  const normalized = readMeetingDatePickerValues(form);
  let endDate = '';
  normalized.forEach((value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) endDate = value;
  });
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(normalized[0] || '') ? normalized[0] : '';
  return { dates: normalized, startDate, endDate };
}

function hasMeetingDatesChanged(form, initialValues = {}) {
  const dates = readMeetingDatePickerValues(form);
  for (let i = 0; i < 35; i++) {
    if (String(dates[i] || '').trim() !== initialMeetingDateValue(initialValues, i)) return true;
  }
  return false;
}

function captureFormInitialValues(form) {
  const initialValues = {};
  form.querySelectorAll('[name]').forEach((el) => {
    const name = el.getAttribute('name');
    if (!name || name.startsWith('_')) return;
    initialValues[name] = el.matches('input[type="checkbox"]')
      ? el.checked
      : el.matches('select[multiple]')
      ? [...el.selectedOptions].map((option) => String(option.value).trim()).filter(Boolean)
      : String(el.value ?? '').trim();
  });
  for (let i = 0; i < 35; i++) {
    const meetingKey = `meeting_date_${i}`;
    const dateKey = `date_${i + 1}`;
    if (initialValues[meetingKey] && !initialValues[dateKey]) {
      initialValues[dateKey] = initialValues[meetingKey];
    } else if (!initialValues[meetingKey] && initialValues[dateKey]) {
      initialValues[meetingKey] = initialValues[dateKey];
    }
  }
  form._initialValues = initialValues;
  return initialValues;
}

function normalizeStoredMeetingDate(value) {
  const clean = String(value ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(clean);
  return match ? match[1] : '';
}

function verifyMeetingDateChangesApplied(changes, row = {}) {
  for (const [key, sentRaw] of Object.entries(changes || {})) {
    const match = /^meeting_date_(\d+)$/.exec(key);
    if (!match) continue;
    const dateKey = `date_${Number(match[1]) + 1}`;
    const expected = sentRaw === null || sentRaw === '' ? '' : normalizeStoredMeetingDate(sentRaw);
    const actual = normalizeStoredMeetingDate(row[dateKey]);
    if (expected !== actual) {
      const err = new Error('activity_date_db_verify_failed');
      err.code = 'activity_date_db_verify_failed';
      err.field = dateKey;
      err.expected = expected;
      err.actual = actual;
      throw err;
    }
  }
}

function collectMeetingDateChanges(form, initialValues = {}, changes = {}) {
  const pickerValues = readMeetingDatePickerValues(form);
  const isOnce = form.dataset.isOnce === 'yes';
  let prevEndDate = '';
  for (let j = 34; j >= 0; j--) {
    const value = initialMeetingDateValue(initialValues, j);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      prevEndDate = value;
      break;
    }
  }

  for (let i = 0; i < 35; i++) {
    const current = String(pickerValues[i] || '').trim();
    const prev = initialMeetingDateValue(initialValues, i);
    if (current !== prev) {
      changes[`meeting_date_${i}`] = current ? current : null;
    }
  }

  const snapshot = buildMeetingDatesSnapshot(form);
  const previousStartDate = String(initialValues.start_date || initialMeetingDateValue(initialValues, 0) || '').slice(0, 10);
  if (snapshot.startDate !== previousStartDate) {
    changes.start_date = snapshot.startDate || null;
  }
  const computedEndDate = isOnce ? snapshot.startDate : snapshot.endDate;
  if (computedEndDate !== prevEndDate) {
    changes.end_date = computedEndDate || null;
  }
}

export function bindActivityEditForm(contentRoot, {
  api,
  ui,
  clearScreenDataCache,
  rerender,
  onRowSaved,
  onSaveSuccess,
  quietRefresh,
  forceDirectEdit = false,
  appState = {}
}) {
  if (!api || !contentRoot) return;
  if (contentRoot._activityEditAbort) {
    contentRoot._activityEditAbort.abort();
  }
  const abortController = new AbortController();
  contentRoot._activityEditAbort = abortController;
  const { signal } = abortController;

  applyActivityDrawerLayoutPipeline(contentRoot, appState?.clientSettings || {});

  async function saveActivityForm(form) {
    if (blockReadOnlyActivityMutation(form, appState)) return;
    if (form.dataset.saveInFlight === 'yes') {
      // eslint-disable-next-line no-console
      console.warn('[activity-save:duplicate-submit-blocked]', {
        rowId: form.getAttribute('data-row-id') || '',
        source_sheet: form.getAttribute('data-source-sheet') || ''
      });
      return;
    }
    const statusEl = form.querySelector('.ds-activity-edit-status');
    const submitBtn = form.querySelector('[data-action="save-edit"]');
    const sourceSheet = form.getAttribute('data-source-sheet') || '';
    const sourceRowId = form.getAttribute('data-row-id') || '';
    const rawCanDirectEdit = String(form.dataset.canDirectEdit || '') === 'yes';
    const canRequestEdit = String(form.dataset.canRequestEdit || '') === 'yes';
    const sessionRequestOnly = !appState?.user?.can_edit_direct && !!appState?.user?.can_request_edit;
    const canDirectEdit = rawCanDirectEdit && (forceDirectEdit || !sessionRequestOnly);
    const changes = {};
    const initialValues = form._initialValues || {};
    const location = syncActivityEditLocation(form);
    if (!location.valid) {
      const message = 'יש לבחור רשות ובית ספר תקינים מתוך הרשימות המסוננות';
      setStatus(statusEl, 'is-error', message);
      showToast(message, 'error', 3000);
      return;
    }

    form.querySelectorAll('[name]').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || name.startsWith('_')) return;
      if (/^meeting_date_\d+$/.test(name) || /^meeting_performed_\d+$/.test(name)) return;
      if (el.closest('[hidden]')) return;
      if (el.matches('input[type="checkbox"]')) {
        const nextValue = el.checked;
        if (nextValue !== Boolean(initialValues[name])) changes[name] = nextValue;
        return;
      }
      if (el.matches('select[multiple][data-scheduling-multi]')) {
        const nextValues = [...el.selectedOptions].map((option) => ({
          funding_source_id: String(option.value).trim(),
          amount: String(option.dataset.fundingAmount || '').trim()
        })).filter((item) => item.funding_source_id);
        const previousValues = Array.isArray(initialValues[name]) ? initialValues[name].map(String) : [];
        const comparableNext = nextValues.map((item) => item.funding_source_id);
        const amountsChanged = nextValues.some((item) => item.amount !== String([...el.options].find((option) => String(option.value) === item.funding_source_id)?.dataset.initialFundingAmount || ''));
        if (JSON.stringify(comparableNext) !== JSON.stringify(previousValues) || amountsChanged) changes[name] = nextValues;
        return;
      }
      const rawValue = el.value;
      if (rawValue === undefined || rawValue === null) return;
      const rawNextValue = String(rawValue).trim();
      const nextValue = name === 'status'
        ? normalizeActivityStatusForSave(rawNextValue)
        : (HUMAN_DISPLAY_FIELDS.has(name) ? humanDisplayText(rawNextValue) : rawNextValue);
      const prevValue = String(initialValues[name] ?? '').trim();
      if (nextValue === prevValue) return;
      changes[name] = nextValue;
    });

    Object.assign(changes, activityEditLocationChanges(form._initialLocationValues || initialValues, location.values));

    // An empty scheduling language is a real optional value, never an implicit Hebrew default.
    if (Object.prototype.hasOwnProperty.call(changes, 'instruction_language') && changes.instruction_language === '') {
      changes.instruction_language = null;
    }

    if (String(form.dataset.originalStatus || '').trim() === 'פעיל' && !Object.prototype.hasOwnProperty.call(changes, 'status')) {
      changes.status = 'פתוח';
    }

    if (!validateActivityTypeAndName(form, statusEl)) return;

    const catalogSelection = selectedActivityCatalogIdentity(form);
    const catalogSelectionChanged = catalogSelection.isCatalogSelection && (
      catalogSelection.activity_name !== String(initialValues.activity_name || '').trim() ||
      catalogSelection.activity_no !== String(initialValues.activity_no || '').trim() ||
      catalogSelection.gefen_number !== String(initialValues.gefen_number || '').trim()
    );
    if (catalogSelectionChanged && Number.isFinite(Number(catalogSelection.meetings_count))) {
      await syncCatalogMeetingDates(form, catalogSelection);
    }

    collectMeetingDateChanges(form, initialValues, changes);

    if (catalogSelectionChanged) {
      Object.assign(changes, catalogActivityChangesFromSelection(catalogSelection, {
        normalizeActivityType: normalizeActivityTypeKey
      }));
    } else if (Object.prototype.hasOwnProperty.call(changes, 'activity_name')) {
      // A user-entered name remains a manual override. A normal catalog
      // selection above is explicitly marked as catalog-controlled instead.
      changes.activity_name_override = true;
    }

    const initialType = normalizeActivityTypeKey(initialValues.activity_type || initialValues.item_type || '');
    const selectedType = normalizeActivityTypeKey(form.querySelector('[name="activity_type"]')?.value || '');
    const userChangedActivityType = selectedType !== initialType;
    if (Object.prototype.hasOwnProperty.call(changes, 'activity_type') && !userChangedActivityType && !catalogSelectionChanged) {
      delete changes.activity_type;
      delete changes.item_type;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'activity_type')) {
      const canonicalType = normalizeActivityTypeKey(changes.activity_type);
      if (!canonicalType) {
        delete changes.activity_type;
        delete changes.item_type;
      } else {
        changes.activity_type = canonicalType;
        changes.item_type = canonicalType;
      }
    }

    const effectiveType = normalizeOneDayActivityType(changes.activity_type || initialValues.activity_type || '');
    if (effectiveType) {
      const effectiveName = String(changes.activity_name ?? form.querySelector('[name="activity_name"]')?.value ?? initialValues.activity_name ?? '').trim();
      if (!effectiveName || GENERIC_ONE_DAY_ACTIVITY_NAMES.has(effectiveName)) {
        setStatus(statusEl, 'is-error', 'יש לבחור שם פעילות מתוך הרשימה');
        showToast('יש לבחור שם פעילות מתוך הרשימה', 'error', 2600);
        return;
      }
      changes.activity_type = effectiveType;
      changes.item_type = effectiveType;
      if (String(changes.status || '').trim() === 'פעיל') changes.status = 'פתוח';
    }

    const saveType = normalizeActivityTypeKey(
      changes.activity_type || initialValues.activity_type || form.querySelector('[name="activity_type"]')?.value || ''
    );
    if (saveType === 'course' && Object.prototype.hasOwnProperty.call(changes, 'price') && !Object.prototype.hasOwnProperty.call(changes, 'funding_sources')) {
      const fundingSelect = form.querySelector('select[name="funding_sources"][multiple]');
      changes.funding_sources = [...(fundingSelect?.selectedOptions || [])].map((option) => ({
        funding_source_id: String(option.value).trim(),
        amount: String(option.dataset.fundingAmount || '').trim()
      })).filter((item) => item.funding_source_id);
    }
    if (saveType === 'course' && Object.prototype.hasOwnProperty.call(changes, 'funding_sources')) {
      const fundingRows = changes.funding_sources;
      const price = Number(changes.price ?? form.querySelector('[name="price"]')?.value ?? initialValues.price);
      if (fundingRows.length === 1) {
        fundingRows[0].amount = Number.isFinite(price) ? price : null;
      } else if (fundingRows.length > 1) {
        if (!validateCourseFundingSplit(fundingRows, price).valid) {
          setStatus(statusEl, 'is-error', 'סכומי גורמי המימון חייבים להיות שווים למחיר הפעילות');
          showToast('סכומי גורמי המימון חייבים להיות שווים למחיר הפעילות', 'error', 3000);
          return;
        }
      }
    }
    const supportsParticipants = saveType === 'workshop' || saveType === 'escape_room';
    if (!supportsParticipants) {
      delete changes.participants_count;
    } else if (Object.prototype.hasOwnProperty.call(changes, 'participants_count')) {
      const raw = changes.participants_count;
      if (raw === '' || raw === null) {
        changes.participants_count = null;
      } else {
        const n = Number(raw);
        if (!Number.isInteger(n) || n <= 0) {
          setStatus(statusEl, 'is-error', 'מספר משתתפים מעודכן חייב להיות מספר שלם חיובי');
          showToast('מספר משתתפים מעודכן חייב להיות מספר שלם חיובי', 'error', 2600);
          return;
        }
        changes.participants_count = n;
      }
    }

    const roster = getValidInstructorUsers(appState?.clientSettings || {});
    const selectedInstructorEmpId = Object.prototype.hasOwnProperty.call(changes, 'emp_id')
      ? changes.emp_id
      : String(form.querySelector('[name="emp_id"]')?.value ?? initialValues.emp_id ?? '').trim();
    const selectedInstructor2EmpId = Object.prototype.hasOwnProperty.call(changes, 'emp_id_2')
      ? changes.emp_id_2
      : String(form.querySelector('[name="emp_id_2"]')?.value ?? initialValues.emp_id_2 ?? '').trim();
    const instructor1 = resolveInstructorSelectionByEmpId(selectedInstructorEmpId, roster);
    const instructor2 = resolveInstructorSelectionByEmpId(selectedInstructor2EmpId, roster);
    if (instructor1.error || instructor2.error) {
      const message = instructor1.error === 'instructor_not_in_contacts' || instructor2.error === 'instructor_not_in_contacts' ? INSTRUCTOR_CONTACTS_MISSING_ERROR_MESSAGE : INSTRUCTOR_IDENTITY_ERROR_MESSAGE;
      setStatus(statusEl, 'is-error', message);
      showToast(message, 'error', 2600);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'emp_id')) {
      changes.instructor_name = instructor1.name;
      changes.emp_id = instructor1.emp_id;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'emp_id_2')) {
      changes.instructor_name_2 = instructor2.name;
      changes.emp_id_2 = instructor2.emp_id;
    }
    const instructorGuardPayload = {
      instructor_name: Object.prototype.hasOwnProperty.call(changes, 'instructor_name') ? changes.instructor_name : initialValues.instructor_name,
      emp_id: Object.prototype.hasOwnProperty.call(changes, 'emp_id') ? changes.emp_id : initialValues.emp_id,
      instructor_name_2: Object.prototype.hasOwnProperty.call(changes, 'instructor_name_2') ? changes.instructor_name_2 : initialValues.instructor_name_2,
      emp_id_2: Object.prototype.hasOwnProperty.call(changes, 'emp_id_2') ? changes.emp_id_2 : initialValues.emp_id_2
    };
    const instructorGuard = validateInstructorIdentityPayload(instructorGuardPayload, roster);
    if (!instructorGuard.valid) {
      setStatus(statusEl, 'is-error', INSTRUCTOR_CONTACTS_MISSING_ERROR_MESSAGE);
      showToast(INSTRUCTOR_CONTACTS_MISSING_ERROR_MESSAGE, 'error', 2600);
      return;
    }

    try {
      if (!Object.keys(changes).length) {
        setStatus(statusEl, 'is-error', 'לא זוהו שינויים לשמירה');
        showToast('לא זוהו שינויים לשמירה', 'info', 2200);
        return;
      }

      const meetingSnapshot = buildMeetingDatesSnapshot(form);
      const rowId = sourceRowId;
      const rawChanges = { ...changes };
      const dateNamedFields = Array.from(form.querySelectorAll('[name]'))
        .map((el) => el.getAttribute('name'))
        .filter((name) => name === 'start_date' || name === 'end_date' || /^date(_|$)|^date_\d+$/.test(name || '') || /^meeting_date_\d+$/.test(name || ''));
      console.info('[activity-date-save-proof:form]', {
        rowId,
        rawChanges,
        meetingSnapshot,
        initialValues,
        dateNamedFields
      });

      const debugPayload = { source_sheet: sourceSheet, source_row_id: sourceRowId, changes };

      if (!canDirectEdit && !canRequestEdit) {
        setStatus(statusEl, 'is-error', 'אין לך הרשאה לערוך פעילות זו');
        showToast('אין לך הרשאה לערוך פעילות זו', 'error', 2600);
        return;
      }

      setStatus(statusEl, 'is-pending', canDirectEdit ? 'שומר...' : 'שולח בקשת עריכה...');
      form.dataset.saveInFlight = 'yes';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-loading');
      }

      let requestResult = null;
      if (canDirectEdit) {
        requestResult = await api.saveActivity(debugPayload);
        if (!requestResult?.row) {
          throw new Error('activity_update_no_row_returned');
        }
        verifyMeetingDateChangesApplied(changes, requestResult.row);
      } else if (canRequestEdit) {
        requestResult = await api.submitEditRequest(debugPayload);
      } else {
        throw new Error('insufficient_permissions_for_edit');
      }
      const requestId = String(requestResult?.request_id || '').trim();
      const requestStatusText = requestId
        ? `✅ הבקשה נשלחה לאישור. סטטוס: ממתין לאישור · מזהה בקשה: ${requestId}`
        : '✅ הבקשה נשלחה לאישור. סטטוס: ממתין לאישור';
      setStatus(
        statusEl,
        'is-success',
        canDirectEdit ? '✅ הפעילות נשמרה בהצלחה' : requestStatusText
      );
      if (!canDirectEdit) form.dataset.lastEditRequestId = requestId;
      showToast(
        canDirectEdit ? 'הפעילות נשמרה בהצלחה' : 'הבקשה נשלחה לאישור · סטטוס: ממתין לאישור',
        'success',
        3000
      );
      if (!canDirectEdit) {
        try { document.dispatchEvent(new CustomEvent('app:edit-requests-updated')); } catch (_) { /* ignore */ }
      }
      if (canDirectEdit && requestResult?.row) {
        clearScreenDataCache?.();
        if (Object.prototype.hasOwnProperty.call(changes, 'participants_count')) {
          clearScreenDataCache?.('activities');
          clearScreenDataCache?.('operations-management');
        }
        const finalRow = requestResult.row;
        console.info('[activity-date-save-proof:final-db-row]', {
          row_id: finalRow.row_id || finalRow.RowID || sourceRowId,
          start_date: finalRow.start_date || '',
          end_date: finalRow.end_date || '',
          date_1: finalRow.date_1 || '',
          date_2: finalRow.date_2 || '',
          date_3: finalRow.date_3 || '',
          date_4: finalRow.date_4 || '',
          date_5: finalRow.date_5 || ''
        });
      }
      if (canDirectEdit && typeof onRowSaved === 'function') onRowSaved({ sourceSheet, sourceRowId, changes, form, row: requestResult?.row || null });
      if (!canDirectEdit) {
        form.reset();
        updateMeetingWeekdays(form);
        updateMoreDatesToggle(form);
        updateEndDateDisplay(form);
      }
      setEditMode(form, false);
      if (canDirectEdit && typeof onSaveSuccess === 'function') {
        await onSaveSuccess({ sourceSheet, sourceRowId, changes, form, contentRoot });
      } else if (typeof quietRefresh === 'function') {
        quietRefresh({ sourceSheet, sourceRowId, changes: canDirectEdit ? changes : {}, form });
      } else if (typeof rerender === 'function') {
        requestAnimationFrame(() => {
          rerender();
        });
      }
    } catch (err) {
      const errMsg = err?.message || err?.status || err?.code || '';
      // eslint-disable-next-line no-console
      console.error('[activity-save-error]', {
        rowId: sourceRowId,
        source_sheet: sourceSheet,
        changed_fields: Object.keys(changes),
        supabase_error_code: err?.code || err?.status || '',
        supabase_error_message: err?.message || '',
        supabase_error_details: err?.details || '',
        supabase_error_hint: err?.hint || '',
        error: err
      });
      const isTimeout = errMsg === 'save_timeout' || errMsg === 'request_timeout' || String(errMsg).toLowerCase().includes('timeout');
      setStatus(statusEl, isTimeout ? 'is-warning' : 'is-error', `⚠️ ${translateApiErrorForUser(errMsg)}`);
    } finally {
      form.dataset.saveInFlight = 'no';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
      }
    }
  }

  contentRoot.addEventListener(
    'click',
    (ev) => {
      const form = ev.target.closest('[data-drawer-form]');
      if (!form) return;

      if (ev.target.closest('[data-action="start-edit"]')) {
        if (blockReadOnlyActivityMutation(form, appState)) return;
        ensureExistingActivityNameSelected(form);
        setEditMode(form, true);
        applyApprovedDrawerFixes(form);
        ensureExistingActivityNameSelected(form);
        captureFormInitialValues(form);
        const nameSel = form.querySelector('[data-role="activity-name-select"]');
        if (nameSel && nameSel.options.length < 2) {
          // eslint-disable-next-line no-console
          console.warn('[activity-edit] activity-name-select has fewer than 2 options; dropdown_options.activity_names may be missing from client settings');
        }
        return;
      }

      if (ev.target.closest('[data-action="cancel-edit"]')) {
        form.reset();
        setStatus(form.querySelector('.ds-activity-edit-status'), '', '');
        updateMeetingWeekdays(form);
        updateMoreDatesToggle(form);
        updateEndDateDisplay(form);
        setEditMode(form, false);
        return;
      }

      if (ev.target.closest('[data-action="save-edit"]')) {
        ev.preventDefault();
        if (blockReadOnlyActivityMutation(form, appState)) return;
        void saveActivityForm(form);
        return;
      }
      if (ev.target.closest('[data-action="delete-activity"]')) {
        ev.preventDefault();
        if (blockReadOnlyActivityMutation(form, appState)) return;
        const rowId = String(form.getAttribute('data-row-id') || '').trim();
        if (!rowId) return;
        const ok = window.confirm('האם למחוק את הפעילות? הפעילות תוסתר מהמסכים ולא תימחק פיזית מהמערכת.');
        if (!ok) return;
        api.deleteActivity(rowId)
          .then(async () => {
            showToast('הפעילות הוסרה מהמסכים הפעילים', 'success', 2400);
            clearScreenDataCache?.();
            ui?.closeDrawer?.();
            if (typeof onSaveSuccess === 'function') {
              await onSaveSuccess({ sourceSheet: form.getAttribute('data-source-sheet') || '', sourceRowId: rowId, changes: { status: 'נמחק' }, form, contentRoot });
            } else if (typeof rerender === 'function') {
              rerender();
            }
          })
          .catch((err) => {
            showToast('הפעילות לא נמחקה. ייתכן שאין הרשאה או שהפעילות לא נמצאה.', 'error', 3000);
          });
        return;
      }

      const chainBtn = ev.target.closest('[data-date-mode]');
      if (chainBtn) {
        const toggle = chainBtn.closest('[data-chain-toggle]');
        if (toggle) {
          toggle.querySelectorAll('[data-date-mode]').forEach((b) => b.classList.remove('is-active'));
          chainBtn.classList.add('is-active');
        }
        return;
      }

      if (ev.target.closest('[data-action="remove-meeting"]')) {
        if (form.dataset.isOnce === 'yes') return;
        const grid = form.querySelector('[data-meeting-dates-edit]');
        const cell = ev.target.closest('.activity-drawer__date-card');
        if (!grid || !cell || !grid.contains(cell)) return;
        const cards = grid.querySelectorAll(':scope > .activity-drawer__date-card');
        if (cards.length <= 1) return;
        cell.remove();
        reindexMeetingDateCards(form);
        updateMeetingWeekdays(form);
        updateMoreDatesToggle(form);
        updateEndDateDisplay(form);
        return;
      }

      if (ev.target.closest('[data-action="add-meeting"]')) {
        const grid = form.querySelector('[data-meeting-dates-edit]');
        if (!grid) return;
        if (form.dataset.isOnce === 'yes') return;
        const allPickers = Array.from(grid.querySelectorAll('input[data-meeting-idx]'));
        const currentCount = allPickers.length;
        const lastDate = allPickers.length ? allPickers[allPickers.length - 1].value : '';
        const nextDate = lastDate ? addDays(lastDate, 7) : '';
        const cell = buildMeetingPickerCell(form, currentCount, nextDate);
        grid.appendChild(cell);
        reindexMeetingDateCards(form);
        updateMeetingWeekdays(form);
        updateMoreDatesToggle(form);
        updateEndDateDisplay(form);
        return;
      }

    },
    { signal }
  );

  contentRoot.querySelectorAll('[data-drawer-form]').forEach((form) => {
    setEditMode(form, false);
    reindexMeetingDateCards(form);
    updateMeetingWeekdays(form);
    updateMoreDatesToggle(form);
    updateEndDateDisplay(form);
    syncActivityEndTimeOptions(form.querySelector('[name="start_time"]'), form.querySelector('[name="end_time"]'));
    const typeEl = form.querySelector('[name="activity_type"]');
    const nameSel = form.querySelector('[data-role="activity-name-select"]');
    if (nameSel) nameSel.disabled = !normalizeActivityTypeKey(typeEl?.value);
    if (typeEl) form.dataset.activityNameType = normalizeActivityTypeKey(typeEl.value);
    ensureExistingActivityNameSelected(form);
    syncActivityCatalogIdentityFromName(form);
    const authorityInput = form.querySelector('[data-role="activity-authority"]');
    const schoolInput = form.querySelector('[data-role="activity-school"]');
    authorityInput?.addEventListener('change', () => syncActivityEditLocation(form, { resetInvalidSchool: true }), { signal });
    schoolInput?.addEventListener('input', () => syncActivityEditLocation(form), { signal });
    schoolInput?.addEventListener('change', () => syncActivityEditLocation(form), { signal });
    form._initialLocationValues = captureActivityEditLocationValues(form);
    syncActivityEditLocation(form);
    captureFormInitialValues(form);
    form._refreshInitialValues = () => {
      form._initialLocationValues = captureActivityEditLocationValues(form);
      return captureFormInitialValues(form);
    };
    guardInitialValueRefreshWhileEditing(form);

    form.addEventListener(
      'change',
      (ev) => {
        const isApprovedTimeEditor = Boolean(ev.target.closest?.('[data-activity-time-editor-enhanced="true"]'));
        if (ev.target.matches('[name="start_time"]') && !isApprovedTimeEditor) {
          syncActivityEndTimeOptions(ev.target, form.querySelector('[name="end_time"]'));
        }
        const nameEl = ev.target.closest('[data-role="activity-name-select"]');
        if (nameEl) {
          const catalogIdentity = syncActivityCatalogIdentityFromName(form, { clearWhenNoSelection: true });
          if (catalogIdentity?.isCatalogSelection && Number.isFinite(Number(catalogIdentity.meetings_count))) {
            const requestKey = `${catalogIdentity.activity_no || catalogIdentity.gefen_number || catalogIdentity.activity_name}:${catalogIdentity.meetings_count}`;
            form.dataset.catalogDateSyncRequest = requestKey;
            resizeMeetingDateCardsToSessionCount(form, catalogIdentity.meetings_count);
            const season = String(form.getAttribute('data-activity-season') || form.dataset.activitySeason || '').trim();
            void loadSchoolCalendarRows().then((rows) => {
              if (form.dataset.catalogDateSyncRequest !== requestKey) return;
              syncMeetingDatesToSessionCount(form, catalogIdentity.meetings_count, isSummerActivitySeason(season) ? [] : rows);
            });
          }
        }

        const typeEl = ev.target.closest('[name="activity_type"]');
        if (typeEl) {
          const newType = normalizeActivityTypeKey(typeEl.value);
          const previousType = normalizeActivityTypeKey(form.dataset.activityNameType);
          if (newType === previousType) return;
          form.dataset.activityNameType = newType;
          const nameSel = form.querySelector('[data-role="activity-name-select"]');
          if (nameSel && nameSel.dataset.allActivityNames) {
            let allOptions = [];
            try { allOptions = JSON.parse(decodeURIComponent(nameSel.dataset.allActivityNames)); } catch { allOptions = []; }
            const { filtered } = activityNameOptionsForType(allOptions, newType);
            nameSel.innerHTML = renderActivityNameOptions(filtered, newType);
            nameSel.disabled = !newType;
            nameSel.value = '';
            syncActivityCatalogIdentityFromName(form, { clearWhenNoSelection: true });
          }
        }

        const datePicker = ev.target.closest('input[data-meeting-idx]');
        if (datePicker) {
          const idx = Number(datePicker.dataset.meetingIdx);
          if (getChainMode(form) === 'chain') {
            const oldDate = datePicker.dataset.prevValue || '';
            applyChainShift(form, idx, oldDate, datePicker.value);
          }
          datePicker.dataset.prevValue = datePicker.value;
          updateMeetingWeekdays(form);
          updateEndDateDisplay(form);
        }
      },
      { signal }
    );

    form.addEventListener(
      'focusin',
      (ev) => {
        const datePicker = ev.target.closest('input[data-meeting-idx]');
        if (datePicker) datePicker.dataset.prevValue = datePicker.value;
      },
      { signal }
    );
  });
}

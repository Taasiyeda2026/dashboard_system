import { translateApiErrorForUser } from './ui-hebrew.js';
import { showToast } from './toast.js';
import { formatDateHe } from './format-date.js';
import { escapeHtml } from './html.js';
import { activityTypeMatches, getValidInstructorUsers, humanDisplayText, INSTRUCTOR_CONTACTS_MISSING_ERROR_MESSAGE, INSTRUCTOR_IDENTITY_ERROR_MESSAGE, normalizeActivityTypeKey, normalizeOneDayActivityType, resolveInstructorSelectionByEmpId, validateInstructorIdentityPayload } from './activity-options.js';
import { state } from '../../state.js';

function setEditMode(form, editing) {
  form.dataset.editing = editing ? 'yes' : 'no';
  form.querySelectorAll('[data-mode="view"]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-mode="edit"]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-view-only]').forEach((el) => el.toggleAttribute('hidden', editing));
  form.querySelectorAll('[data-edit-only]').forEach((el) => el.toggleAttribute('hidden', !editing));
  form.querySelectorAll('[data-edit-actions]').forEach((el) => el.toggleAttribute('hidden', !editing));
  const editBtn = form.querySelector('[data-action="start-edit"]');
  if (editBtn) editBtn.toggleAttribute('hidden', editing);
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

function normalizeActivityStatusForSave(value) {
  const clean = String(value || '').trim();
  if (clean === 'סגור' || clean.toLowerCase() === 'closed') return 'סגור';
  return 'פתוח';
}

const GENERIC_ONE_DAY_ACTIVITY_NAMES = new Set(['סדנה', 'סדנאות', 'סיור', 'סיורים', 'חדר בריחה', 'חדרי בריחה']);

function detectActivityNoByName(form, activityName) {
  const sel = form.querySelector('[data-role="activity-name-select"]');
  if (!sel) return '';
  const opt = Array.from(sel.options).find((o) => o.value === activityName);
  return opt ? String(opt.dataset.activityNo || '') : '';
}


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
      const actType = String(o?.parent_value || o?.activity_type || '').trim();
      return `<option value="${escapeHtml(label)}" data-activity-no="${escapeHtml(actNo)}" data-activity-type="${escapeHtml(actType)}">${escapeHtml(label)}</option>`;
    }))
    .join('');
}

function syncActivityNoFromName(form) {
  const nameSel = form.querySelector('[data-role="activity-name-select"]');
  const hidden = form.querySelector('[data-activity-no]');
  if (!nameSel || !hidden) return;
  const currentName = String(nameSel.value || '').trim();
  hidden.value = currentName ? detectActivityNoByName(form, currentName) : '';
}

function validateActivityTypeAndName(form, statusEl) {
  const typeEl = form.querySelector('[name="activity_type"]');
  const nameSel = form.querySelector('[data-role="activity-name-select"]');
  if (!typeEl || !nameSel) return true;
  const selectedType = normalizeActivityTypeKey(typeEl.value);
  if (!selectedType) {
    setStatus(statusEl, 'is-error', 'יש לבחור סוג פעילות לפני שם פעילות');
    showToast('יש לבחור סוג פעילות לפני שם פעילות', 'error', 2600);
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
  const last = pickers[pickers.length - 1];
  const maxDate = last ? String(last.value || '') : '';
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
  const cell = document.createElement('div');
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

function buildMeetingDatesSnapshot(form) {
  const pickers = Array.from(form.querySelectorAll('[data-meeting-dates-edit] input[data-meeting-idx]')).sort(
    (a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx)
  );
  const dates = pickers
    .map((picker) => String(picker?.value || '').trim())
    .filter((value) => value);
  const normalized = Array.from({ length: 35 }, (_, idx) => String(dates[idx] || '').trim());
  let endDate = '';
  normalized.forEach((value) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) endDate = value;
  });
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(normalized[0] || '') ? normalized[0] : '';
  return { dates: normalized, startDate, endDate };
}

function hasMeetingDatesChanged(form, initialValues = {}) {
  const { dates } = buildMeetingDatesSnapshot(form);
  for (let i = 0; i < 35; i++) {
    const current = String(dates[i] || '').trim();
    const prev = String(initialValues[`meeting_date_${i}`] ?? initialValues[`date_${i + 1}`] ?? '').trim();
    if (current !== prev) return true;
  }
  return false;
}

export function bindActivityEditForm(contentRoot, {
  api,
  ui,
  clearScreenDataCache,
  rerender,
  onRowSaved,
  onSaveSuccess,
  quietRefresh
}) {
  if (!api || !contentRoot) return;

  if (contentRoot._activityEditAbort) {
    contentRoot._activityEditAbort.abort();
  }
  const abortController = new AbortController();
  contentRoot._activityEditAbort = abortController;
  const { signal } = abortController;

  async function saveActivityForm(form) {
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
    const sessionRequestOnly = !state?.user?.can_edit_direct && !!state?.user?.can_request_edit;
    const canDirectEdit = rawCanDirectEdit && !sessionRequestOnly;
    const changes = {};
    const initialValues = form._initialValues || {};

    form.querySelectorAll('[name]').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || name.startsWith('_')) return;
      if (el.closest('[hidden]')) return;
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

    if (String(form.dataset.originalStatus || '').trim() === 'פעיל' && !Object.prototype.hasOwnProperty.call(changes, 'status')) {
      changes.status = 'פתוח';
    }

    if (hasMeetingDatesChanged(form, initialValues)) {
      const snapshot = buildMeetingDatesSnapshot(form);
      const isOnce = form.dataset.isOnce === 'yes';

      for (let i = 0; i < 35; i++) {
        const current = String(snapshot.dates[i] || '').trim();
        const prev = String(initialValues[`meeting_date_${i}`] ?? initialValues[`date_${i + 1}`] ?? '').trim();
        if (current !== prev) {
          changes[`meeting_date_${i}`] = current;
        }
      }

      const prevEndDate = (() => {
        for (let j = 34; j >= 0; j--) {
          const v = String(initialValues[`meeting_date_${j}`] ?? initialValues[`date_${j + 1}`] ?? '').trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        }
        return '';
      })();
      const computedEndDate = isOnce ? snapshot.startDate : snapshot.endDate;
      if (computedEndDate && computedEndDate !== prevEndDate) {
        changes.end_date = computedEndDate;
      }
    }

    if (!validateActivityTypeAndName(form, statusEl)) return;

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

    const roster = getValidInstructorUsers(state?.clientSettings || {});
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
        setEditMode(form, true);
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
        void saveActivityForm(form);
        return;
      }
      if (ev.target.closest('[data-action="delete-activity"]')) {
        ev.preventDefault();
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
    const typeEl = form.querySelector('[name="activity_type"]');
    const nameSel = form.querySelector('[data-role="activity-name-select"]');
    if (nameSel) nameSel.disabled = !normalizeActivityTypeKey(typeEl?.value);
    syncActivityNoFromName(form);
    const initialValues = {};
    form.querySelectorAll('[name]').forEach((el) => {
      const name = el.getAttribute('name');
      if (!name || name.startsWith('_')) return;
      initialValues[name] = String(el.value ?? '').trim();
    });
    form._initialValues = initialValues;

    form.addEventListener(
      'change',
      (ev) => {
        const nameEl = ev.target.closest('[data-role="activity-name-select"]');
        if (nameEl) {
          const autoNo = detectActivityNoByName(form, String(nameEl.value || ''));
          const hidden = form.querySelector('[data-activity-no]');
          if (hidden && autoNo) hidden.value = autoNo;
        }

        const typeEl = ev.target.closest('[name="activity_type"]');
        if (typeEl) {
          const nameSel = form.querySelector('[data-role="activity-name-select"]');
          if (nameSel && nameSel.dataset.allActivityNames) {
            let allOptions = [];
            try { allOptions = JSON.parse(decodeURIComponent(nameSel.dataset.allActivityNames)); } catch { allOptions = []; }
            const newType = normalizeActivityTypeKey(typeEl.value);
            const { filtered } = activityNameOptionsForType(allOptions, newType);
            nameSel.innerHTML = renderActivityNameOptions(filtered, newType);
            nameSel.disabled = !newType;
            nameSel.value = '';
            syncActivityNoFromName(form);
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

const scheduleStateByForm = new WeakMap();
const replayingForms = new WeakSet();

function drawerFormFor(node) {
  return node?.closest?.('[data-drawer-form]') || null;
}

function meetingKey(input) {
  const idx = String(input?.dataset?.meetingIdx ?? '').trim();
  if (idx || idx === '0') return `idx:${idx}`;
  const name = String(input?.name || '').trim();
  return name ? `name:${name}` : '';
}

function noteKey(input) {
  const idx = String(input?.dataset?.meetingNoteIdx ?? '').trim();
  if (idx || idx === '0') return `note:${idx}`;
  const name = String(input?.name || '').trim();
  return name ? `name:${name}` : '';
}

function editGrid(form) {
  return form?.querySelector?.('[data-meeting-dates-edit]') || null;
}

function currentDateInputs(form) {
  return Array.from(form?.querySelectorAll?.('input[type="date"][data-meeting-idx]') || []);
}

function currentNoteInputs(form) {
  return Array.from(form?.querySelectorAll?.('textarea[data-meeting-note-idx]') || []);
}

function snapshotSchedule(form) {
  const dates = new Map();
  currentDateInputs(form).forEach((input) => {
    const key = meetingKey(input);
    if (key) dates.set(key, String(input.value || ''));
  });
  const notes = new Map();
  currentNoteInputs(form).forEach((input) => {
    const key = noteKey(input);
    if (key) notes.set(key, String(input.value || ''));
  });
  const grid = editGrid(form);
  return {
    dates,
    notes,
    cardCount: grid ? grid.querySelectorAll(':scope > .activity-drawer__date-card').length : null
  };
}

export function primeScheduleBaseline(form) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return null;
  const baseline = snapshotSchedule(form);
  const state = {
    baseline,
    dirtyDates: new Map(),
    dirtyNotes: new Map(),
    changedDateKeys: new Set(),
    structureDirty: false,
    draftCardCount: baseline.cardCount
  };
  scheduleStateByForm.set(form, state);
  return state;
}

function ensureScheduleState(form) {
  return scheduleStateByForm.get(form) || primeScheduleBaseline(form);
}

function recomputeDraft(form, { changedDateKey = '' } = {}) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return null;
  const state = ensureScheduleState(form);
  if (!state) return null;
  const current = snapshotSchedule(form);

  state.dirtyDates = new Map();
  current.dates.forEach((value, key) => {
    if (value !== String(state.baseline.dates.get(key) ?? '')) state.dirtyDates.set(key, value);
  });
  state.baseline.dates.forEach((value, key) => {
    if (!current.dates.has(key) && value !== '') state.dirtyDates.set(key, '');
  });

  state.dirtyNotes = new Map();
  current.notes.forEach((value, key) => {
    if (value !== String(state.baseline.notes.get(key) ?? '')) state.dirtyNotes.set(key, value);
  });
  state.baseline.notes.forEach((value, key) => {
    if (!current.notes.has(key) && value !== '') state.dirtyNotes.set(key, '');
  });

  state.structureDirty = Number.isInteger(current.cardCount)
    && Number.isInteger(state.baseline.cardCount)
    && current.cardCount !== state.baseline.cardCount;
  state.draftCardCount = current.cardCount;

  if (changedDateKey) {
    const currentValue = String(current.dates.get(changedDateKey) ?? '');
    const baselineValue = String(state.baseline.dates.get(changedDateKey) ?? '');
    if (currentValue !== baselineValue) state.changedDateKeys.add(changedDateKey);
    else state.changedDateKeys.delete(changedDateKey);
  }
  return state;
}

export function rememberEditedMeetingDate(input) {
  if (!input?.matches?.('input[type="date"][data-meeting-idx]')) return false;
  const form = drawerFormFor(input);
  if (!form || String(form.dataset.editing || '') !== 'yes') return false;
  const key = meetingKey(input);
  if (!key) return false;
  recomputeDraft(form, { changedDateKey: key });
  return true;
}

export function rememberEditedMeetingNote(input) {
  if (!input?.matches?.('textarea[data-meeting-note-idx]')) return false;
  const form = drawerFormFor(input);
  if (!form || String(form.dataset.editing || '') !== 'yes') return false;
  recomputeDraft(form);
  return true;
}

export function rememberScheduleStructureChange(form) {
  return Boolean(recomputeDraft(form));
}

function adoptHydratedUntouchedFields(form, state) {
  const hydrated = snapshotSchedule(form);
  hydrated.dates.forEach((value, key) => {
    if (!state.dirtyDates.has(key)) state.baseline.dates.set(key, value);
  });
  hydrated.notes.forEach((value, key) => {
    if (!state.dirtyNotes.has(key)) state.baseline.notes.set(key, value);
  });
  if (!state.structureDirty && Number.isInteger(hydrated.cardCount)) {
    state.baseline.cardCount = hydrated.cardCount;
    state.draftCardCount = hydrated.cardCount;
  }
}

function trimGridToDraftCount(form, state) {
  const grid = editGrid(form);
  if (!state?.structureDirty || !grid || !Number.isInteger(state.draftCardCount)) return 0;
  let cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  let removed = 0;
  while (cards.length > state.draftCardCount) {
    cards[cards.length - 1]?.remove();
    removed += 1;
    cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  }
  return removed;
}

export function restoreEditedMeetingDates(form) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return 0;
  const state = scheduleStateByForm.get(form);
  if (!state) return 0;

  adoptHydratedUntouchedFields(form, state);
  let restored = trimGridToDraftCount(form, state);
  currentDateInputs(form).forEach((input) => {
    const key = meetingKey(input);
    if (!key || !state.dirtyDates.has(key)) return;
    const wanted = state.dirtyDates.get(key);
    if (String(input.value || '') !== wanted) {
      input.value = wanted;
      restored += 1;
    }
    input.dataset.prevValue = wanted;
  });
  currentNoteInputs(form).forEach((input) => {
    const key = noteKey(input);
    if (!key || !state.dirtyNotes.has(key)) return;
    const wanted = state.dirtyNotes.get(key);
    if (String(input.value || '') === wanted) return;
    input.value = wanted;
    restored += 1;
  });
  return restored;
}

function replayChangedDateLogic(form) {
  const state = scheduleStateByForm.get(form);
  if (!state?.changedDateKeys?.size || replayingForms.has(form)) return;
  replayingForms.add(form);
  try {
    const inputs = currentDateInputs(form)
      .filter((input) => state.changedDateKeys.has(meetingKey(input)))
      .sort((a, b) => Number(a.dataset.meetingIdx) - Number(b.dataset.meetingIdx));
    inputs.forEach((input) => {
      const EventCtor = input.ownerDocument?.defaultView?.Event || globalThis.Event;
      if (typeof EventCtor === 'function') input.dispatchEvent(new EventCtor('change', { bubbles: true }));
    });
  } finally {
    replayingForms.delete(form);
  }
}

export function clearEditedMeetingDateDrafts(form) {
  if (!form) return;
  scheduleStateByForm.delete(form);
}

export function handleDateSectionMutation(mutation) {
  if (mutation?.type !== 'attributes' || mutation.attributeName !== 'data-dates-loading') return 0;
  const section = mutation.target;
  if (!section?.matches?.('[data-dates-section]')) return 0;
  if (section.hasAttribute('data-dates-loading')) return 0;
  const form = drawerFormFor(section);
  const restored = restoreEditedMeetingDates(form);
  if (restored > 0) replayChangedDateLogic(form);
  return restored;
}

let started = false;
let observer = null;

export function startActivityEditDateRaceGuard() {
  if (started || typeof document === 'undefined') return;
  started = true;

  document.querySelectorAll?.('[data-drawer-form][data-editing="yes"]').forEach((form) => primeScheduleBaseline(form));

  const remember = (event) => {
    const form = drawerFormFor(event.target);
    if (!form || replayingForms.has(form)) return;
    const dateInput = event.target?.closest?.('input[type="date"][data-meeting-idx]');
    if (dateInput) {
      rememberEditedMeetingDate(dateInput);
      return;
    }
    const noteInput = event.target?.closest?.('textarea[data-meeting-note-idx]');
    if (noteInput) rememberEditedMeetingNote(noteInput);
  };
  // Bubble phase is intentional: the drawer's own synchronous chain-shift handler
  // runs first, then we compare the complete user-visible schedule with its baseline.
  document.addEventListener('input', remember);
  document.addEventListener('change', remember);
  document.addEventListener('click', (event) => {
    const action = event.target?.closest?.('[data-action="add-meeting"], [data-action="remove-meeting"]');
    if (!action) return;
    const form = drawerFormFor(action);
    if (!form || String(form.dataset.editing || '') !== 'yes') return;
    // The drawer click handler is on a lower ancestor and has already changed the grid.
    queueMicrotask(() => rememberScheduleStructureChange(form));
  });

  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-editing') {
        const form = mutation.target;
        if (!form?.matches?.('[data-drawer-form]')) continue;
        if (String(form.dataset.editing || '') === 'yes') primeScheduleBaseline(form);
        else clearEditedMeetingDateDrafts(form);
        continue;
      }
      handleDateSectionMutation(mutation);
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-dates-loading', 'data-editing']
  });
}

export function stopActivityEditDateRaceGuardForTests() {
  observer?.disconnect?.();
  observer = null;
  started = false;
}

if (typeof document !== 'undefined') startActivityEditDateRaceGuard();

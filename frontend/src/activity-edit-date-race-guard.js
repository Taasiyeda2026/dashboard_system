const scheduleDraftByForm = new WeakMap();
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

function captureScheduleDraft(form, { changedDateKey = '' } = {}) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return null;
  const existing = scheduleDraftByForm.get(form) || { changedDateKeys: new Set() };
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
  const draft = {
    dates,
    notes,
    cardCount: grid ? grid.querySelectorAll(':scope > .activity-drawer__date-card').length : null,
    changedDateKeys: existing.changedDateKeys || new Set()
  };
  if (changedDateKey) draft.changedDateKeys.add(changedDateKey);
  scheduleDraftByForm.set(form, draft);
  return draft;
}

export function rememberEditedMeetingDate(input) {
  if (!input?.matches?.('input[type="date"][data-meeting-idx]')) return false;
  const form = drawerFormFor(input);
  if (!form || String(form.dataset.editing || '') !== 'yes') return false;
  const key = meetingKey(input);
  if (!key) return false;
  captureScheduleDraft(form, { changedDateKey: key });
  return true;
}

export function rememberEditedMeetingNote(input) {
  if (!input?.matches?.('textarea[data-meeting-note-idx]')) return false;
  const form = drawerFormFor(input);
  if (!form || String(form.dataset.editing || '') !== 'yes') return false;
  captureScheduleDraft(form);
  return true;
}

export function rememberScheduleStructureChange(form) {
  return Boolean(captureScheduleDraft(form));
}

function trimGridToDraftCount(form, draft) {
  const grid = editGrid(form);
  if (!grid || !Number.isInteger(draft?.cardCount)) return 0;
  let cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  let removed = 0;
  while (cards.length > draft.cardCount) {
    cards[cards.length - 1]?.remove();
    removed += 1;
    cards = Array.from(grid.querySelectorAll(':scope > .activity-drawer__date-card'));
  }
  return removed;
}

export function restoreEditedMeetingDates(form) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return 0;
  const draft = scheduleDraftByForm.get(form);
  if (!draft) return 0;

  let restored = trimGridToDraftCount(form, draft);
  currentDateInputs(form).forEach((input) => {
    const key = meetingKey(input);
    if (!key || !draft.dates.has(key)) return;
    const wanted = draft.dates.get(key);
    if (String(input.value || '') !== wanted) {
      input.value = wanted;
      restored += 1;
    }
    input.dataset.prevValue = wanted;
  });
  currentNoteInputs(form).forEach((input) => {
    const key = noteKey(input);
    if (!key || !draft.notes.has(key)) return;
    const wanted = draft.notes.get(key);
    if (String(input.value || '') === wanted) return;
    input.value = wanted;
    restored += 1;
  });
  return restored;
}

function replayChangedDateLogic(form) {
  const draft = scheduleDraftByForm.get(form);
  if (!draft?.changedDateKeys?.size || replayingForms.has(form)) return;
  replayingForms.add(form);
  try {
    const inputs = currentDateInputs(form)
      .filter((input) => draft.changedDateKeys.has(meetingKey(input)))
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
  scheduleDraftByForm.delete(form);
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
  // runs first, then we snapshot the complete user-visible schedule.
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
        if (form?.matches?.('[data-drawer-form]') && String(form.dataset.editing || '') !== 'yes') {
          clearEditedMeetingDateDrafts(form);
        }
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

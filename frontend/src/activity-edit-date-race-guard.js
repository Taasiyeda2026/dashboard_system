const draftDatesByForm = new WeakMap();

function drawerFormFor(node) {
  return node?.closest?.('[data-drawer-form]') || null;
}

function meetingKey(input) {
  const idx = String(input?.dataset?.meetingIdx ?? '').trim();
  if (idx) return `idx:${idx}`;
  const name = String(input?.name || '').trim();
  return name ? `name:${name}` : '';
}

function ensureDraftMap(form) {
  let map = draftDatesByForm.get(form);
  if (!map) {
    map = new Map();
    draftDatesByForm.set(form, map);
  }
  return map;
}

export function rememberEditedMeetingDate(input) {
  if (!input?.matches?.('input[type="date"][data-meeting-idx]')) return false;
  const form = drawerFormFor(input);
  if (!form || String(form.dataset.editing || '') !== 'yes') return false;
  const key = meetingKey(input);
  if (!key) return false;
  ensureDraftMap(form).set(key, String(input.value || ''));
  return true;
}

export function restoreEditedMeetingDates(form) {
  if (!form || String(form.dataset.editing || '') !== 'yes') return 0;
  const drafts = draftDatesByForm.get(form);
  if (!drafts?.size) return 0;

  let restored = 0;
  form.querySelectorAll('input[type="date"][data-meeting-idx]').forEach((input) => {
    const key = meetingKey(input);
    if (!key || !drafts.has(key)) return;
    const wanted = drafts.get(key);
    if (String(input.value || '') === wanted) return;
    input.value = wanted;
    input.dataset.prevValue = wanted;
    restored += 1;
  });
  return restored;
}

export function clearEditedMeetingDateDrafts(form) {
  if (!form) return;
  draftDatesByForm.delete(form);
}

export function handleDateSectionMutation(mutation) {
  if (mutation?.type !== 'attributes' || mutation.attributeName !== 'data-dates-loading') return 0;
  const section = mutation.target;
  if (!section?.matches?.('[data-dates-section]')) return 0;
  if (section.hasAttribute('data-dates-loading')) return 0;
  return restoreEditedMeetingDates(drawerFormFor(section));
}

let started = false;
let observer = null;

export function startActivityEditDateRaceGuard() {
  if (started || typeof document === 'undefined') return;
  started = true;

  const remember = (event) => {
    const input = event.target?.closest?.('input[type="date"][data-meeting-idx]');
    if (input) rememberEditedMeetingDate(input);
  };
  document.addEventListener('input', remember, true);
  document.addEventListener('change', remember, true);

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

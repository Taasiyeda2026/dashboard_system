/**
 * compact-select.js
 *
 * Compact custom dropdown (no search) — same trigger/panel look as searchable-select.
 * Used for time-picker parts, meeting number, and other short option lists.
 *
 * Returns a select-like proxy: { value, addEventListener('change'), focus(), blur(), disabled }
 */

export function createCompactSelect({
  id,
  options = [],
  placeholder = 'בחר…',
  value = '',
  disabled = false,
  ariaLabel = '',
  maxHeight = 260,
  compact = false,
} = {}) {
  let currentOptions = [...options];
  let selectedValue = value ?? '';
  let isOpen = false;
  const changeListeners = [];

  const wrap = document.createElement('div');
  wrap.className = compact ? 'av2-csel av2-csel--compact' : 'av2-csel';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = id ? `${id}-trigger` : undefined;
  trigger.className = 'av2-csel__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  if (ariaLabel) trigger.setAttribute('aria-label', ariaLabel);
  if (disabled) trigger.disabled = true;

  const triggerText = document.createElement('span');
  triggerText.className = 'av2-csel__trigger-text';

  const chevron = document.createElement('span');
  chevron.className = 'av2-csel__chevron';
  chevron.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = 'av2-csel__panel';
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');
  if (maxHeight) panel.style.setProperty('--av2-csel-max-height', `${maxHeight}px`);

  const optList = document.createElement('div');
  optList.className = 'av2-csel__options';
  panel.append(optList);
  trigger.append(triggerText, chevron);
  wrap.append(trigger, panel);

  function labelFor(val) {
    if (val === '' || val == null) return '';
    const match = currentOptions.find((o) => String(o.value) === String(val));
    return match?.label ?? String(val);
  }

  function syncTrigger() {
    const lbl = labelFor(selectedValue);
    triggerText.textContent = lbl || placeholder;
    triggerText.dataset.empty = lbl ? 'false' : 'true';
  }

  function emitChange() {
    for (const fn of changeListeners) fn();
  }

  function renderOptions() {
    optList.innerHTML = '';
    for (const opt of currentOptions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'av2-csel__option';
      btn.setAttribute('role', 'option');
      if (String(opt.value) === String(selectedValue)) btn.classList.add('is-selected');
      btn.textContent = opt.label;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => selectOption(opt.value));
      optList.append(btn);
    }
  }

  function selectOption(val) {
    selectedValue = val ?? '';
    syncTrigger();
    closePanel();
    emitChange();
  }

  function openPanel() {
    if (trigger.disabled) return;
    isOpen = true;
    panel.hidden = false;
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    wrap.style.zIndex = '10';
    renderOptions();
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    wrap.style.zIndex = '';
  }

  trigger.addEventListener('click', () => {
    if (isOpen) closePanel();
    else openPanel();
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePanel();
      trigger.focus();
    }
  });

  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget)) closePanel();
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) closePanel();
  }, true);

  syncTrigger();

  const selectProxy = {
    get value() {
      return selectedValue;
    },
    set value(v) {
      selectedValue = v ?? '';
      syncTrigger();
    },
    addEventListener(type, fn) {
      if (type === 'change') changeListeners.push(fn);
    },
    focus() {
      trigger.focus();
    },
    blur() {
      trigger.blur();
    },
    get disabled() {
      return trigger.disabled;
    },
    set disabled(v) {
      trigger.disabled = !!v;
      if (v) closePanel();
    },
  };

  return {
    wrap,
    trigger,
    select: selectProxy,
    getValue: () => selectedValue,
    setValue: (v) => {
      selectedValue = v ?? '';
      syncTrigger();
    },
    setOptions(opts) {
      currentOptions = [...opts];
      if (selectedValue !== '' && !currentOptions.some((o) => String(o.value) === String(selectedValue))) {
        selectedValue = '';
      }
      syncTrigger();
      if (isOpen) renderOptions();
    },
    reset() {
      selectedValue = '';
      syncTrigger();
    },
  };
}

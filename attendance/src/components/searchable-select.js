/**
 * searchable-select.js
 *
 * Custom dropdown with inline search. Supports optional extended search mode
 * (lazy-loaded options outside the default assignment list).
 *
 * Public API:
 *   createSearchableSelect({ id, label, options, placeholder, searchPlaceholder,
 *     filterFn, extendedSearch, onChange })
 *   → { wrap, getValue(), getLabel(), setValue(), setOptions(), reset(), setDisabled() }
 */

export function createSearchableSelect({
  id,
  label          = '',
  options        = [],
  placeholder    = 'בחר…',
  searchPlaceholder = 'חיפוש…',
  emptyText      = 'לא נמצאו תוצאות',
  filterFn,
  extendedSearch = null,
  searchMode = 'always',
  onChange,
} = {}) {
  let defaultOptions = [...options];
  let currentOptions = [...options];
  let selectedValue  = '';
  let selectedLabel  = '';
  let isOpen         = false;
  let extendedMode   = false;
  let extendedLoading = false;

  const wrap = document.createElement('div');
  wrap.className = 'av2-field av2-ssel';

  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'av2-field__label';
    labelEl.htmlFor = `${id}-trigger`;
    labelEl.textContent = label;
    wrap.append(labelEl);
  }

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = `${id}-trigger`;
  trigger.className = 'av2-ssel__trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');

  const triggerText = document.createElement('span');
  triggerText.className = 'av2-ssel__trigger-text';
  triggerText.textContent = placeholder;
  triggerText.dataset.empty = 'true';

  const chevron = document.createElement('span');
  chevron.className = 'av2-ssel__chevron';
  chevron.setAttribute('aria-hidden', 'true');

  trigger.append(triggerText, chevron);

  const panel = document.createElement('div');
  panel.className = 'av2-ssel__panel';
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');

  const searchWrap = document.createElement('div');
  searchWrap.className = 'av2-ssel__search-wrap';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'av2-ssel__search';
  searchInput.placeholder = searchPlaceholder;
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchWrap.append(searchInput);

  const optList = document.createElement('div');
  optList.className = 'av2-ssel__options';

  panel.append(searchWrap, optList);
  wrap.append(trigger, panel);

  function filterOptions(list, filter) {
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    if (typeof filterFn === 'function') {
      return list.filter((option) => filterFn(option, q));
    }
    return list.filter((option) => String(option.label || '').toLowerCase().includes(q));
  }

  function appendExtendedToggle() {
    if (!extendedSearch || extendedMode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av2-ssel__extended';
    btn.textContent = extendedSearch.label || 'חיפוש מורחב';
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      extendedMode = true;
      searchWrap.hidden = false;
      void loadExtendedOptions(searchInput.value);
      requestAnimationFrame(() => searchInput.focus());
    });
    optList.append(btn);
  }

  function appendExtendedBack() {
    if (!extendedSearch || !extendedMode) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'av2-ssel__extended av2-ssel__extended--back';
    btn.textContent = 'חזרה לפעילויות שלי';
    btn.addEventListener('mousedown', (event) => event.preventDefault());
    btn.addEventListener('click', () => {
      extendedMode = false;
      currentOptions = [...defaultOptions];
      searchInput.value = '';
      searchWrap.hidden = searchMode === 'extended-only';
      renderOptions();
      optList.querySelector('button')?.focus();
    });
    optList.prepend(btn);
  }

  async function loadExtendedOptions(query = '') {
    if (!extendedSearch?.loadOptions) return;
    extendedLoading = true;
    renderOptions(query);
    try {
      const loaded = await extendedSearch.loadOptions(query);
      currentOptions = Array.isArray(loaded) ? loaded : [];
    } catch {
      currentOptions = [];
    } finally {
      extendedLoading = false;
      renderOptions(query);
    }
  }

  function renderOptions(filter = '') {
    optList.innerHTML = '';

    if (extendedLoading) {
      const loading = document.createElement('div');
      loading.className = 'av2-ssel__empty';
      loading.textContent = 'טוען…';
      optList.append(loading);
      return;
    }

    const visible = filterOptions(currentOptions, filter);

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'av2-ssel__empty';
      empty.textContent = emptyText;
      optList.append(empty);
      appendExtendedToggle();
      appendExtendedBack();
      return;
    }

    for (const opt of visible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'av2-ssel__option';
      btn.setAttribute('role', 'option');
      if (opt.value === selectedValue) btn.classList.add('is-selected');
      btn.textContent = opt.label;
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => selectOption(opt));
      optList.append(btn);
    }

    appendExtendedToggle();
    appendExtendedBack();
  }

  function selectOption(opt) {
    selectedValue = opt.value;
    selectedLabel = opt.label;
    triggerText.textContent = opt.label || placeholder;
    triggerText.dataset.empty = opt.label ? 'false' : 'true';
    closePanel();
    onChange?.(opt.value, opt.label, opt);
  }

  function openPanel() {
    if (trigger.disabled) return;
    isOpen = true;
    extendedMode = false;
    currentOptions = [...defaultOptions];
    panel.hidden = false;
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    wrap.style.zIndex = '10';
    searchInput.value = '';
    searchWrap.hidden = searchMode === 'extended-only';
    renderOptions();
    requestAnimationFrame(() => {
      if (!searchWrap.hidden) searchInput.focus();
      else optList.querySelector('button')?.focus();
    });
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    extendedMode = false;
    currentOptions = [...defaultOptions];
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
    if (e.key === 'Escape') { closePanel(); trigger.focus(); }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const choices = [...optList.querySelectorAll('button:not([disabled])')];
    if (!choices.length) return;
    e.preventDefault();
    const current = choices.indexOf(document.activeElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1
      : e.key === 'ArrowDown' ? Math.min(choices.length - 1, current + 1) : Math.max(0, current < 0 ? choices.length - 1 : current - 1);
    choices[next].focus();
  });

  searchInput.addEventListener('input', () => {
    const q = searchInput.value;
    if (extendedMode && extendedSearch?.loadOptions) {
      void loadExtendedOptions(q);
      return;
    }
    renderOptions(q);
  });

  wrap.addEventListener('focusout', (e) => {
    if (!wrap.contains(e.relatedTarget)) closePanel();
  });

  document.addEventListener('mousedown', (e) => {
    if (!wrap.contains(e.target)) closePanel();
  }, true);

  return {
    wrap,
    getValue: () => selectedValue,
    getLabel: () => selectedLabel,

    setValue(value, lbl) {
      selectedValue = value ?? '';
      selectedLabel = lbl ?? '';
      triggerText.textContent = selectedLabel || placeholder;
      triggerText.dataset.empty = selectedLabel ? 'false' : 'true';
    },

    setOptions(opts) {
      defaultOptions = [...opts];
      currentOptions = [...opts];
      if (selectedValue && !defaultOptions.some((o) => o.value === selectedValue)) {
        selectedValue = '';
        selectedLabel = '';
        triggerText.textContent = placeholder;
        triggerText.dataset.empty = 'true';
      }
      if (isOpen) renderOptions(searchInput.value);
    },

    reset() {
      selectedValue = '';
      selectedLabel = '';
      triggerText.textContent = placeholder;
      triggerText.dataset.empty = 'true';
    },

    setDisabled(disabled) {
      trigger.disabled = !!disabled;
    },
  };
}

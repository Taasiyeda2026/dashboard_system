/**
 * searchable-select.js
 *
 * A custom dropdown that looks identical to .av2-field__select but adds
 * an inline search field as the FIRST item inside the opened dropdown.
 *
 * Public API:
 *   createSearchableSelect({ id, label, options, placeholder, searchPlaceholder, onChange })
 *   → { wrap, getValue(), getLabel(), setValue(value, label), setOptions(opts), reset() }
 *
 * onChange(value, label, option) — called on selection; `option` is the full
 * option object so callers can read extra fields (authority_id, semel_mosad …).
 */

export function createSearchableSelect({
  id,
  label          = '',
  options        = [],
  placeholder    = 'בחר…',
  searchPlaceholder = 'חיפוש…',
  onChange,
} = {}) {
  let currentOptions = [...options];
  let selectedValue  = '';
  let selectedLabel  = '';
  let isOpen         = false;

  // ── Root ─────────────────────────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'av2-field av2-ssel';

  // ── Label ─────────────────────────────────────────────────────────────────
  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'av2-field__label';
    labelEl.htmlFor = `${id}-trigger`;
    labelEl.textContent = label;
    wrap.append(labelEl);
  }

  // ── Trigger button (mimics <select> appearance) ───────────────────────────
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

  // ── Dropdown panel ─────────────────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'av2-ssel__panel';
  panel.hidden = true;
  panel.setAttribute('role', 'listbox');

  // Search row — first item inside the panel
  const searchWrap = document.createElement('div');
  searchWrap.className = 'av2-ssel__search-wrap';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.className = 'av2-ssel__search';
  searchInput.placeholder = searchPlaceholder;
  searchInput.setAttribute('autocomplete', 'off');
  searchInput.setAttribute('spellcheck', 'false');
  searchWrap.append(searchInput);

  // Scrollable options list
  const optList = document.createElement('div');
  optList.className = 'av2-ssel__options';

  panel.append(searchWrap, optList);
  wrap.append(trigger, panel);

  // ── Render options ─────────────────────────────────────────────────────────
  function renderOptions(filter = '') {
    optList.innerHTML = '';
    const q = filter.trim().toLowerCase();
    const visible = q
      ? currentOptions.filter(o => o.label.toLowerCase().includes(q))
      : currentOptions;

    if (visible.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'av2-ssel__empty';
      empty.textContent = 'לא נמצאו תוצאות';
      optList.append(empty);
      return;
    }

    for (const opt of visible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'av2-ssel__option';
      btn.setAttribute('role', 'option');
      if (opt.value === selectedValue) btn.classList.add('is-selected');
      btn.textContent = opt.label;
      // Prevent focus from leaving searchInput on mousedown, so click still fires
      btn.addEventListener('mousedown', e => e.preventDefault());
      btn.addEventListener('click', () => selectOption(opt));
      optList.append(btn);
    }
  }

  // ── Select ─────────────────────────────────────────────────────────────────
  function selectOption(opt) {
    selectedValue = opt.value;
    selectedLabel = opt.label;
    triggerText.textContent = opt.label || placeholder;
    triggerText.dataset.empty = opt.label ? 'false' : 'true';
    closePanel();
    onChange?.(opt.value, opt.label, opt);
  }

  // ── Open / close ───────────────────────────────────────────────────────────
  function openPanel() {
    if (trigger.disabled) return;
    isOpen = true;
    panel.hidden = false;
    trigger.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    searchInput.value = '';
    renderOptions();
    requestAnimationFrame(() => searchInput.focus());
  }

  function closePanel() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    trigger.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
  }

  // ── Events ─────────────────────────────────────────────────────────────────
  trigger.addEventListener('click', () => {
    if (isOpen) closePanel();
    else openPanel();
  });

  // Escape key closes
  panel.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePanel(); trigger.focus(); }
  });

  searchInput.addEventListener('input', () => renderOptions(searchInput.value));

  // Close when focus leaves the entire component
  wrap.addEventListener('focusout', e => {
    if (!wrap.contains(e.relatedTarget)) closePanel();
  });

  // Close on outside click/tap (capture phase so it runs before re-open)
  document.addEventListener('mousedown', e => {
    if (!wrap.contains(e.target)) closePanel();
  }, true);

  // ── Public API ─────────────────────────────────────────────────────────────
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
      currentOptions = [...opts];
      // Clear selection when the chosen value is no longer in the list
      if (selectedValue && !currentOptions.some(o => o.value === selectedValue)) {
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
  };
}

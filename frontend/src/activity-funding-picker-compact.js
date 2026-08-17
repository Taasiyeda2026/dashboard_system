const ADD_PICKER_SELECTOR = 'fieldset[data-funding-picker]';
const EDIT_PICKER_SELECTOR = 'select[name="funding_sources"][multiple][data-scheduling-multi]';

function cleanText(value) {
  return String(value ?? '').trim();
}

export function validateCourseFundingSplit(rows = [], priceValue = '') {
  const price = Number(priceValue);
  if (rows.length <= 1) return { valid: Number.isFinite(price), total: Number.isFinite(price) ? price : 0 };
  const amounts = rows.map((item) => cleanText(item?.amount) === '' ? Number.NaN : Number(item.amount));
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  return {
    valid: Number.isFinite(price) && amounts.every((amount) => Number.isFinite(amount) && amount >= 0) && Math.abs(total - price) <= 0.005,
    total
  };
}

function uniqueRows(rows = []) {
  const seen = new Set();
  return rows.filter((row) => {
    const id = cleanText(row?.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function optionListHtml(items, currentId, selectedIds) {
  const current = cleanText(currentId);
  const selected = new Set((selectedIds || []).map(cleanText).filter(Boolean));
  return ['<option value="">בחרו גורם מימון</option>']
    .concat(items.map((item) => {
      const id = cleanText(item.id);
      const isCurrent = id === current;
      const disabled = !isCurrent && selected.has(id) ? ' disabled' : '';
      return `<option value="${escapeAttr(id)}"${isCurrent ? ' selected' : ''}${disabled}>${escapeHtml(item.name)}</option>`;
    }))
    .join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function rowMarkup(items, row, index, rows, { allowAmounts = false } = {}) {
  const selectedIds = rows.map((entry) => entry.id).filter(Boolean);
  const showAmounts = allowAmounts && rows.length > 1;
  return `<div class="ds-funding-compact-row${showAmounts ? ' has-amount' : ''}" data-funding-compact-row="${index}">
    <label class="ds-funding-compact-field"><span>גורם מימון ${index + 1}</span><select class="ds-input ds-funding-compact-select" data-funding-compact-select="${index}" aria-label="גורם מימון ${index + 1}">${optionListHtml(items, row.id, selectedIds)}</select></label>
    ${showAmounts ? `<label class="ds-funding-compact-field"><span>סכום</span><input class="ds-input ds-funding-compact-amount" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeAttr(row.amount || '')}" data-funding-compact-amount="${index}" placeholder="סכום" aria-label="סכום מימון ${index + 1}"></label>` : ''}
    ${rows.length > 1 ? `<button type="button" class="ds-funding-compact-remove" data-funding-compact-remove="${index}" aria-label="הסר גורם מימון">×</button>` : ''}
  </div>`;
}

function pickerMarkup(items, rows, options = {}) {
  const canAdd = items.length > rows.filter((row) => row.id).length && !rows.some((row) => !row.id);
  return `<div class="ds-funding-compact-picker" data-funding-compact-picker>
    <div class="ds-funding-compact-rows" data-funding-compact-rows>
      ${rows.map((row, index) => rowMarkup(items, row, index, rows, options)).join('')}
    </div>
    ${canAdd ? '<button type="button" class="ds-funding-compact-add" data-funding-compact-add>+ הוסף גורם מימון</button>' : ''}
  </div>`;
}

function ensureOneRow(rows) {
  return rows.length ? rows : [{ id: '', amount: '' }];
}

function bindCompactPicker(host, items, initialRows, { allowAmounts = false, sync } = {}) {
  let rows = ensureOneRow(uniqueRows(initialRows).map((row) => ({ id: cleanText(row.id), amount: cleanText(row.amount) })));

  const render = () => {
    host.innerHTML = pickerMarkup(items, rows, { allowAmounts });
  };

  const commit = () => {
    sync?.(rows.map((row) => ({ ...row })));
    render();
  };

  host.addEventListener('change', (event) => {
    const select = event.target.closest?.('[data-funding-compact-select]');
    if (select) {
      const index = Number(select.dataset.fundingCompactSelect);
      if (!Number.isInteger(index) || !rows[index]) return;
      rows[index].id = cleanText(select.value);
      if (!rows[index].id) rows[index].amount = '';
      commit();
      return;
    }
    const amount = event.target.closest?.('[data-funding-compact-amount]');
    if (amount) {
      const index = Number(amount.dataset.fundingCompactAmount);
      if (!Number.isInteger(index) || !rows[index]) return;
      rows[index].amount = cleanText(amount.value);
      sync?.(rows.map((row) => ({ ...row })));
    }
  });

  host.addEventListener('input', (event) => {
    const amount = event.target.closest?.('[data-funding-compact-amount]');
    if (!amount) return;
    const index = Number(amount.dataset.fundingCompactAmount);
    if (!Number.isInteger(index) || !rows[index]) return;
    rows[index].amount = cleanText(amount.value);
    sync?.(rows.map((row) => ({ ...row })));
  });

  host.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-funding-compact-add]')) {
      if (!rows.some((row) => !row.id)) rows.push({ id: '', amount: '' });
      render();
      return;
    }
    const remove = event.target.closest?.('[data-funding-compact-remove]');
    if (!remove) return;
    const index = Number(remove.dataset.fundingCompactRemove);
    if (!Number.isInteger(index) || !rows[index]) return;
    rows.splice(index, 1);
    rows = ensureOneRow(rows);
    commit();
  });

  render();
  return {
    reset(nextRows = []) {
      rows = ensureOneRow(uniqueRows(nextRows).map((row) => ({ id: cleanText(row.id), amount: cleanText(row.amount) })));
      render();
    }
  };
}

export function enhanceAddFundingPicker(fieldset) {
  if (!fieldset || fieldset.dataset.fundingCompactEnhanced === 'yes') return null;
  const nativeItems = Array.from(fieldset.querySelectorAll('[data-funding-source-id]')).map((checkbox) => {
    const label = checkbox.closest('label');
    const amountInput = label?.querySelector('[data-funding-amount]');
    const name = cleanText(label?.querySelector('span')?.textContent);
    return {
      id: cleanText(checkbox.dataset.fundingSourceId),
      name,
      checkbox,
      amountInput,
      label
    };
  }).filter((item) => item.id && item.name);
  if (!nativeItems.length) return null;

  const storage = fieldset.ownerDocument.createElement('div');
  storage.className = 'ds-funding-native-storage';
  storage.setAttribute('aria-hidden', 'true');
  nativeItems.forEach((item) => item.label && storage.append(item.label));

  const host = fieldset.ownerDocument.createElement('div');
  host.className = 'ds-funding-compact-host';
  const initialRows = nativeItems
    .filter((item) => item.checkbox.checked)
    .map((item) => ({ id: item.id, amount: cleanText(item.amountInput?.value) }));

  const sync = (rows) => {
    const byId = new Map(rows.filter((row) => row.id).map((row) => [row.id, row]));
    nativeItems.forEach((item) => {
      const row = byId.get(item.id);
      item.checkbox.checked = Boolean(row);
      if (item.amountInput) item.amountInput.value = row ? cleanText(row.amount) : '';
    });
  };

  const legend = fieldset.querySelector('legend');
  fieldset.replaceChildren();
  if (legend) fieldset.append(legend);
  fieldset.append(host, storage);
  fieldset.dataset.fundingCompactEnhanced = 'yes';
  fieldset.classList.add('ds-funding-compact-add');
  return bindCompactPicker(host, nativeItems, initialRows, { allowAmounts: true, sync });
}

export function enhanceEditFundingPicker(select) {
  if (!select || select.dataset.fundingCompactEnhanced === 'yes') return null;
  const items = Array.from(select.options)
    .map((option) => ({ id: cleanText(option.value), name: cleanText(option.textContent) }))
    .filter((item) => item.id && item.name);
  if (!items.length) return null;

  const host = select.ownerDocument.createElement('div');
  host.className = 'ds-funding-compact-host ds-funding-compact-host--edit';
  select.before(host);
  select.classList.add('ds-funding-native-hidden');
  select.dataset.fundingCompactEnhanced = 'yes';

  const readNativeRows = () => Array.from(select.selectedOptions).map((option) => ({ id: cleanText(option.value), amount: cleanText(option.dataset.fundingAmount) }));
  const sync = (rows) => {
    const selected = new Set(rows.map((row) => cleanText(row.id)).filter(Boolean));
    Array.from(select.options).forEach((option) => {
      const row = rows.find((entry) => cleanText(entry.id) === cleanText(option.value));
      option.selected = selected.has(cleanText(option.value));
      option.dataset.fundingAmount = row ? cleanText(row.amount) : '';
    });
  };
  const controller = bindCompactPicker(host, items, readNativeRows(), { allowAmounts: true, sync });
  select.form?.addEventListener('reset', () => {
    queueMicrotask(() => {
      Array.from(select.options).forEach((option) => {
        option.dataset.fundingAmount = cleanText(option.dataset.initialFundingAmount);
      });
      controller.reset(readNativeRows());
    });
  });
  return controller;
}

export function enhanceFundingPickers(root = document) {
  root.querySelectorAll?.(ADD_PICKER_SELECTOR).forEach((fieldset) => enhanceAddFundingPicker(fieldset));
  root.querySelectorAll?.(EDIT_PICKER_SELECTOR).forEach((select) => enhanceEditFundingPicker(select));
}

function startObserver() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  enhanceFundingPickers(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.(ADD_PICKER_SELECTOR)) enhanceAddFundingPicker(node);
        if (node.matches?.(EDIT_PICKER_SELECTOR)) enhanceEditFundingPicker(node);
        enhanceFundingPickers(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

startObserver();

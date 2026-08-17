export function createInputField({
  id,
  label,
  type = 'text',
  placeholder = '',
  autocomplete = '',
  value = '',
  attrs = {}
} = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'av2-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'av2-field__label';
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  input.type = type;
  input.className = 'av2-field__input';
  if (placeholder) input.placeholder = placeholder;
  if (autocomplete) input.autocomplete = autocomplete;
  // Always set value, even if '0' or empty string
  input.value = value ?? '';
  for (const [key, attrValue] of Object.entries(attrs)) {
    if (key === 'placeholder') {
      input.placeholder = attrValue;
    } else {
      input.setAttribute(key, attrValue);
    }
  }

  wrap.append(labelEl, input);
  return { wrap, input };
}

/**
 * options: string[] | { value: string, label: string }[]
 * value: initial selected value (optional)
 */
export function createSelectField({ id, label, options = [], value = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'av2-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'av2-field__label';
  labelEl.htmlFor = id;
  labelEl.textContent = label;

  const select = document.createElement('select');
  select.id = id;
  select.name = id;
  select.className = 'av2-field__select';

  for (const option of options) {
    const opt = document.createElement('option');
    if (typeof option === 'string') {
      opt.value = option;
      opt.textContent = option;
    } else {
      opt.value = option.value ?? '';
      opt.textContent = option.label ?? option.value ?? '';
    }
    select.append(opt);
  }

  if (value) select.value = value;

  wrap.append(labelEl, select);
  return { wrap, input: select };
}

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
  if (value) input.value = value;
  for (const [key, attrValue] of Object.entries(attrs)) input.setAttribute(key, attrValue);

  wrap.append(labelEl, input);
  return { wrap, input };
}

export function createSelectField({ id, label, options = [] } = {}) {
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
    opt.value = option;
    opt.textContent = option;
    select.append(opt);
  }

  wrap.append(labelEl, select);
  return { wrap, input: select };
}

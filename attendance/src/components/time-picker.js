/**
 * time-picker.js — shared compact time picker (hour + minute dropdowns).
 * Used by both the New Report form and the My Reports edit form.
 */

import { createCompactSelect } from './compact-select.js';

/**
 * @param {string} id
 * @param {string} label
 * @param {string} defaultValue  "HH:MM" or ""
 * @param {number} minuteStep   Minute increment (default 5)
 */
export function createTimePicker(id, label, defaultValue = '', minuteStep = 5) {
  const defMatch = defaultValue.match(/^(\d{1,2}):(\d{2})$/);
  const defH = defMatch ? parseInt(defMatch[1], 10) : null;
  const defM = defMatch ? parseInt(defMatch[2], 10) : null;

  const wrap = document.createElement('div');
  wrap.className = 'av2-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'av2-field__label';
  labelEl.textContent = label;

  const row = document.createElement('div');
  row.className = 'av2-time-picker';

  let minHour = 0;

  const hourControl = createCompactSelect({
    id: `${id}-h`,
    placeholder: 'שע׳',
    ariaLabel: `${label} — שעה`,
    maxHeight: 260,
    compact: true,
  });

  const sep = document.createElement('span');
  sep.className = 'av2-time-picker__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ':';

  const minControl = createCompactSelect({
    id: `${id}-m`,
    placeholder: 'דק׳',
    ariaLabel: `${label} — דקות`,
    maxHeight: 260,
    compact: true,
  });

  function buildHourOptions(fromHour = 0) {
    minHour = fromHour;
    const opts = [{ value: '', label: 'שע׳' }];
    for (let h = fromHour; h <= 23; h++) {
      opts.push({ value: String(h), label: String(h).padStart(2, '0') });
    }
    const prev = hourControl.getValue();
    hourControl.setOptions(opts);
    if (prev !== '' && parseInt(prev, 10) >= fromHour) {
      hourControl.setValue(prev);
    } else {
      hourControl.setValue('');
    }
  }

  function buildMinuteOptions() {
    const opts = [{ value: '', label: 'דק׳' }];
    for (let m = 0; m < 60; m += minuteStep) {
      opts.push({ value: String(m), label: String(m).padStart(2, '0') });
    }
    minControl.setOptions(opts);
  }

  buildHourOptions();
  buildMinuteOptions();

  if (defH !== null) hourControl.setValue(String(defH));
  if (defM !== null) {
    const rounded = Math.round(defM / minuteStep) * minuteStep;
    minControl.setValue(String(rounded < 60 ? rounded : 60 - minuteStep));
  }

  hourControl.wrap.classList.add('av2-time-picker__part');
  minControl.wrap.classList.add('av2-time-picker__part');

  function getValue() {
    const h = hourControl.getValue();
    const m = minControl.getValue();
    if (h === '' || m === '') return '';
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  row.append(hourControl.wrap, sep, minControl.wrap);
  wrap.append(labelEl, row);

  return {
    wrap,
    hourSel: hourControl.select,
    minSel: minControl.select,
    getValue,
    setMinHour: buildHourOptions,
  };
}

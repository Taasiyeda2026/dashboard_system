/**
 * time-picker.js — shared compact time picker (hour + minute dropdowns).
 * Used by both the New Report form and the My Reports edit form.
 */

import { createCompactSelect } from './compact-select.js';

function parseTimeValue(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return hour * 60 + minute;
}

/**
 * @param {string} id
 * @param {string} label
 * @param {string} defaultValue  "HH:MM", "HH:MM:SS" or ""
 * @param {number} minuteStep   Minute increment (default 5)
 */
export function createTimePicker(id, label, defaultValue = '', minuteStep = 5) {
  const defMatch = String(defaultValue || '').match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  const defH = defMatch ? parseInt(defMatch[1], 10) : null;
  const defM = defMatch ? parseInt(defMatch[2], 10) : null;

  const wrap = document.createElement('div');
  wrap.className = 'av2-field';

  const labelEl = document.createElement('label');
  labelEl.className = 'av2-field__label';
  labelEl.textContent = label;

  const row = document.createElement('div');
  row.className = 'av2-time-picker';

  let minTimeMinutes = null;

  const hourControl = createCompactSelect({
    id: `${id}-h`,
    placeholder: '--',
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
    placeholder: '--',
    ariaLabel: `${label} — דקות`,
    maxHeight: 260,
    compact: true,
  });

  function buildHourOptions(fromHour = 0) {
    const opts = [{ value: '', label: '—' }];
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

  function buildMinuteOptionsForHour(hourValue) {
    const opts = [{ value: '', label: '—' }];
    if (hourValue === '' || hourValue == null) {
      minControl.setOptions(opts);
      minControl.setValue('');
      return;
    }

    const hour = parseInt(hourValue, 10);
    if (Number.isNaN(hour)) {
      minControl.setOptions(opts);
      minControl.setValue('');
      return;
    }

    let startMinute = 0;
    if (minTimeMinutes != null && hour === Math.floor(minTimeMinutes / 60)) {
      startMinute = minTimeMinutes % 60;
    }

    for (let m = startMinute; m < 60; m += minuteStep) {
      opts.push({ value: String(m), label: String(m).padStart(2, '0') });
    }

    const prev = minControl.getValue();
    minControl.setOptions(opts);
    if (prev !== '' && parseInt(prev, 10) >= startMinute) {
      minControl.setValue(prev);
    } else {
      minControl.setValue('');
    }
  }

  function rebuildFromMinTime() {
    if (minTimeMinutes == null) {
      buildHourOptions(0);
      buildMinuteOptionsForHour(hourControl.getValue());
      return;
    }
    const minHour = Math.floor(minTimeMinutes / 60);
    buildHourOptions(minHour);
    buildMinuteOptionsForHour(hourControl.getValue());
  }

  function clearValue() {
    hourControl.setValue('');
    minControl.setValue('');
  }

  function isCurrentValueValid() {
    const current = parseTimeValue(getValue());
    if (current == null) return true;
    if (minTimeMinutes == null) return true;
    return current >= minTimeMinutes;
  }

  function enforceValidValue() {
    if (!isCurrentValueValid()) clearValue();
    else buildMinuteOptionsForHour(hourControl.getValue());
  }

  /**
   * Earliest allowed time (hour + minute together).
   * For end-time pickers pass start + one step so end is strictly after start.
   */
  function setMinTime(minTimeStr) {
    const parsed = parseTimeValue(minTimeStr);
    minTimeMinutes = parsed == null ? null : parsed;
    rebuildFromMinTime();
    enforceValidValue();
  }

  /** @deprecated use setMinTime — kept for callers that only had hour granularity */
  function setMinHour(fromHour = 0) {
    minTimeMinutes = fromHour * 60;
    rebuildFromMinTime();
    enforceValidValue();
  }

  buildHourOptions();
  buildMinuteOptionsForHour('');

  if (defH !== null) hourControl.setValue(String(defH));
  if (defM !== null) {
    const rounded = Math.round(defM / minuteStep) * minuteStep;
    minControl.setValue(String(rounded < 60 ? rounded : 60 - minuteStep));
  }

  hourControl.wrap.classList.add('av2-time-picker__part');
  minControl.wrap.classList.add('av2-time-picker__part');

  hourControl.select.addEventListener('change', () => {
    buildMinuteOptionsForHour(hourControl.getValue());
    enforceValidValue();
  });

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
    clearValue,
    setMinTime,
    setMinHour,
  };
}

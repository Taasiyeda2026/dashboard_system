/**
 * time-picker.js — shared compact two-select time picker (hour + minute).
 * Used by both the New Report form and the My Reports edit form, so
 * creation and editing render the exact same start/end-time control.
 */

/**
 * Creates a compact two-select time picker (hour + minute).
 * Returns { wrap, hourSel, minSel, getValue(), setMinHour(h) }
 *
 * @param {string} id            Base id (suffixed with -h / -m)
 * @param {string} label         Field label text
 * @param {string} defaultValue  "HH:MM" or ""
 * @param {number} minuteStep    Minute increment (default 5; edit uses 1 for exact legacy values)
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

  const hourSel = document.createElement('select');
  hourSel.id = `${id}-h`;
  hourSel.className = 'av2-time-picker__sel av2-time-picker__hour';
  hourSel.setAttribute('aria-label', `${label} — שעה`);

  const sep = document.createElement('span');
  sep.className = 'av2-time-picker__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = ':';

  const minSel = document.createElement('select');
  minSel.id = `${id}-m`;
  minSel.className = 'av2-time-picker__sel av2-time-picker__min';
  minSel.setAttribute('aria-label', `${label} — דקות`);

  function buildHours(minHour = 0) {
    const prev = hourSel.value;
    hourSel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'שע׳'; ph.disabled = true;
    hourSel.append(ph);
    for (let h = minHour; h <= 23; h++) {
      const opt = document.createElement('option');
      opt.value = String(h);
      opt.textContent = String(h).padStart(2, '0');
      hourSel.append(opt);
    }
    // Restore previous if still in range
    if (prev !== '' && parseInt(prev, 10) >= minHour) {
      hourSel.value = prev;
    } else {
      hourSel.value = '';
    }
  }

  function buildMinutes() {
    minSel.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = ''; ph.textContent = 'דק׳'; ph.disabled = true;
    minSel.append(ph);
    for (let m = 0; m < 60; m += minuteStep) {
      const opt = document.createElement('option');
      opt.value = String(m);
      opt.textContent = String(m).padStart(2, '0');
      minSel.append(opt);
    }
  }

  buildHours();
  buildMinutes();

  if (defH !== null) hourSel.value = String(defH);
  if (defM !== null) {
    // Round to nearest valid minute slot
    const rounded = Math.round(defM / minuteStep) * minuteStep;
    minSel.value = String(rounded < 60 ? rounded : 60 - minuteStep);
  }

  function getValue() {
    if (hourSel.value === '' || minSel.value === '') return '';
    return String(hourSel.value).padStart(2, '0') + ':' + String(minSel.value).padStart(2, '0');
  }

  row.append(hourSel, sep, minSel);
  wrap.append(labelEl, row);

  return {
    wrap,
    hourSel,
    minSel,
    getValue,
    setMinHour: buildHours,
  };
}

const HALF_HOUR_TIMES = Object.freeze(Array.from({ length: 48 }, (_, index) => {
  const hour = String(Math.floor(index / 2)).padStart(2, '0');
  return `${hour}:${index % 2 ? '30' : '00'}`;
}));

export function normalizeActivityTime(value) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function activityTimeOptions({ minimum = '', selected = '' } = {}) {
  const floor = normalizeActivityTime(minimum);
  const current = normalizeActivityTime(selected);
  return [...new Set([...HALF_HOUR_TIMES, current].filter(Boolean))]
    .sort()
    .filter((time) => !floor || time >= floor);
}

export function syncActivityEndTimeOptions(startSelect, endSelect) {
  if (!startSelect || !endSelect) return '';
  const start = normalizeActivityTime(startSelect.value);
  const previousEnd = normalizeActivityTime(endSelect.value);
  const nextEnd = previousEnd && (!start || previousEnd >= start) ? previousEnd : start;
  const options = activityTimeOptions({ minimum: start, selected: nextEnd });
  const blank = endSelect.ownerDocument.createElement('option');
  blank.value = '';
  blank.textContent = '—';
  endSelect.replaceChildren(...(!nextEnd ? [blank] : []), ...options.map((time) => {
    const option = endSelect.ownerDocument.createElement('option');
    option.value = time;
    option.textContent = time;
    return option;
  }));
  endSelect.value = nextEnd;
  return endSelect.value;
}

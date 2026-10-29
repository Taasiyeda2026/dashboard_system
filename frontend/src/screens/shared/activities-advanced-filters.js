import { escapeHtml } from './html.js';
import { ensureActivityListFilters } from './activity-list-filters.js';

export const ADVANCED_ACTIVITY_FILTER_KEYS = [
  'advStartPresence', 'advEndPresence', 'advMeetingFrom', 'advMeetingTo', 'advPricePresence'
];

const PRESENCE_OPTIONS = [
  ['', 'הכול'],
  ['present', 'קיים'],
  ['missing', 'חסר']
];

const ASSIGNMENT_OPTIONS = [
  ['all', 'כל המצבים'],
  ['assigned', 'משובץ'],
  ['draft', 'ממתין לאישור'],
  ['unassigned', 'ללא מדריך']
];

function isEntered(value) {
  const valueText = String(value ?? '').trim();
  return valueText !== '' && !['-', '—', 'לא משויך', 'ללא שיוך', 'null', 'undefined'].includes(valueText);
}

function asDate(value) {
  const date = String(value ?? '').trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

/** List scheduled meeting dates on the activity, not its start/end range. */
export function activitySessionDates(row = {}) {
  const dates = new Set();
  const add = (value) => {
    const candidate = value && typeof value === 'object'
      ? (value.date ?? value.meeting_date ?? value.meetingDate)
      : value;
    const date = asDate(candidate);
    if (date) dates.add(date);
  };
  for (const key of ['meeting_dates', 'date_cols', 'meeting_schedule']) {
    if (Array.isArray(row?.[key])) row[key].forEach(add);
  }
  for (let i = 1; i <= 35; i += 1) {
    add(row?.[`date_${i}`]);
    add(row?.[`Date${i}`]);
  }
  return [...dates].sort();
}

function passesPresence(value, actual) {
  return value !== 'present' && value !== 'missing'
    || (value === 'present' ? actual : !actual);
}

/**
 * Apply purely presentational filters to the list already loaded for the current
 * activities tab. No database writes or additional requests are needed.
 */
export function applyActivitiesAdvancedFilters(rows = [], filters = {}) {
  const from = asDate(filters.advMeetingFrom);
  const to = asDate(filters.advMeetingTo);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const start = asDate(row?.start_date ?? row?.date_start);
    const end = asDate(row?.end_date ?? row?.date_end);
    if (!passesPresence(filters.advStartPresence, !!start)) return false;
    if (!passesPresence(filters.advEndPresence, !!end)) return false;
    if (from || to) {
      const matchingMeeting = activitySessionDates(row).some((date) =>
        (!from || date >= from) && (!to || date <= to));
      if (!matchingMeeting) return false;
    }
    // A recorded price of 0 is still a filled-in value.
    if (!passesPresence(filters.advPricePresence, isEntered(row?.price))) return false;
    return true;
  });
}

export function advancedActivitiesFilterCount(filters = {}, assignment = 'all') {
  const count = ADVANCED_ACTIVITY_FILTER_KEYS.filter((key) => !!String(filters?.[key] ?? '').trim()).length;
  return count + (assignment && assignment !== 'all' ? 1 : 0);
}

function selectField(key, label, options, value) {
  const selected = String(value || '');
  return '<label class="ds-act-advanced__field"><span>' + escapeHtml(label) + '</span>'
    + '<select class="ds-input ds-input--sm" data-activity-advanced-field="' + escapeHtml(key) + '" aria-label="' + escapeHtml(label) + '">'
    + options.map(([v, caption]) => '<option value="' + escapeHtml(v) + '"' + (v === selected ? ' selected' : '') + '>' + escapeHtml(caption) + '</option>').join('')
    + '</select></label>';
}

function dateField(key, label, value) {
  return '<label class="ds-act-advanced__field"><span>' + escapeHtml(label) + '</span>'
    + '<input type="date" class="ds-input ds-input--sm" data-activity-advanced-field="' + key
    + '" aria-label="' + escapeHtml(label) + '" value="' + escapeHtml(asDate(value)) + '">'
    + '</label>';
}

/** Icon-only control, matching the feedback screen filter affordance. */
export function activitiesAdvancedFilterToggleHtml(filters = {}, assignment = 'all', open = false) {
  const count = advancedActivitiesFilterCount(filters, assignment);
  return '<button type="button" class="ds-act-advanced__toggle'
    + (count ? ' is-active' : '')
    + '" data-activities-advanced-toggle aria-controls="activities-advanced-filters-panel" aria-expanded="'
    + (open ? 'true' : 'false')
    + '" aria-label="אפשרויות סינון נוספות" title="אפשרויות סינון נוספות">'
    + '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="M4 6h16M7 12h10M10 18h4"/></svg>'
    + (count ? '<span class="ds-act-advanced__indicator" aria-hidden="true"></span>' : '')
    + '</button>';
}

/** Full-width inline disclosure below the activity toolbar, not a floating overlay. */
export function activitiesAdvancedFiltersHtml(filters = {}, assignment = 'all', open = false) {
  return '<section id="activities-advanced-filters-panel" class="ds-act-advanced__panel" data-activities-advanced-panel dir="rtl" role="group" aria-label="אפשרויות סינון נוספות"'
    + (open ? '' : ' hidden') + '>'
    + '<div class="ds-act-advanced__grid">'
    + selectField('advStartPresence', 'תאריך התחלה', PRESENCE_OPTIONS, filters.advStartPresence)
    + selectField('advEndPresence', 'תאריך סיום', PRESENCE_OPTIONS, filters.advEndPresence)
    + dateField('advMeetingFrom', 'מפגש מתאריך', filters.advMeetingFrom)
    + dateField('advMeetingTo', 'מפגש עד תאריך', filters.advMeetingTo)
    + selectField('assignment', 'מצב שיבוץ', ASSIGNMENT_OPTIONS, assignment)
    + selectField('advPricePresence', 'מחיר פעילות', PRESENCE_OPTIONS, filters.advPricePresence)
    + '</div>'
    + '<div class="ds-act-advanced__footer"><span class="ds-act-advanced__hint">הטווח נבדק מול כל תאריכי המפגשים של הפעילות</span>'
    + '<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-activities-advanced-reset>ניקוי</button>'
    + '<button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-activities-advanced-close>סגירה</button></div>'
    + '</section>';
}

/** Inline filters remain open during selection and close only on user action. */
export function bindActivitiesAdvancedFilters(root, state, scope, rerender) {
  const button = root.querySelector('[data-activities-advanced-toggle]');
  const panel = root.querySelector('[data-activities-advanced-panel]');
  if (!button || !panel) return;
  const toggle = (next) => {
    state.activitiesAdvancedFiltersOpen = !!next;
    panel.hidden = !next;
    button.setAttribute('aria-expanded', next ? 'true' : 'false');
  };
  button?.addEventListener('click', () => toggle(!state.activitiesAdvancedFiltersOpen));
  panel.querySelectorAll('[data-activities-advanced-close]').forEach((node) => {
    node.addEventListener('click', () => {
      toggle(false);
      button.focus();
    });
  });
  panel.querySelectorAll('[data-activity-advanced-field]').forEach((node) => {
    node.addEventListener('change', (event) => {
      const field = event.target?.dataset?.activityAdvancedField;
      const value = event.target?.value || '';
      if (field === 'assignment') {
        state.activitiesInstructorStatusFilter = ASSIGNMENT_OPTIONS.some(([k]) => k === value) ? value : 'all';
        state.allActivitiesStatusFilter = 'all';
      } else if (ADVANCED_ACTIVITY_FILTER_KEYS.includes(field)) {
        const filters = ensureActivityListFilters(state, scope);
        filters[field] = value;
      }
      ensureActivityListFilters(state, scope).visibleCount = 200;
      rerender();
    });
  });
  panel.querySelector('[data-activities-advanced-reset]')?.addEventListener('click', () => {
    const filters = ensureActivityListFilters(state, scope);
    ADVANCED_ACTIVITY_FILTER_KEYS.forEach((key) => { filters[key] = ''; });
    filters.visibleCount = 200;
    state.activitiesInstructorStatusFilter = 'all';
    state.allActivitiesStatusFilter = 'all';
    rerender();
  });

  root._activitiesAdvancedAbort?.abort();
  root._activitiesAdvancedAbort = new AbortController();
  const signal = root._activitiesAdvancedAbort.signal;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.activitiesAdvancedFiltersOpen) {
      toggle(false);
      button.focus();
    }
  }, { signal });
}

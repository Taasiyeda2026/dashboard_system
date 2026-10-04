import { supabase } from './api/client.js';

const COURSE_REPORT_TYPE = 'קורס';
const COURSE_DB_TYPES = new Set(['course', 'קורס']);
const ACTIVITY_TRIGGER_ID = 'av2-activity-name-trigger';
const ACTIVITY_TYPE_ID = 'av2-activity-type';
const REPORT_DATE_ID = 'av2-report-date';

let bypassNextTriggerClick = false;
let loadToken = 0;

function text(value) {
  return String(value ?? '').trim();
}

function normalizeType(value) {
  return text(value).toLowerCase();
}

function classLabel(row = {}) {
  const grade = text(row.grade);
  const group = text(row.class_group);
  if (group && grade && !group.includes(grade)) return `${grade} / ${group}`;
  return group || grade;
}

function timeLabel(row = {}) {
  const start = text(row.start_time).slice(0, 5);
  const end = text(row.end_time).slice(0, 5);
  return start && end ? `${start}–${end}` : '';
}

function locationLabel(row = {}) {
  const school = text(row.single_school_name || row.school);
  const authority = text(row.authority_name || row.authority);
  return [school, authority].filter(Boolean).join(' · ');
}

function rowName(row = {}) {
  return text(row.activity_name || row.program_name);
}

function buildDashboardCourseOptions(rows = []) {
  const courses = (Array.isArray(rows) ? rows : []).filter((row) =>
    COURSE_DB_TYPES.has(normalizeType(row?.activity_type)),
  );

  const duplicateKeyCount = new Map();
  for (const row of courses) {
    const key = `${rowName(row)}|${text(row.single_school_id || row.single_school_name || row.school)}`;
    duplicateKeyCount.set(key, (duplicateKeyCount.get(key) || 0) + 1);
  }

  return courses
    .map((row) => {
      const value = text(row.row_id || row.id);
      const label = rowName(row);
      if (!value || !label) return null;

      const key = `${label}|${text(row.single_school_id || row.single_school_name || row.school)}`;
      const ambiguousAtSchool = (duplicateKeyCount.get(key) || 0) > 1;
      const details = [];
      const cls = classLabel(row);
      const time = timeLabel(row);
      const location = locationLabel(row);

      // Do not add another form field. Only when the dashboard contains more than
      // one same-name course at the same school do we expose the class/time inside
      // the existing activity picker so the exact dashboard row can be selected.
      if (ambiguousAtSchool && cls) details.push(`כיתה ${cls}`);
      if (ambiguousAtSchool && time) details.push(time);
      if (location) details.push(location);

      return {
        value,
        label,
        meta: details.join(' · '),
        searchText: [label, cls, time, location].filter(Boolean).join(' ').toLowerCase(),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.label.localeCompare(b.label, 'he') || a.meta.localeCompare(b.meta, 'he'));
}

function courseContext() {
  const type = document.getElementById(ACTIVITY_TYPE_ID)?.value || '';
  const date = document.getElementById(REPORT_DATE_ID)?.value || '';
  const trigger = document.getElementById(ACTIVITY_TRIGGER_ID);
  const wrap = trigger?.closest('.av2-ssel');
  return { type, date, trigger, wrap };
}

function invalidateDashboardChoices({ clearSelectedCourse = false } = {}) {
  const { type, wrap } = courseContext();
  if (!wrap) return;
  delete wrap.dataset.av2DashboardCourseChoicesKey;
  if (clearSelectedCourse && type === COURSE_REPORT_TYPE) {
    wrap.dispatchEvent(new CustomEvent('av2:set-options', {
      detail: { options: [], notifyOnReset: true },
    }));
  }
}

async function loadDashboardCourseOptions(date) {
  const token = ++loadToken;
  const { data, error } = await supabase.rpc('av2_get_current_instructor_activity_choices_for_date', {
    p_date: date,
  });
  if (token !== loadToken) return null;
  if (error) throw error;
  return buildDashboardCourseOptions(Array.isArray(data) ? data : []);
}

async function prepareCoursePicker(trigger, wrap, date) {
  const key = `${date}|${COURSE_REPORT_TYPE}`;
  if (wrap.dataset.av2DashboardCourseChoicesKey === key) return true;

  const wasDisabled = trigger.disabled;
  trigger.disabled = true;
  try {
    const options = await loadDashboardCourseOptions(date);
    if (!options) return false;
    wrap.dispatchEvent(new CustomEvent('av2:set-options', {
      detail: { options, notifyOnReset: true },
    }));
    wrap.dataset.av2DashboardCourseChoicesKey = key;
    return true;
  } catch (error) {
    console.warn('dashboard course choice load failed:', error?.message || error);
    return false;
  } finally {
    trigger.disabled = wasDisabled;
  }
}

document.addEventListener('click', async (event) => {
  const trigger = event.target?.closest?.(`#${ACTIVITY_TRIGGER_ID}`);
  if (!trigger || bypassNextTriggerClick) return;

  const { type, date, wrap } = courseContext();
  if (type !== COURSE_REPORT_TYPE || !date || !wrap) return;

  const key = `${date}|${COURSE_REPORT_TYPE}`;
  if (wrap.dataset.av2DashboardCourseChoicesKey === key) return;

  // The searchable select would otherwise open immediately with all historical
  // assignments. Hold this one click, load the dashboard rows for the report date,
  // then reopen the same control with the exact date-specific rows.
  event.preventDefault();
  event.stopImmediatePropagation();

  const ready = await prepareCoursePicker(trigger, wrap, date);
  if (!ready || trigger.disabled) return;

  bypassNextTriggerClick = true;
  try {
    trigger.click();
  } finally {
    bypassNextTriggerClick = false;
  }
}, true);

document.addEventListener('change', (event) => {
  const id = event.target?.id;
  if (id === ACTIVITY_TYPE_ID) {
    invalidateDashboardChoices();
    return;
  }
  if (id === REPORT_DATE_ID) {
    // A changed date can point to another class/group even when the course name is
    // identical. Clear only the selected course; the instructor reuses the same
    // activity field and never gets an extra class field.
    invalidateDashboardChoices({ clearSelectedCourse: true });
  }
}, true);

const observer = new MutationObserver(() => {
  const { wrap } = courseContext();
  if (!wrap) return;
  if (!wrap.dataset.av2DashboardChoiceObserved) {
    wrap.dataset.av2DashboardChoiceObserved = '1';
    delete wrap.dataset.av2DashboardCourseChoicesKey;
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

export { buildDashboardCourseOptions };

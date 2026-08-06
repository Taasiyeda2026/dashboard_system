import { supabase } from '../supabase-client.js';
import { resolveCourseForActivity, trainingCellState } from './shared/operations-2027-domain.js';

const SCHOOL_2027 = 'school_2027';
const COURSE_TABLE = 'proposal_gefen_courses';
const ACTIVITY_TABLE = 'activities';
const COURSE_TRAINING_TAB = 'course_training_matrix';
const PRINT_KITS_TAB = 'course_print_kits';

let observer = null;
let queued = false;
let assignmentPromise = null;
let assignmentLoadedAt = 0;
const ASSIGNMENT_TTL_MS = 30 * 1000;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return cleanText(value)
    .replace(/[״"]/g, '')
    .replace(/[׳']/g, '')
    .replace(/[\u200e\u200f]/g, '')
    .toLowerCase();
}

function pairKey(courseId, instructorName) {
  return `${String(courseId || '')}::${normalize(instructorName)}`;
}

function activityInstructorNames(row) {
  return Array.from(new Set([
    row?.instructor_name,
    row?.instructorName,
    row?.instructor,
    row?.guide_name,
    row?.guide,
    row?.instructor_name_2,
    row?.instructor_2,
    row?.guide_name_2,
    row?.guide_2
  ].map(cleanText).filter(Boolean)));
}

function isInactiveActivity(row) {
  const status = cleanText(row?.status).toLowerCase();
  return Boolean(row?.deleted_at || row?.is_deleted === true || row?.cancelled_at || row?.is_cancelled === true)
    || ['נמחק', 'מחוק', 'בוטל', 'מבוטל', 'deleted', 'cancelled', 'canceled'].includes(status);
}

export function buildCourseTrainingAssignedPairs(activities = [], courses = []) {
  const assignedPairs = new Set();
  activities.forEach((row) => {
    if (isInactiveActivity(row)) return;
    const instructorNames = activityInstructorNames(row);
    if (!instructorNames.length) return;
    const course = resolveCourseForActivity(row, courses);
    if (!course) return;
    instructorNames.forEach((name) => assignedPairs.add(pairKey(course.id, name)));
  });
  return assignedPairs;
}

function operationsRoot() {
  return document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"], .ds-ops-mgmt-screen.ops-year-2027');
}

function activeCustomTab(root = operationsRoot()) {
  return root
    ?.querySelector?.('.ds-ops-mgmt-tab.is-active[data-ops-custom-tab]')
    ?.dataset?.opsCustomTab || '';
}

function ensureStyle() {
  if (document.getElementById('ops-2027-training-assignment-fix-style')) return;
  const style = document.createElement('style');
  style.id = 'ops-2027-training-assignment-fix-style';
  style.textContent = `
    .ds-ops-mgmt-screen .ops2027-cell-button.is-empty {
      color: transparent !important;
      background: transparent !important;
      box-shadow: none !important;
    }
  `;
  document.head.appendChild(style);
}

async function loadAssignedPairs({ force = false } = {}) {
  const now = Date.now();
  if (!force && assignmentPromise && (now - assignmentLoadedAt) < ASSIGNMENT_TTL_MS) return assignmentPromise;

  assignmentLoadedAt = now;
  assignmentPromise = Promise.all([
    supabase
      .from(COURSE_TABLE)
      .select('id, short_name, full_name, gefen_number')
      .eq('is_active', true),
    supabase
      .from(ACTIVITY_TABLE)
      .select('*')
      .eq('activity_season', SCHOOL_2027)
      .eq('activity_type', 'course')
  ]).then(([coursesResult, activitiesResult]) => {
    if (coursesResult.error) throw coursesResult.error;
    if (activitiesResult.error) throw activitiesResult.error;

    return buildCourseTrainingAssignedPairs(activitiesResult.data || [], coursesResult.data || []);
  }).catch((error) => {
    assignmentPromise = null;
    throw error;
  });

  return assignmentPromise;
}

function setTrainingVisual(button, { trained, assigned }) {
  const cell = trainingCellState({ trained, assigned });
  const wantedClass = cell.state === 'trained' ? 'is-yes' : (cell.state === 'assigned_untrained' ? 'is-no' : 'is-empty');
  const wantedLabel = cell.state === 'trained'
    ? 'עבר הכשרה'
    : (cell.state === 'assigned_untrained' ? 'משובץ וטרם עבר הכשרה' : 'לא משובץ ולא עבר הכשרה');

  ['is-yes', 'is-no', 'is-empty'].forEach((className) => {
    button.classList.toggle(className, className === wantedClass);
  });
  if (button.textContent !== cell.text) button.textContent = cell.text;
  if (button.getAttribute('aria-label') !== wantedLabel) button.setAttribute('aria-label', wantedLabel);
  button.dataset.assigned = assigned ? '1' : '0';
  if (cell.state === 'empty') button.title = 'לא משובץ - לחיצה לסימון הכשרה';
  else button.removeAttribute('title');
}

async function fixCourseTraining(root) {
  const view = root.querySelector(`[data-ops-history-fix="${COURSE_TRAINING_TAB}"]`);
  if (!view) return;

  view.querySelectorAll('.ops2027-history-note').forEach((note) => note.remove());
  const buttons = Array.from(view.querySelectorAll('[data-history-training-toggle], [data-course-training-toggle]'));
  if (!buttons.length) return;

  const assignedPairs = await loadAssignedPairs();
  buttons.forEach((button) => {
    const trained = button.dataset.trained === '1';
    const assigned = assignedPairs.has(pairKey(button.dataset.courseId, button.dataset.instructor));
    setTrainingVisual(button, { trained, assigned });
  });
}

function removeDuplicatePrintKitTitle(root) {
  const view = root.querySelector(`[data-ops-history-fix="${PRINT_KITS_TAB}"]`);
  if (!view) return;
  const header = view.querySelector(':scope > .ops2027-header');
  const pageTitle = cleanText(header?.textContent);
  if (!header || !pageTitle) return;
  const duplicateAttachedTitle = Array.from(view.querySelectorAll('.ops2027-attached-title'))
    .some((title) => normalize(title.textContent) === normalize(pageTitle));
  if (duplicateAttachedTitle) header.remove();
}

async function fixUi() {
  const root = operationsRoot();
  if (!root) return;
  ensureStyle();

  const tab = activeCustomTab(root);
  if (tab === COURSE_TRAINING_TAB) await fixCourseTraining(root);
  if (tab === PRINT_KITS_TAB) removeDuplicatePrintKitTitle(root);
}

function queueFix(delay = 0) {
  if (queued) return;
  queued = true;
  window.setTimeout(() => {
    queued = false;
    fixUi().catch((error) => console.warn('[operations-2027-training-assignment-fix]', error?.message || error));
  }, delay);
}

function observeOperations() {
  const app = document.getElementById('app');
  if (!app || typeof MutationObserver !== 'function') return;
  observer?.disconnect?.();
  observer = new MutationObserver(() => queueFix());
  observer.observe(app, { childList: true, subtree: true });
}

if (typeof document !== 'undefined') {
  ensureStyle();
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('[data-ops-custom-tab], [data-history-training-toggle], [data-course-training-toggle]')) {
      queueFix(0);
      window.setTimeout(() => queueFix(0), 250);
      window.setTimeout(() => queueFix(0), 700);
    }
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      queueFix();
      observeOperations();
    }, { once: true });
  } else {
    queueFix();
    observeOperations();
  }
}

export { loadAssignedPairs, setTrainingVisual, removeDuplicatePrintKitTitle };

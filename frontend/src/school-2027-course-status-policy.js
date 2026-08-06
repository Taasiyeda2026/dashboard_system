const SCHOOL_2027_VALUES = new Set(['school_2027', '2027', 'תשפז', 'תשפ״ז', 'תשפ"ז']);
const COURSE_TYPE_VALUES = new Set(['course', 'program', 'קורס', 'תוכנית']);
const CLOSED_STATUS_VALUES = new Set(['closed', 'סגור']);
const STATUS_OPTIONS = Object.freeze([
  { value: 'פתוח', label: 'פתוח' },
  { value: 'סגור', label: 'סגור' }
]);

function normalized(value) {
  return String(value ?? '').trim().toLocaleLowerCase('he-IL');
}

export function isSchool2027CourseStatusContext({ season, activityType } = {}) {
  return SCHOOL_2027_VALUES.has(normalized(season))
    && COURSE_TYPE_VALUES.has(normalized(activityType));
}

export function normalizeSchool2027CourseStatus(value) {
  return CLOSED_STATUS_VALUES.has(normalized(value)) ? 'סגור' : 'פתוח';
}

function findActivityContext(element) {
  let node = element?.parentElement || null;
  while (node && node !== document.body) {
    const season = node.querySelector?.('[name="activity_season"]');
    const activityType = node.querySelector?.('[name="activity_type"], [name="item_type"]');
    if (season && activityType) return node;
    node = node.parentElement;
  }
  return null;
}

function optionState(select) {
  return [...(select?.options || [])].map((option) => ({
    value: String(option.value || '').trim(),
    label: String(option.textContent || '').trim()
  }));
}

function optionsAlreadyCorrect(select) {
  const current = optionState(select);
  return current.length === STATUS_OPTIONS.length
    && current.every((option, index) => (
      option.value === STATUS_OPTIONS[index].value
      && option.label === STATUS_OPTIONS[index].label
    ));
}

export function enforceSchool2027CourseStatusSelect(select) {
  if (!select || select.name !== 'status') return false;
  const context = findActivityContext(select);
  if (!context) return false;

  const season = context.querySelector('[name="activity_season"]')?.value;
  const activityType = context.querySelector('[name="activity_type"], [name="item_type"]')?.value;
  if (!isSchool2027CourseStatusContext({ season, activityType })) return false;

  const nextValue = normalizeSchool2027CourseStatus(select.value);
  if (!optionsAlreadyCorrect(select)) {
    select.replaceChildren(...STATUS_OPTIONS.map(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    }));
  }
  select.value = nextValue;

  const badge = context.querySelector('.activity-drawer__meta-tag--status');
  if (badge && String(badge.textContent || '').trim() === 'הסתיים') {
    badge.textContent = 'סגור';
  }
  return true;
}

export function applySchool2027CourseStatusPolicy(root = document) {
  if (!root?.querySelectorAll) return 0;
  const selects = [];
  if (root.matches?.('select[name="status"]')) selects.push(root);
  selects.push(...root.querySelectorAll('select[name="status"]'));
  return selects.reduce((count, select) => (
    enforceSchool2027CourseStatusSelect(select) ? count + 1 : count
  ), 0);
}

function nearestActivityContext(element) {
  let node = element?.parentElement || null;
  while (node && node !== document.body) {
    if (node.querySelector?.('select[name="status"]')) return node;
    node = node.parentElement;
  }
  return document;
}

function installPolicy() {
  const appRoot = document.getElementById('app') || document.documentElement;
  applySchool2027CourseStatusPolicy(appRoot);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          applySchool2027CourseStatusPolicy(node);
        }
      }
    }
  });
  observer.observe(appRoot, { childList: true, subtree: true });

  document.addEventListener('change', (event) => {
    const name = event.target?.name;
    if (name !== 'activity_season' && name !== 'activity_type' && name !== 'item_type') return;
    queueMicrotask(() => applySchool2027CourseStatusPolicy(nearestActivityContext(event.target)));
  }, true);

  document.addEventListener('submit', (event) => {
    applySchool2027CourseStatusPolicy(event.target);
  }, true);
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPolicy, { once: true });
  } else {
    installPolicy();
  }
}

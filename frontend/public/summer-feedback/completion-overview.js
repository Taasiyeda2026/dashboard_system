const FORM_SELECTOR = '#feedbackForm';
const COMPLETE_CLASS = 'is-complete';
const TEST_MODE_FLAG = '__SUMMER_FEEDBACK_COMPLETION_TEST__';

function nextFrame(callback) {
  const schedule = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
  schedule(callback);
}

function afterExistingRestore(callback) {
  nextFrame(() => nextFrame(() => nextFrame(callback)));
}

function setCompletionBadge(badge, completed, total) {
  if (!badge || !Number.isFinite(total) || total <= 0) return;

  const isComplete = completed === total;
  const nextText = `${completed}/${total}`;
  const nextAriaLabel = isComplete
    ? `הסעיף הושלם: ${completed} מתוך ${total}`
    : `הושלמו ${completed} מתוך ${total}`;
  const nextTitle = isComplete
    ? 'הסעיף הושלם'
    : `נותרו ${Math.max(0, total - completed)} למילוי`;

  if (badge.textContent !== nextText) badge.textContent = nextText;
  if (badge.classList.contains(COMPLETE_CLASS) !== isComplete) {
    badge.classList.toggle(COMPLETE_CLASS, isComplete);
  }
  if (badge.getAttribute('aria-label') !== nextAriaLabel) {
    badge.setAttribute('aria-label', nextAriaLabel);
  }
  if (badge.title !== nextTitle) badge.title = nextTitle;
}

function activityCompletion(activity) {
  const metricFields = [...activity.querySelectorAll('.metric-grid select')];
  const completedMetrics = metricFields.filter(
    field => Boolean(String(field.value || '').trim())
  ).length;

  const experienceGroup = activity.querySelector('.activity-experience');
  const hasExperience = Boolean(
    experienceGroup?.querySelector('[data-experience]:checked')
  );

  return {
    completed: completedMetrics + (experienceGroup && hasExperience ? 1 : 0),
    total: metricFields.length + (experienceGroup ? 1 : 0)
  };
}

export function updateCompletionIndicators(root = document) {
  root.querySelectorAll?.('.feedback-group').forEach(group => {
    const fields = [...group.querySelectorAll('.question select')];
    const completed = fields.filter(
      field => Boolean(String(field.value || '').trim())
    ).length;

    setCompletionBadge(
      group.querySelector('summary b'),
      completed,
      fields.length
    );
  });

  root.querySelectorAll?.('.activity').forEach(activity => {
    const { completed, total } = activityCompletion(activity);
    setCompletionBadge(
      activity.querySelector('summary b'),
      completed,
      total
    );
  });
}

export function closeSectionsByDefault(form) {
  if (!form || form.dataset.defaultSectionsClosed === 'true') return;
  form.dataset.defaultSectionsClosed = 'true';

  // questionnaire-refinements may restore the previous open/closed state after two frames.
  // Closing after three frames guarantees that every new visit starts with a compact overview.
  afterExistingRestore(() => {
    if (!form.isConnected) return;

    form.querySelectorAll('details[open]').forEach(details => {
      details.open = false;
    });

    updateCompletionIndicators(form);
  });
}

export function initializeCompletionOverview(root = document) {
  const form = root.querySelector?.(FORM_SELECTOR);
  if (!form) return;

  closeSectionsByDefault(form);
  updateCompletionIndicators(form);
}

let scheduled = false;
function scheduleUpdate() {
  if (scheduled) return;
  scheduled = true;

  nextFrame(() => {
    scheduled = false;
    initializeCompletionOverview(document);
  });
}

if (typeof document !== 'undefined' && globalThis[TEST_MODE_FLAG] !== true) {
  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  document.addEventListener('input', scheduleUpdate, true);
  document.addEventListener('change', scheduleUpdate, true);
  initializeCompletionOverview(document);
}

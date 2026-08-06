const BRAND_LOGO_SRC = '../catalog/summercatalog/logo.png';
const RESUME_STORAGE_PREFIX = 'summer-feedback-resume-v4';
const REQUIRED_SUMMARY_KEYS = [
  'preserve_activities',
  'improve_activities',
  'preserve_support',
  'improve_support',
  'training_needed'
];

function addAnswerRow(container, select, compact = false) {
  if (!container || !select || select.closest('.answer-row')) return;

  const row = document.createElement('div');
  row.className = `answer-row${compact ? ' compact' : ''}`;

  const caption = document.createElement('span');
  caption.className = 'answer-label';
  caption.textContent = 'דירוג';

  select.before(row);
  row.append(caption, select);
}

function refineQuestionLayout() {
  document.querySelectorAll('.question select').forEach(select => {
    addAnswerRow(select.closest('.question'), select);
  });

  document.querySelectorAll('.metric-grid label').forEach(label => {
    const select = label.querySelector('select');
    addAnswerRow(label, select, true);
  });
}

function applyBranding() {
  const brand = document.querySelector('.brand');
  if (!brand || brand.dataset.logoApplied === 'true') return;

  const logo = document.createElement('img');
  logo.className = 'brand-logo';
  logo.src = BRAND_LOGO_SRC;
  logo.alt = 'לוגו תעשיידע';
  logo.decoding = 'async';

  const subtitle = document.createElement('small');
  subtitle.className = 'brand-subtitle';
  subtitle.textContent = 'משוב פעילות הקיץ';

  brand.replaceChildren(logo, subtitle);
  brand.dataset.logoApplied = 'true';
}

function removeStatementLabels() {
  document.querySelectorAll('.feedback-group > summary small').forEach(label => {
    label.hidden = true;
    label.setAttribute('aria-hidden', 'true');
  });
}

function styleActionButtons() {
  const saveButton = document.querySelector('#saveNow');
  if (saveButton && saveButton.textContent !== 'שמירה והמשך מאוחר יותר') {
    saveButton.textContent = 'שמירה והמשך מאוחר יותר';
    saveButton.setAttribute(
      'aria-label',
      'שמירת טיוטה והמשך במועד מאוחר יותר'
    );
  }

  const submitButton = document.querySelector(
    '#feedbackForm button[type="submit"]'
  );
  if (
    submitButton
    && !submitButton.disabled
    && submitButton.textContent !== 'סיום והגשת המשוב'
  ) {
    submitButton.textContent = 'סיום והגשת המשוב';
  }
}

function updateVisibleProgress() {
  const form = document.querySelector('#feedbackForm');
  if (!form) return;

  const general = [...form.querySelectorAll('.question select')];
  const metrics = [...form.querySelectorAll('.metric-grid select')];
  const experiences = [...form.querySelectorAll('.activity-experience')]
    .map(group => group.querySelector('[data-experience]:checked'));
  const requiredSummary = REQUIRED_SUMMARY_KEYS
    .map(key => form.querySelector(`[data-summary="${key}"]`))
    .filter(Boolean);

  const total = general.length
    + metrics.length
    + experiences.length
    + requiredSummary.length;

  if (!total) return;

  const completed = general.filter(field => Boolean(field.value)).length
    + metrics.filter(field => Boolean(field.value)).length
    + experiences.filter(Boolean).length
    + requiredSummary.filter(field => Boolean(field.value.trim())).length;

  const percent = Math.round((completed / total) * 100);
  const text = document.querySelector('#progressText');
  const bar = document.querySelector('#progressBar');

  if (text && text.textContent !== `${percent}%`) {
    text.textContent = `${percent}%`;
  }
  if (bar && bar.style.width !== `${percent}%`) {
    bar.style.width = `${percent}%`;
  }
}

function resumeIdentity() {
  const label = document.querySelector('.head-actions small')?.textContent?.trim();
  const hero = document.querySelector('.hero p')?.textContent?.trim();
  const identity = label || hero || 'feedback';
  return `${RESUME_STORAGE_PREFIX}:${location.pathname}:${identity}`;
}

function readResumeState(key) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function writeResumeState(form) {
  const key = form?.dataset.resumeKey;
  if (!form || !key) return;

  const details = [...form.querySelectorAll('details')].map(item => item.open);

  try {
    localStorage.setItem(key, JSON.stringify({
      scrollY: Math.max(0, Math.round(window.scrollY)),
      details,
      updatedAt: Date.now()
    }));
  } catch {
    // Browsers may block storage; answers still save to Supabase.
  }
}

function clearResumeState(form) {
  const key = form?.dataset.resumeKey || resumeIdentity();
  try {
    localStorage.removeItem(key);
  } catch {
    // No-op when storage is unavailable.
  }
}

function restoreResumeState(form) {
  const savedState = readResumeState(form.dataset.resumeKey);
  if (!savedState) return;

  const details = [...form.querySelectorAll('details')];
  if (Array.isArray(savedState.details)) {
    details.forEach((item, index) => {
      if (typeof savedState.details[index] === 'boolean') {
        item.open = savedState.details[index];
      }
    });
  }

  const maxScroll = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight
  );
  const scrollY = Math.min(
    Math.max(0, Number(savedState.scrollY) || 0),
    maxScroll
  );

  window.scrollTo({ top: scrollY, behavior: 'auto' });
}

function setupDraftResume() {
  const form = document.querySelector('#feedbackForm');
  if (!form || form.dataset.resumeBound === 'true') return;

  form.dataset.resumeBound = 'true';
  form.dataset.resumeKey = resumeIdentity();

  const submitted = document.querySelector('.status .badge.submitted');
  if (submitted) {
    clearResumeState(form);
    return;
  }

  form.querySelectorAll('details').forEach(item => {
    item.addEventListener('toggle', () => writeResumeState(form));
  });
  form.addEventListener('input', () => writeResumeState(form), {
    passive: true
  });
  form.addEventListener('change', () => writeResumeState(form), {
    passive: true
  });

  form.querySelector('#saveNow')?.addEventListener(
    'click',
    () => writeResumeState(form)
  );

  requestAnimationFrame(() => {
    requestAnimationFrame(() => restoreResumeState(form));
  });
}

function persistCurrentPosition() {
  const form = document.querySelector('#feedbackForm');
  if (form) writeResumeState(form);
}

function applyRefinements() {
  applyBranding();
  removeStatementLabels();
  refineQuestionLayout();
  styleActionButtons();
  setupDraftResume();
  updateVisibleProgress();
}

let scheduled = false;
function scheduleRefinements() {
  if (scheduled) return;
  scheduled = true;

  requestAnimationFrame(() => {
    scheduled = false;
    applyRefinements();
  });
}

let scrollTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(persistCurrentPosition, 160);
}, { passive: true });

window.addEventListener('pagehide', persistCurrentPosition);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') persistCurrentPosition();
});
document.addEventListener('input', scheduleRefinements, true);
document.addEventListener('change', scheduleRefinements, true);

const observer = new MutationObserver(scheduleRefinements);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

scheduleRefinements();

const MANAGEMENT_MERGES = [
  {
    source: 'management_presence',
    hidden: ['management_contact_clarity'],
    label: 'ניהול הפעילות היה זמין ונוכח, והיה ברור למי לפנות בעת הצורך'
  },
  {
    source: 'daily_resources_check',
    hidden: ['daily_readiness_check'],
    label: 'לפני כל יום פעילות וידאו שיש ברשותי המידע, הציוד והחומרים ושאני ערוך/ה להדרכה'
  },
  {
    source: 'management_communication',
    hidden: ['ongoing_contact'],
    label: 'התקיים איתי קשר שוטף, ברור ומכבד לאורך הפעילות'
  }
];

const MANAGEMENT_VISIBLE_KEYS = [
  'management_presence',
  'daily_resources_check',
  'management_communication',
  'issue_resolution',
  'post_activity_followup',
  'support_response'
];

const BRAND_LOGO_SRC = '../catalog/summercatalog/logo.png';
const RESUME_STORAGE_PREFIX = 'summer-feedback-resume-v2';

function questionLabel(select) {
  return select?.closest('.question')?.querySelector(':scope > span:not(.answer-label)');
}

function addAnswerRow(label, select) {
  if (!label || !select || select.closest('.answer-row')) return;
  const row = document.createElement('div');
  row.className = 'answer-row';
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
    if (!select || select.closest('.answer-row')) return;
    const row = document.createElement('div');
    row.className = 'answer-row compact';
    const caption = document.createElement('span');
    caption.className = 'answer-label';
    caption.textContent = 'דירוג';
    select.before(row);
    row.append(caption, select);
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
    saveButton.setAttribute('aria-label', 'שמירת טיוטה והמשך במועד מאוחר יותר');
  }

  const submitButton = document.querySelector('#feedbackForm button[type="submit"]');
  if (submitButton && !submitButton.disabled && submitButton.textContent !== 'סיום והגשת המשוב') {
    submitButton.textContent = 'סיום והגשת המשוב';
  }
}

function syncMergedSelect(source, targets) {
  for (const target of targets) {
    if (!target || target.value === source.value) continue;
    target.value = source.value;
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function updateManagementBadge() {
  const group = [...document.querySelectorAll('.feedback-group')]
    .find(item => item.querySelector('summary strong')?.textContent.includes('ניהול הפעילות'));
  if (!group) return;

  const completed = MANAGEMENT_VISIBLE_KEYS.filter(key => {
    const select = document.querySelector(`[name="general_${key}"]`);
    return Boolean(select?.value);
  }).length;

  const badge = group.querySelector('summary b');
  if (badge && badge.textContent !== `${completed}/6`) badge.textContent = `${completed}/6`;
}

function updateVisibleProgress() {
  const form = document.querySelector('#feedbackForm');
  if (!form) return;

  const general = [...form.querySelectorAll('.question:not(.merged-question-hidden) select')];
  const activities = [...form.querySelectorAll('.metric-grid select')];
  const requiredSummary = ['preserve', 'improve']
    .map(key => form.querySelector(`[data-summary="${key}"]`))
    .filter(Boolean);
  const fields = [...general, ...activities, ...requiredSummary];
  if (!fields.length) return;

  const completed = fields.filter(field => Boolean(field.value?.trim())).length;
  const percent = Math.round((completed / fields.length) * 100);
  const text = document.querySelector('#progressText');
  const bar = document.querySelector('#progressBar');
  if (text && text.textContent !== `${percent}%`) text.textContent = `${percent}%`;
  if (bar && bar.style.width !== `${percent}%`) bar.style.width = `${percent}%`;
}

function mergeManagementQuestions() {
  for (const item of MANAGEMENT_MERGES) {
    const source = document.querySelector(`[name="general_${item.source}"]`);
    if (!source) continue;

    const label = questionLabel(source);
    if (label) label.textContent = item.label;

    const targets = item.hidden
      .map(key => document.querySelector(`[name="general_${key}"]`))
      .filter(Boolean);

    for (const target of targets) {
      target.closest('.question')?.classList.add('merged-question-hidden');
    }

    if (source.dataset.mergeBound !== 'true') {
      source.dataset.mergeBound = 'true';
      source.addEventListener('change', () => {
        syncMergedSelect(source, targets);
        requestAnimationFrame(() => {
          updateManagementBadge();
          updateVisibleProgress();
        });
      });
    }

    syncMergedSelect(source, targets);
  }

  updateManagementBadge();
}

function removeDuplicateActivityPrompts() {
  document.querySelectorAll('.highlights, .detail-box').forEach(element => {
    element.setAttribute('hidden', '');
    element.setAttribute('aria-hidden', 'true');
  });
}

function hideLegacyAnalysisColumns() {
  document.querySelectorAll('.panel table').forEach(table => {
    const headers = [...table.querySelectorAll('thead th')];
    const indexes = headers
      .map((header, index) => ({ index, text: header.textContent.trim() }))
      .filter(item => item.text === 'לשיפור' || item.text === 'בולטת')
      .map(item => item.index);

    if (!indexes.length) return;
    for (const row of table.rows) {
      indexes.forEach(index => row.cells[index]?.classList.add('legacy-analysis-hidden'));
    }
  });
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
    // Browsers may block storage in strict privacy mode; draft answers still save to Supabase.
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
  const state = readResumeState(form.dataset.resumeKey);
  if (!state) return;

  const details = [...form.querySelectorAll('details')];
  if (Array.isArray(state.details)) {
    details.forEach((item, index) => {
      if (typeof state.details[index] === 'boolean') item.open = state.details[index];
    });
  }

  const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const scrollY = Math.min(Math.max(0, Number(state.scrollY) || 0), maxScroll);
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
  form.addEventListener('input', () => writeResumeState(form), { passive: true });
  form.addEventListener('change', () => writeResumeState(form), { passive: true });

  const saveButton = form.querySelector('#saveNow');
  saveButton?.addEventListener('click', () => writeResumeState(form));

  requestAnimationFrame(() => requestAnimationFrame(() => restoreResumeState(form)));
}

function persistCurrentPosition() {
  const form = document.querySelector('#feedbackForm');
  if (form) writeResumeState(form);
}

function requestDraftSaveWhenLeaving() {
  persistCurrentPosition();
  const saveButton = document.querySelector('#saveNow');
  if (saveButton && !saveButton.disabled) saveButton.click();
}

function applyRefinements() {
  applyBranding();
  removeStatementLabels();
  refineQuestionLayout();
  mergeManagementQuestions();
  removeDuplicateActivityPrompts();
  hideLegacyAnalysisColumns();
  styleActionButtons();
  setupDraftResume();
  updateVisibleProgress();
}

let scheduled = false;
const scheduleRefinements = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    applyRefinements();
  });
};

let scrollTimer = null;
window.addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(persistCurrentPosition, 160);
}, { passive: true });

window.addEventListener('pagehide', persistCurrentPosition);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') requestDraftSaveWhenLeaving();
});

const observer = new MutationObserver(scheduleRefinements);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
document.addEventListener('input', scheduleRefinements, true);
document.addEventListener('change', scheduleRefinements, true);
applyRefinements();

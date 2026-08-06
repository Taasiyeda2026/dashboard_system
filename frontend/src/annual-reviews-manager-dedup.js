const MANAGER_SECTION_SELECTOR = '#ar2-manager-section';
const MANAGER_FORM_SELECTOR = ':scope > form.ar2-manager-question-set';

function deduplicateManagerForms(root = document) {
  const sections = root.matches?.(MANAGER_SECTION_SELECTOR)
    ? [root]
    : [...root.querySelectorAll?.(MANAGER_SECTION_SELECTOR) || []];

  sections.forEach((section) => {
    const forms = [...section.querySelectorAll(MANAGER_FORM_SELECTOR)];
    if (forms.length <= 1) return;

    const canonical = forms[0];
    forms.slice(1).forEach((form) => form.remove());
    canonical.dataset.managerQuestionSetCanonical = 'true';
  });
}

let scheduled = false;
function scheduleDeduplication() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    deduplicateManagerForms(document);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', scheduleDeduplication, { once: true });
} else {
  scheduleDeduplication();
}

new MutationObserver(scheduleDeduplication).observe(document.documentElement, {
  childList: true,
  subtree: true
});

document.addEventListener('click', (event) => {
  if (event.target?.closest?.('[data-ar2-print]')) {
    deduplicateManagerForms(document);
  }
}, true);

export { deduplicateManagerForms };

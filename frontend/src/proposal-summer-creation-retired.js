const RETIRED_SUMMER_TYPE_KEYS = new Set([
  'summer',
  'קיץ',
  'קיץ תשפו',
  'פעילויות קיץ'
]);

function normalizeProposalTypeValue(value) {
  return String(value ?? '')
    .replace(/[״"׳'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isRetiredSummerProposalValue(value) {
  return RETIRED_SUMMER_TYPE_KEYS.has(normalizeProposalTypeValue(value));
}

function proposalTypeInput(form) {
  return form?.querySelector('[data-pa-type-hidden], input[name="activity_type_group"]') || null;
}

function proposalFormError(form) {
  return form?.querySelector('[data-pa-form-error]') || null;
}

function updateTypeGrid(cards) {
  if (!cards) return;
  const visibleTypeCount = cards.querySelectorAll('[data-pa-type-btn]').length;
  cards.style.gridTemplateColumns = `repeat(${Math.max(visibleTypeCount, 1)}, minmax(0, 1fr))`;
}

export function retireSummerProposalType(form, { explain = false } = {}) {
  if (!form?.matches?.('[data-pa-form][data-pa-mode="add"]')) return false;

  const cards = form.querySelector('[data-pa-type-cards]');
  cards?.querySelector('[data-pa-type-btn="summer"]')?.remove();
  updateTypeGrid(cards);

  const typeInput = proposalTypeInput(form);
  const summerWasSelected = isRetiredSummerProposalValue(typeInput?.value);
  if (!summerWasSelected) return false;

  typeInput.value = '';
  form.dataset.paOriginalType = '';
  typeInput.dispatchEvent(new Event('input', { bubbles: true }));
  typeInput.dispatchEvent(new Event('change', { bubbles: true }));

  if (explain) {
    const error = proposalFormError(form);
    if (error) error.textContent = 'הצעות קיץ חדשות אינן זמינות. יש לבחור סוג הצעה אחר.';
  }
  return true;
}

function scanForNewProposalForms(root = document) {
  if (!root?.querySelectorAll) return;
  if (root.matches?.('[data-pa-form][data-pa-mode="add"]')) {
    retireSummerProposalType(root, { explain: true });
  }
  root.querySelectorAll('[data-pa-form][data-pa-mode="add"]').forEach((form) => {
    retireSummerProposalType(form, { explain: true });
  });
}

function formFromEvent(event) {
  return event.target?.closest?.('[data-pa-form][data-pa-mode="add"]') || null;
}

function installSummerProposalCreationGuard() {
  scanForNewProposalForms(document);

  new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) scanForNewProposalForms(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    const form = formFromEvent(event);
    if (!form) return;

    if (event.target?.closest?.('[data-pa-type-btn="summer"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      retireSummerProposalType(form, { explain: true });
      return;
    }

    if (event.target?.closest?.('[data-pa-save-pending]') && isRetiredSummerProposalValue(proposalTypeInput(form)?.value)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      retireSummerProposalType(form, { explain: true });
      return;
    }

    queueMicrotask(() => retireSummerProposalType(form, { explain: true }));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = formFromEvent(event);
    if (!form || !isRetiredSummerProposalValue(proposalTypeInput(form)?.value)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    retireSummerProposalType(form, { explain: true });
  }, true);

  ['input', 'change'].forEach((eventName) => {
    document.addEventListener(eventName, (event) => {
      const form = formFromEvent(event);
      if (form) queueMicrotask(() => retireSummerProposalType(form, { explain: true }));
    }, true);
  });
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installSummerProposalCreationGuard, { once: true });
  } else {
    installSummerProposalCreationGuard();
  }
}

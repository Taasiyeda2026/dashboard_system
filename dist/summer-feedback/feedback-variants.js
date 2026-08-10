const DUAL_VARIANT_INSTRUCTORS = new Set(['הילה רוזן', 'אפרת אוחיון', 'כרמית סמנדרוב']);
const VARIANT_NAMES = new Set([
  'עולם הביומימיקרי הקסום (פיזי)',
  'עולם הביומימיקרי הקסום (דיגיטלי)'
]);

function currentInstructorName() {
  const headerLabel = document.querySelector('.head-actions small')?.textContent || '';
  const heroText = document.querySelector('.hero p')?.textContent || '';
  return [...DUAL_VARIANT_INSTRUCTORS].find(name => headerLabel.includes(name) || heroText.includes(name)) || '';
}

function cleanVariantCardCounts() {
  const name = currentInstructorName();
  if (!DUAL_VARIANT_INSTRUCTORS.has(name)) return;

  document.querySelectorAll('.activity').forEach(card => {
    const title = card.querySelector('summary strong')?.textContent?.trim();
    if (!VARIANT_NAMES.has(title)) return;

    const meta = card.querySelector('summary small');
    if (!meta || meta.dataset.variantCountHidden === 'true') return;

    const parts = meta.textContent.split('·').map(part => part.trim()).filter(Boolean);
    meta.textContent = parts.length > 1 ? parts.slice(1).join(' · ') : 'גרסה נפרדת למשוב';
    meta.dataset.variantCountHidden = 'true';
  });
}

function cleanAnalysisCounts() {
  document.querySelectorAll('.panel table tbody tr').forEach(row => {
    const title = row.querySelector('td strong')?.textContent?.trim();
    if (!VARIANT_NAMES.has(title)) return;

    const cells = row.querySelectorAll('td');
    if (cells[1] && cells[1].textContent.trim() !== '—') cells[1].textContent = '—';
  });
}

function applyVariantPresentation() {
  cleanVariantCardCounts();
  cleanAnalysisCounts();
}

const observer = new MutationObserver(applyVariantPresentation);
observer.observe(document.documentElement, { childList: true, subtree: true });
applyVariantPresentation();

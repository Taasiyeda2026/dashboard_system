const EDIT_RECORD_KEY = 'av2_edit_record_id';
const DUPLICATE_RECORD_KEY = 'av2_duplicate_record_id';

function clean(value) {
  return String(value ?? '').trim();
}

function getEditRecordId() {
  try {
    return clean(sessionStorage.getItem(EDIT_RECORD_KEY));
  } catch {
    return '';
  }
}

function setEditRecordId(recordId) {
  try {
    sessionStorage.setItem(EDIT_RECORD_KEY, clean(recordId));
    sessionStorage.removeItem(DUPLICATE_RECORD_KEY);
  } catch {}
}

function clearEditRecordId() {
  try {
    sessionStorage.removeItem(EDIT_RECORD_KEY);
  } catch {}
}

function isEditButton(target) {
  const button = target?.closest?.('button');
  if (!button) return null;
  const label = clean(button.getAttribute('aria-label') || button.title || button.textContent);
  if (label !== 'עריכה') return null;
  return button.closest('.av2-report-row') ? button : null;
}

function forwardEditToFullForm(event) {
  const editButton = isEditButton(event.target);
  if (!editButton) return;

  const row = editButton.closest('.av2-report-row');
  const recordId = clean(row?.dataset?.recordId);
  const duplicateButton = row?.querySelector('.av2-rr__action-dup');
  if (!recordId || !duplicateButton) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  setEditRecordId(recordId);
  duplicateButton.dataset.av2EditForward = '1';
  try {
    duplicateButton.click();
  } finally {
    delete duplicateButton.dataset.av2EditForward;
  }
}

function decorateEditForm() {
  const recordId = getEditRecordId();
  if (!recordId) return;

  const form = document.querySelector('.av2-report__form');
  if (!form || form.dataset.av2EditRecordId) return;

  form.dataset.av2EditRecordId = recordId;

  const title = document.querySelector('.av2-report__title');
  if (title) title.textContent = 'עריכת דיווח';

  const note = document.querySelector('.av2-report__dup-note');
  if (note) {
    note.textContent = 'עריכת דיווח — ניתן לעדכן את הנתונים הקיימים ולשמור את השינויים.';
  }

  const saveLabel = form.querySelector('button[type="submit"] span');
  if (saveLabel) saveLabel.textContent = 'שמירת שינויים';

  form.addEventListener('submit', () => {
    const label = form.querySelector('button[type="submit"] span');
    if (label && label.textContent === 'שמירת דיווח') label.textContent = 'שמירת שינויים';
  }, true);
}

function clearEditWhenLeaving(event) {
  if (!getEditRecordId()) return;
  const target = event.target?.closest?.('button,a');
  if (!target) return;

  if (target.closest('.av2-report__form')) return;

  const label = clean(target.getAttribute('aria-label') || target.title || target.textContent);
  const isBack = label === 'חזרה';
  const isFreshReport = label.includes('דיווח חדש') || label.includes('הוסף דיווח');
  const isReports = label.includes('הדיווחים שלי');
  const isHome = label === 'בית' || label.includes('בית');

  if (isBack || isFreshReport || isReports || isHome) clearEditRecordId();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', forwardEditToFullForm, true);
  document.addEventListener('click', clearEditWhenLeaving, true);

  const observer = new MutationObserver(() => decorateEditForm());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  decorateEditForm();
}

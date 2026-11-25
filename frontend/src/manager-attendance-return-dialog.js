/**
 * Accessible manager-only correction dialog.
 * Returns a trimmed reason, or null when the manager cancels.
 * No attendance mutation is performed in this module.
 */
export function requestAttendanceCorrectionReason({
  documentRef = document,
  employeeName = '',
  monthKey = ''
} = {}) {
  return new Promise((resolve) => {
    const dialog = documentRef.createElement('dialog');
    dialog.className = 'manager-attendance-return-dialog';
    dialog.setAttribute('dir', 'rtl');
    dialog.setAttribute('aria-labelledby', 'manager-attendance-return-title');

    const form = documentRef.createElement('form');
    form.noValidate = true;
    const title = documentRef.createElement('h3');
    title.id = 'manager-attendance-return-title';
    title.textContent = 'החזרת דוח לתיקון';
    const description = documentRef.createElement('p');
    description.textContent = `דוח ${monthKey} של ${employeeName} ייפתח לתיקון. המדריך יקבל את ההערה ויידרש להגיש את החודש מחדש.`;
    const label = documentRef.createElement('label');
    label.textContent = 'מה נדרש לתקן?';
    label.htmlFor = 'manager-attendance-return-reason';
    const textarea = documentRef.createElement('textarea');
    textarea.id = 'manager-attendance-return-reason';
    textarea.name = 'reason';
    textarea.rows = 4;
    textarea.required = true;
    textarea.minLength = 8;
    textarea.maxLength = 1000;
    textarea.placeholder = 'לדוגמה: נא להשלים את שעת הסיום במפגש מ־12.11 ולבדוק את דיווח הנסיעות.';
    const error = documentRef.createElement('p');
    error.className = 'manager-attendance-return-dialog__error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    const actions = documentRef.createElement('div');
    actions.className = 'manager-attendance-return-dialog__actions';
    const cancel = documentRef.createElement('button');
    cancel.type = 'button';
    cancel.className = 'manager-workspace-link-button';
    cancel.textContent = 'ביטול';
    const submit = documentRef.createElement('button');
    submit.type = 'submit';
    submit.className = 'manager-workspace-run-team';
    submit.textContent = 'החזר למדריך לתיקון';
    actions.append(cancel, submit);
    form.append(title, description, label, textarea, error, actions);
    dialog.append(form);
    documentRef.body.append(dialog);

    let finished = false;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const reason = textarea.value.trim();
      if (reason.length < 8 || reason.length > 1000) {
        error.hidden = false;
        error.textContent = 'יש לרשום הנחיה ברורה לתיקון (8–1000 תווים).';
        textarea.focus();
        return;
      }
      finish(reason);
    });
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    textarea.focus();
  });
}

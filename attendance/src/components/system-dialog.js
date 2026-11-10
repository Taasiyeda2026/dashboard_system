/**
 * Small in-app messages for the instructor attendance UI.
 * Browser alert/confirm dialogs display the GitHub Pages origin; this one
 * displays the system title without changing data or business logic.
 */
let activeDialog = false;
let sequence = 0;

function openSystemDialog(message, { confirmation = false, destructive = false } = {}) {
  if (activeDialog) return Promise.resolve(false);
  activeDialog = true;
  const previousFocus = document.activeElement;
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.className = 'av2-system-dialog';
    dialog.dir = 'rtl';

    const title = document.createElement('h2');
    title.className = 'av2-system-dialog__title';
    title.id = `av2-system-dialog-title-${++sequence}`;
    title.textContent = 'הודעות מערכת';
    dialog.setAttribute('aria-labelledby', title.id);

    const content = document.createElement('p');
    content.className = 'av2-system-dialog__message';
    content.textContent = String(message ?? '');
    dialog.append(title, content);

    const actions = document.createElement('div');
    actions.className = 'av2-system-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'av2-system-dialog__button av2-system-dialog__button--cancel';
    cancel.textContent = 'ביטול';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.className = 'av2-system-dialog__button av2-system-dialog__button--confirm';
    if (destructive) confirm.classList.add('av2-system-dialog__button--danger');
    confirm.textContent = confirmation ? (destructive ? 'מחיקה' : 'אישור') : 'סגירה';
    if (confirmation) actions.append(cancel);
    actions.append(confirm);
    dialog.append(actions);

    let resolved = false;
    function finish(approved) {
      if (resolved) return;
      resolved = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      activeDialog = false;
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
        previousFocus.focus({preventScroll:true});
      }
      resolve(approved);
    }
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      finish(false);
    });
    dialog.addEventListener('close', () => finish(false));
    dialog.addEventListener('click', event => {
      if (event.target === dialog) finish(false);
    });
    document.body.append(dialog);
    dialog.showModal();
    (confirmation ? cancel : confirm).focus();
  });
}

export function confirmSystemMessage(message, options = {}) {
  return openSystemDialog(message, { ...options, confirmation: true });
}

export function showSystemMessage(message) {
  return openSystemDialog(message);
}

const ORIGINAL_CONFIRM = window.confirm.bind(window);
const ORIGINAL_ALERT = window.alert.bind(window);
let replaying = false;
let lastActivation = null;
let activeDialog = null;

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function rememberActivation(event) {
  const target = event.target instanceof Element
    ? event.target.closest('button, [role="button"], input[type="submit"], a')
    : null;
  if (!target) return;
  lastActivation = { target, at: Date.now() };
}

document.addEventListener('click', rememberActivation, true);
document.addEventListener('submit', (event) => {
  const submitter = event.submitter instanceof Element ? event.submitter : null;
  if (submitter) lastActivation = { target: submitter, at: Date.now() };
}, true);

function installStyles() {
  if (document.getElementById('system-dialog-runtime-styles')) return;
  const style = document.createElement('style');
  style.id = 'system-dialog-runtime-styles';
  style.textContent = `
    .system-dialog-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.52);backdrop-filter:blur(2px)}
    .system-dialog-card{width:min(100%,430px);direction:rtl;background:#fff;border:1px solid #dbe3ec;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.28);overflow:hidden;color:#172033}
    .system-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px 10px}
    .system-dialog-title{margin:0;font-size:18px;font-weight:800;line-height:1.3}
    .system-dialog-close{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:50%;background:#f8fafc;color:#64748b;font:700 20px/1 Arial;cursor:pointer}
    .system-dialog-body{padding:8px 18px 18px;font-size:14px;line-height:1.65;color:#475569;white-space:pre-line}
    .system-dialog-actions{display:flex;justify-content:flex-start;gap:9px;padding:13px 18px 16px;border-top:1px solid #eef2f6;background:#fbfcfe}
    .system-dialog-btn{min-width:98px;min-height:38px;padding:7px 14px;border-radius:9px;border:1px solid #d7e0ea;background:#fff;color:#334155;font:700 13.5px/1.2 inherit;cursor:pointer}
    .system-dialog-btn--primary{border-color:#2f6fed;background:#2f6fed;color:#fff}
    .system-dialog-btn--danger{border-color:#dc2626;background:#dc2626;color:#fff}
    .system-dialog-btn:focus-visible,.system-dialog-close:focus-visible{outline:3px solid rgba(47,111,237,.25);outline-offset:2px}
  `;
  document.head.appendChild(style);
}

function dialogTitle(message, kind) {
  if (kind === 'alert') return 'הודעה';
  const value = text(message);
  if (value.includes('שיבוץ')) return 'אישור שיבוץ';
  if (value.includes('מחיק') || value.includes('להסיר')) return 'אישור מחיקה';
  if (value.includes('הפק')) return 'אישור הפקה';
  return 'אישור פעולה';
}

function isDestructive(message) {
  const value = text(message);
  return value.includes('מחיק') || value.includes('להסיר') || value.includes('לצמיתות');
}

function closeDialog(result = false) {
  if (!activeDialog) return;
  const { overlay, trigger, resolve, keyHandler } = activeDialog;
  document.removeEventListener('keydown', keyHandler, true);
  overlay.remove();
  activeDialog = null;
  if (trigger instanceof HTMLElement) {
    window.setTimeout(() => trigger.focus({ preventScroll: true }), 0);
  }
  resolve(result);
}

function openDialog({ message, kind = 'confirm', trigger = null } = {}) {
  installStyles();
  if (activeDialog) closeDialog(false);

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'system-dialog-overlay';
    overlay.setAttribute('role', 'presentation');

    const card = document.createElement('section');
    card.className = 'system-dialog-card';
    card.setAttribute('role', kind === 'confirm' ? 'alertdialog' : 'dialog');
    card.setAttribute('aria-modal', 'true');

    const titleId = `system-dialog-title-${Date.now()}`;
    const bodyId = `system-dialog-body-${Date.now()}`;
    card.setAttribute('aria-labelledby', titleId);
    card.setAttribute('aria-describedby', bodyId);

    const head = document.createElement('header');
    head.className = 'system-dialog-head';
    const title = document.createElement('h2');
    title.id = titleId;
    title.className = 'system-dialog-title';
    title.textContent = dialogTitle(message, kind);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'system-dialog-close';
    close.setAttribute('aria-label', 'סגירה');
    close.textContent = '×';
    head.append(title, close);

    const body = document.createElement('div');
    body.id = bodyId;
    body.className = 'system-dialog-body';
    body.textContent = text(message);

    const actions = document.createElement('footer');
    actions.className = 'system-dialog-actions';

    let cancel = null;
    if (kind === 'confirm') {
      cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'system-dialog-btn';
      cancel.textContent = 'ביטול';
      actions.append(cancel);
    }

    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = `system-dialog-btn system-dialog-btn--primary${isDestructive(message) ? ' system-dialog-btn--danger' : ''}`;
    approve.textContent = kind === 'confirm' ? 'אישור' : 'סגירה';
    actions.append(approve);

    card.append(head, body, actions);
    overlay.append(card);
    document.body.append(overlay);

    const keyHandler = (event) => {
      if (!activeDialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = [...card.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };

    activeDialog = { overlay, trigger, resolve, keyHandler };
    document.addEventListener('keydown', keyHandler, true);
    close.addEventListener('click', () => closeDialog(false));
    cancel?.addEventListener('click', () => closeDialog(false));
    approve.addEventListener('click', () => closeDialog(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closeDialog(false);
    });
    window.setTimeout(() => (cancel || approve).focus(), 0);
  });
}

function recentTrigger() {
  if (!lastActivation || Date.now() - lastActivation.at > 15000) return null;
  return lastActivation.target?.isConnected ? lastActivation.target : null;
}

window.confirm = function systemConfirm(message) {
  if (replaying) return true;
  const trigger = recentTrigger();
  void openDialog({ message, kind: 'confirm', trigger }).then((approved) => {
    if (!approved) return;
    if (!trigger || typeof trigger.click !== 'function') {
      console.warn('[system-dialog] confirmation approved but no replayable trigger was available');
      return;
    }
    replaying = true;
    try {
      trigger.click();
    } finally {
      window.setTimeout(() => { replaying = false; }, 0);
    }
  });
  return false;
};

window.alert = function systemAlert(message) {
  void openDialog({ message, kind: 'alert', trigger: recentTrigger() });
};

window.__nativeConfirmFallback = ORIGINAL_CONFIRM;
window.__nativeAlertFallback = ORIGINAL_ALERT;

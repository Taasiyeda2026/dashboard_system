const SUBMIT_SELECTOR = '.av2-home__month-submit';
const BYPASS_ATTR = 'av2SubmitDialogBypass';
const STYLE_ID = 'av2-submit-confirmation-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .av2-submit-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(15, 23, 42, 0.48);
      backdrop-filter: blur(2px);
    }

    .av2-submit-dialog {
      width: min(100%, 430px);
      background: #fff;
      border: 1px solid #d9e2ec;
      border-radius: 14px;
      box-shadow: 0 24px 64px rgba(15, 23, 42, 0.22), 0 6px 18px rgba(15, 23, 42, 0.12);
      padding: 22px;
      direction: rtl;
      text-align: right;
      color: var(--av2-color-text, #1e293b);
      font-family: inherit;
    }

    .av2-submit-dialog__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      margin-bottom: 14px;
      border-radius: 50%;
      background: #eaf2ff;
      color: var(--av2-color-accent, #2f6fed);
      font-size: 1.35rem;
      font-weight: 800;
    }

    .av2-submit-dialog__title {
      margin: 0;
      font-size: 1.03rem;
      line-height: 1.45;
      font-weight: 800;
      color: var(--av2-color-text, #1e293b);
    }

    .av2-submit-dialog__text {
      margin: 9px 0 0;
      font-size: 0.82rem;
      line-height: 1.65;
      color: var(--av2-color-text-muted, #64748b);
    }

    .av2-submit-dialog__actions {
      display: flex;
      justify-content: flex-start;
      gap: 8px;
      margin-top: 20px;
    }

    .av2-submit-dialog__actions .av2-btn {
      min-height: 38px;
      padding-inline: 16px;
    }

    @media (max-width: 479px) {
      .av2-submit-dialog-backdrop {
        align-items: flex-end;
        padding: 12px;
      }

      .av2-submit-dialog {
        width: 100%;
        border-radius: 14px 14px 10px 10px;
        padding: 20px 18px 18px;
      }

      .av2-submit-dialog__actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      .av2-submit-dialog__actions .av2-btn {
        width: 100%;
      }
    }
  `;
  document.head.append(style);
}

function parseNativeMessage(message) {
  const text = String(message || '');
  const monthMatch = text.match(/להגיש את דיווח\s+(.+?)\?/);
  const countMatch = text.match(/יש\s+(\d+)\s+רשומות/);
  return {
    monthLabel: monthMatch?.[1]?.trim() || '',
    recordsCount: countMatch ? Number(countMatch[1]) : null,
  };
}

function showSubmitDialog({ monthLabel, recordsCount, actionLabel = 'סיום ואישור' } = {}) {
  ensureStyles();

  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'av2-submit-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'av2-submit-dialog';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'av2-submit-dialog-title');
    dialog.setAttribute('aria-describedby', 'av2-submit-dialog-text');

    const icon = document.createElement('span');
    icon.className = 'av2-submit-dialog__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '✓';

    const title = document.createElement('h2');
    title.id = 'av2-submit-dialog-title';
    title.className = 'av2-submit-dialog__title';
    const reopened = actionLabel.includes('מחדש');
    title.textContent = monthLabel
      ? `${reopened ? 'הגשה מחדש של' : 'סיום ואישור'} דיווח ${monthLabel}`
      : (reopened ? 'הגשה מחדש של הדיווח' : 'סיום ואישור הדיווח');

    const body = document.createElement('p');
    body.id = 'av2-submit-dialog-text';
    body.className = 'av2-submit-dialog__text';
    const countText = Number.isFinite(recordsCount)
      ? `הדיווח כולל ${recordsCount === 1 ? 'רשומה אחת' : `${recordsCount} רשומות`}. `
      : '';
    body.textContent = `${countText}לאחר האישור החודש יועבר לבקרת מנהל ולא ניתן יהיה לערוך את הדיווחים, אלא אם החודש יוחזר לתיקון.`;

    const actions = document.createElement('div');
    actions.className = 'av2-submit-dialog__actions';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'av2-btn av2-btn--primary';
    confirmBtn.textContent = reopened ? 'הגשה מחדש' : 'סיום ואישור';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'av2-btn av2-btn--secondary';
    cancelBtn.textContent = 'ביטול';

    let settled = false;
    const close = (result) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      backdrop.remove();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
    };

    confirmBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close(false);
    });
    document.addEventListener('keydown', onKeyDown, true);

    actions.append(confirmBtn, cancelBtn);
    dialog.append(icon, title, body, actions);
    backdrop.append(dialog);
    document.body.append(backdrop);
    confirmBtn.focus();
  });
}

function installSubmitConfirmationInterceptor() {
  document.addEventListener('click', (event) => {
    const submitBtn = event.target instanceof Element ? event.target.closest(SUBMIT_SELECTOR) : null;
    if (!(submitBtn instanceof HTMLButtonElement)) return;
    if (submitBtn.dataset[BYPASS_ATTR] === '1') return;

    const nativeConfirm = window.confirm;
    let capturedMessage = '';

    window.confirm = (message) => {
      capturedMessage = String(message || '');
      return false;
    };

    queueMicrotask(async () => {
      window.confirm = nativeConfirm;
      if (!capturedMessage || !submitBtn.isConnected || submitBtn.disabled) return;

      const parsed = parseNativeMessage(capturedMessage);
      const actionLabel = String(submitBtn.textContent || '').replace(/\s+/g, ' ').trim();
      const approved = await showSubmitDialog({ ...parsed, actionLabel });
      if (!approved || !submitBtn.isConnected || submitBtn.disabled) return;

      submitBtn.dataset[BYPASS_ATTR] = '1';
      const latestConfirm = window.confirm;
      window.confirm = () => true;
      try {
        submitBtn.click();
      } finally {
        window.confirm = latestConfirm;
        delete submitBtn.dataset[BYPASS_ATTR];
      }
    });
  }, true);
}

if (typeof document !== 'undefined') {
  installSubmitConfirmationInterceptor();
}

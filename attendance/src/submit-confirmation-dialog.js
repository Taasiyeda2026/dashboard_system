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
      padding: 24px;
      background: rgba(15, 23, 42, .62);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    }

    .av2-submit-dialog {
      width: min(100%, 520px);
      overflow: hidden;
      direction: rtl;
      text-align: right;
      color: var(--av2-color-text, #172033);
      background: #fff;
      border: 1px solid rgba(148, 163, 184, .38);
      border-radius: 20px;
      box-shadow: 0 28px 80px rgba(15, 23, 42, .30), 0 4px 14px rgba(15, 23, 42, .10);
    }

    .av2-submit-dialog__top {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 13px;
      padding: 24px 24px 18px;
      border-bottom: 1px solid #e8edf3;
      background: linear-gradient(180deg, #f8fbff 0%, #ffffff 100%);
    }

    .av2-submit-dialog__icon {
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 14px;
      color: #fff;
      background: var(--av2-color-accent, #2f6fed);
      box-shadow: 0 8px 20px rgba(47, 111, 237, .24);
      font-size: 1.25rem;
      font-weight: 900;
    }

    .av2-submit-dialog__heading {
      min-width: 0;
      flex: 1;
      padding-inline-end: 34px;
    }

    .av2-submit-dialog__title {
      margin: 0;
      color: #172033;
      font-size: 1.18rem;
      line-height: 1.3;
      font-weight: 850;
    }

    .av2-submit-dialog__month {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      margin-top: 7px;
      padding: 3px 9px;
      border-radius: 999px;
      background: #eaf2ff;
      color: #245fc8;
      font-size: .72rem;
      font-weight: 800;
    }

    .av2-submit-dialog__close {
      position: absolute;
      inset-inline-start: 17px;
      inset-block-start: 17px;
      width: 30px;
      height: 30px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #64748b;
      font: inherit;
      font-size: 1.2rem;
      line-height: 1;
      cursor: pointer;
    }

    .av2-submit-dialog__close:hover,
    .av2-submit-dialog__close:focus-visible {
      background: #eef2f7;
      color: #172033;
      outline: none;
    }

    .av2-submit-dialog__body {
      display: grid;
      gap: 14px;
      padding: 20px 24px 8px;
    }

    .av2-submit-dialog__question {
      margin: 0;
      color: #172033;
      font-size: .95rem;
      line-height: 1.55;
      font-weight: 800;
    }

    .av2-submit-dialog__notice {
      display: flex;
      align-items: flex-start;
      gap: 9px;
      margin: 0;
      padding: 11px 12px;
      border: 1px solid #fde3a7;
      border-radius: 11px;
      background: #fffaf0;
      color: #7c4a03;
      font-size: .78rem;
      line-height: 1.55;
    }

    .av2-submit-dialog__notice-icon {
      flex: 0 0 auto;
      font-size: .9rem;
      line-height: 1.4;
    }

    .av2-submit-dialog__summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 14px;
      border: 1px solid #dbe6f5;
      border-radius: 12px;
      background: #f7faff;
    }

    .av2-submit-dialog__summary-label {
      color: #475569;
      font-size: .78rem;
      font-weight: 700;
    }

    .av2-submit-dialog__summary-value {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      color: #172033;
      white-space: nowrap;
    }

    .av2-submit-dialog__summary-value strong {
      color: var(--av2-color-accent, #2f6fed);
      font-size: 1.35rem;
      line-height: 1;
      font-weight: 900;
    }

    .av2-submit-dialog__summary-value span {
      font-size: .75rem;
      font-weight: 800;
    }

    .av2-submit-dialog__problem {
      min-height: 0;
    }

    .av2-submit-dialog__issues {
      margin: 8px 0 0;
      padding: 9px 26px 9px 10px;
      border-radius: 9px;
      background: #fff7ed;
      color: #9a3412;
      font-size: .75rem;
      line-height: 1.5;
    }

    .av2-submit-dialog__error {
      margin: 8px 0 0;
      color: #b91c1c;
      font-size: .76rem;
      font-weight: 800;
    }

    .av2-submit-dialog__actions {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 9px;
      padding: 16px 24px 22px;
    }

    .av2-submit-dialog__actions .av2-btn {
      min-height: 38px;
      padding-inline: 16px;
      border-radius: 10px;
      font-size: .78rem;
      font-weight: 800;
    }

    .av2-submit-dialog__actions [data-approve] {
      min-width: 132px;
      box-shadow: 0 7px 16px rgba(47, 111, 237, .20);
    }

    .av2-submit-dialog__actions [data-cancel] {
      min-width: 78px;
    }

    @media (max-width: 520px) {
      .av2-submit-dialog-backdrop { padding: 14px; }
      .av2-submit-dialog { border-radius: 16px; }
      .av2-submit-dialog__top { padding: 20px 18px 16px; }
      .av2-submit-dialog__heading { padding-inline-end: 30px; }
      .av2-submit-dialog__body { padding: 18px 18px 6px; }
      .av2-submit-dialog__actions { padding: 14px 18px 18px; }
      .av2-submit-dialog__actions .av2-btn { flex: 1; }
    }
  `;
  document.head.append(style);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function openSubmitConfirmationDialog({ monthLabel, sourceCount, trigger, onApprove, onRetry } = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const safeMonth = escapeHtml(monthLabel || 'החודש');
    const count = Math.max(0, Number(sourceCount) || 0);

    const backdrop = document.createElement('div');
    backdrop.className = 'av2-submit-dialog-backdrop';

    const dialog = document.createElement('section');
    dialog.className = 'av2-submit-dialog';
    dialog.dir = 'rtl';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'av2-submit-title');
    dialog.setAttribute('aria-describedby', 'av2-submit-description');
    dialog.innerHTML = `
      <div class="av2-submit-dialog__top">
        <div class="av2-submit-dialog__icon" aria-hidden="true">✓</div>
        <div class="av2-submit-dialog__heading">
          <h2 id="av2-submit-title" class="av2-submit-dialog__title">סיום ואישור דיווחי החודש</h2>
          <span class="av2-submit-dialog__month">${safeMonth}</span>
        </div>
        <button type="button" class="av2-submit-dialog__close" aria-label="סגירה">×</button>
      </div>

      <div class="av2-submit-dialog__body" id="av2-submit-description">
        <p class="av2-submit-dialog__question">האם להגיש את דיווחי החודש?</p>
        <p class="av2-submit-dialog__notice">
          <span class="av2-submit-dialog__notice-icon" aria-hidden="true">!</span>
          <span>לאחר ההגשה לא ניתן יהיה לערוך את הדיווחים עד לאישור מנהל.</span>
        </p>
        <div class="av2-submit-dialog__summary">
          <span class="av2-submit-dialog__summary-label">דיווחים בחודש זה</span>
          <span class="av2-submit-dialog__summary-value"><strong>${count}</strong><span>דיווחים</span></span>
        </div>
        <div class="av2-submit-dialog__problem" aria-live="polite"></div>
      </div>

      <div class="av2-submit-dialog__actions">
        <button type="button" class="av2-btn av2-btn--primary" data-approve>אישור והגשה</button>
        <button type="button" class="av2-btn av2-btn--secondary" data-cancel>ביטול</button>
      </div>`;

    backdrop.append(dialog);
    document.body.append(backdrop);

    const closeButton = dialog.querySelector('.av2-submit-dialog__close');
    const cancel = dialog.querySelector('[data-cancel]');
    const approve = dialog.querySelector('[data-approve]');
    const problem = dialog.querySelector('.av2-submit-dialog__problem');
    let busy = false;

    const close = (value) => {
      if (busy) return;
      document.removeEventListener('keydown', keydown, true);
      backdrop.remove();
      trigger?.focus?.();
      resolve(value);
    };

    const keydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    const showError = (error) => {
      const message = String(error?.message || error || 'ההגשה נכשלה');
      const raw = message.includes('attendance_travel_compensation_unresolved:')
        ? message.split('attendance_travel_compensation_unresolved:')[1]
        : '';
      let issues = [];
      try { issues = JSON.parse(raw); } catch {}

      problem.innerHTML = `<p class="av2-submit-dialog__error">לא ניתן להגיש עד להשלמת חישובי זמן הנסיעה.</p>${issues.length ? `<ul class="av2-submit-dialog__issues">${issues.map((item) => `<li>${escapeHtml(item.date || '')} · ${escapeHtml(item.activity || 'פעילות')}</li>`).join('')}</ul>` : ''}`;

      if (onRetry) {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'av2-btn av2-btn--secondary';
        retry.textContent = 'נסה לחשב שוב';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try { await onRetry(issues); } finally { retry.disabled = false; }
        });
        problem.append(retry);
      }
    };

    approve.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      approve.disabled = true;
      cancel.disabled = true;
      closeButton.disabled = true;
      approve.textContent = 'מגיש…';
      try {
        await onApprove?.();
        busy = false;
        backdrop.remove();
        document.removeEventListener('keydown', keydown, true);
        trigger?.focus?.();
        resolve(true);
      } catch (error) {
        busy = false;
        approve.disabled = false;
        cancel.disabled = false;
        closeButton.disabled = false;
        approve.textContent = 'אישור והגשה';
        showError(error);
      }
    });

    cancel.addEventListener('click', () => close(false));
    closeButton.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(false); });
    document.addEventListener('keydown', keydown, true);
    cancel.focus();
  });
}

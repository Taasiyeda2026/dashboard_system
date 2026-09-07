const STYLE_ID = 'av2-submit-confirmation-style';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .av2-submit-dialog-backdrop{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.48)}
    .av2-submit-dialog{width:min(100%,460px);background:#fff;border:1px solid #d9e2ec;border-radius:14px;box-shadow:0 24px 64px rgba(15,23,42,.22);padding:22px;direction:rtl;text-align:right;color:var(--av2-color-text,#1e293b)}
    .av2-submit-dialog__head{display:flex;align-items:center;justify-content:space-between;gap:12px}.av2-submit-dialog__title{margin:0;font-size:1.05rem}.av2-submit-dialog__close{border:0;background:none;font-size:1.35rem;cursor:pointer}
    .av2-submit-dialog__text{font-size:.84rem;line-height:1.65;color:var(--av2-color-text-muted,#64748b)}.av2-submit-dialog__issues{margin:10px 0;padding:10px 26px 10px 10px;background:#fff7ed;border-radius:8px;font-size:.78rem}
    .av2-submit-dialog__error{color:#b91c1c;font-size:.78rem}.av2-submit-dialog__actions{display:flex;gap:8px;margin-top:18px}
  `;
  document.head.append(style);
}

export function openSubmitConfirmationDialog({ monthLabel, sourceCount, trigger, onApprove, onRetry } = {}) {
  ensureStyles();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.className = 'av2-submit-dialog-backdrop';
    const dialog = document.createElement('section'); dialog.className = 'av2-submit-dialog'; dialog.dir = 'rtl';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'av2-submit-title');
    dialog.innerHTML = `<div class="av2-submit-dialog__head"><h2 id="av2-submit-title" class="av2-submit-dialog__title">סיום ואישור דיווחי החודש</h2><button type="button" class="av2-submit-dialog__close" aria-label="סגירה">×</button></div>
      <div class="av2-submit-dialog__text"><p>האם להגיש את דיווחי ${monthLabel}?</p><p>לאחר ההגשה לא ניתן יהיה לערוך את הדיווחים עד אישור מנהל.</p><p>בחודש זה קיימות ${sourceCount} רשומות לדיווח.</p></div>
      <div class="av2-submit-dialog__problem" aria-live="polite"></div><div class="av2-submit-dialog__actions"><button type="button" class="av2-btn av2-btn--secondary" data-cancel>ביטול</button><button type="button" class="av2-btn av2-btn--primary" data-approve>אישור והגשה</button></div>`;
    backdrop.append(dialog); document.body.append(backdrop);
    const closeButton = dialog.querySelector('.av2-submit-dialog__close');
    const cancel = dialog.querySelector('[data-cancel]'); const approve = dialog.querySelector('[data-approve]');
    const problem = dialog.querySelector('.av2-submit-dialog__problem'); let busy = false;
    const close = (value) => { if (busy) return; document.removeEventListener('keydown', keydown, true); backdrop.remove(); trigger?.focus?.(); resolve(value); };
    const keydown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const showError = (error) => {
      const message = String(error?.message || error || 'ההגשה נכשלה');
      const raw = message.includes('attendance_travel_compensation_unresolved:') ? message.split('attendance_travel_compensation_unresolved:')[1] : '';
      let issues = []; try { issues = JSON.parse(raw); } catch {}
      problem.innerHTML = `<p class="av2-submit-dialog__error">לא ניתן להגיש עד להשלמת חישובי זמן הנסיעה.</p>${issues.length ? `<ul class="av2-submit-dialog__issues">${issues.map((item) => `<li>${item.date || ''} · ${item.activity || 'פעילות'}</li>`).join('')}</ul>` : ''}`;
      if (onRetry) { const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'av2-btn av2-btn--secondary'; retry.textContent = 'נסה לחשב שוב'; retry.addEventListener('click', async () => { retry.disabled = true; await onRetry(issues); retry.disabled = false; }); problem.append(retry); }
    };
    approve.addEventListener('click', async () => {
      if (busy) return; busy = true; approve.disabled = true; cancel.disabled = true; closeButton.disabled = true; approve.textContent = 'מגיש…';
      try { await onApprove?.(); busy = false; backdrop.remove(); document.removeEventListener('keydown', keydown, true); trigger?.focus?.(); resolve(true); }
      catch (error) { busy = false; approve.disabled = false; cancel.disabled = false; closeButton.disabled = false; approve.textContent = 'אישור והגשה'; showError(error); }
    });
    cancel.addEventListener('click', () => close(false)); closeButton.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(false); });
    document.addEventListener('keydown', keydown, true); cancel.focus();
  });
}

import { supabase } from './supabase-client.js';

const MIN_PASSWORD_LENGTH = 8;

function closeModal(modal) {
  modal?.remove();
}

function ensureStyles() {
  if (document.querySelector('[data-instructor-password-recovery-styles]')) return;
  const style = document.createElement('style');
  style.dataset.instructorPasswordRecoveryStyles = '';
  style.textContent = `
    .instructor-password-modal{position:fixed;inset:0;z-index:100001;display:grid;place-items:center;padding:18px;background:rgba(15,23,42,.42);backdrop-filter:blur(2px)}
    .instructor-password-card{direction:rtl;width:min(420px,calc(100vw - 28px));display:grid;gap:12px;padding:20px;border-radius:14px;background:#fff;box-shadow:0 22px 60px rgba(15,23,42,.24)}
    .instructor-password-card h2{margin:0;font-size:1.1rem;color:#172033}.instructor-password-card p{margin:0;color:#64748b;font-size:.86rem;line-height:1.5}
    .instructor-password-card label{display:grid;gap:5px;font-size:.82rem;font-weight:700;color:#334155}.instructor-password-card input{box-sizing:border-box;width:100%;height:40px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font:inherit;direction:ltr;text-align:left}
    .instructor-password-card input[data-password-code]{font-size:1.15rem;font-weight:700;letter-spacing:6px;text-align:center}
    .instructor-password-actions{display:flex;gap:8px;justify-content:flex-start;margin-top:2px}.instructor-password-actions button{min-height:36px;padding:7px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;font:inherit}.instructor-password-actions .is-primary{border-color:#1d4ed8;background:#1d4ed8;color:#fff}.instructor-password-actions button:disabled{opacity:.65;cursor:wait}
    .instructor-password-status{min-height:20px;color:#475569;font-size:.82rem}.instructor-password-status.is-error{color:#b91c1c}.instructor-password-status.is-success{color:#047857}
  `;
  document.head.append(style);
}

function shell() {
  ensureStyles();
  const modal = document.createElement('div');
  modal.className = 'instructor-password-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const card = document.createElement('section');
  card.className = 'instructor-password-card';
  const title = document.createElement('h2');
  title.textContent = 'שכחתי קוד כניסה';
  const note = document.createElement('p');
  note.textContent = 'הזינו את המייל הרשום במערכת. אם החשבון מורשה, יישלח אליו קוד אימות בן 6 ספרות.';
  card.append(title, note);
  modal.append(card);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeModal(modal);
  });
  document.body.append(modal);
  return { modal, card };
}

function field(labelText, options = {}) {
  const label = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = labelText;
  const input = document.createElement('input');
  input.type = options.type || 'text';
  if (options.placeholder) input.placeholder = options.placeholder;
  if (options.autocomplete) input.autocomplete = options.autocomplete;
  if (options.inputMode) input.inputMode = options.inputMode;
  if (options.maxLength) input.maxLength = options.maxLength;
  label.append(text, input);
  return { label, input };
}

function actions(primaryText, onPrimary, onCancel) {
  const row = document.createElement('div');
  row.className = 'instructor-password-actions';
  const primary = document.createElement('button');
  primary.type = 'button';
  primary.className = 'is-primary';
  primary.textContent = primaryText;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'ביטול';
  primary.addEventListener('click', onPrimary);
  cancel.addEventListener('click', onCancel);
  row.append(primary, cancel);
  return { row, primary };
}

function statusNode() {
  const status = document.createElement('div');
  status.className = 'instructor-password-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  return status;
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function openRecoveryModal() {
  if (document.querySelector('.instructor-password-modal')) return;
  document.querySelector('.management-password-modal')?.remove();
  const { modal, card } = shell();
  const emailField = field('מייל', { type: 'email', autocomplete: 'email', placeholder: 'name@example.com' });
  const status = statusNode();
  let challengeId = '';

  const requestActions = actions('שליחת קוד', async () => {
    const email = String(emailField.input.value || '').trim().toLowerCase();
    status.className = 'instructor-password-status';
    status.textContent = '';
    if (!validEmail(email)) {
      status.classList.add('is-error');
      status.textContent = 'יש להזין כתובת מייל תקינה.';
      return;
    }

    requestActions.primary.disabled = true;
    requestActions.primary.textContent = 'שולח...';
    try {
      const { data, error } = await supabase.functions.invoke('management-password-reset', {
        body: { action: 'request', email }
      });
      if (error || !data?.challenge_id) throw error || new Error('challenge_not_created');
      challengeId = String(data.challenge_id);
      emailField.input.disabled = true;
      requestActions.row.remove();
      status.classList.add('is-success');
      status.textContent = 'אם החשבון נמצא ומורשה, קוד אימות נשלח למייל הרשום במערכת. הקוד תקף ל-10 דקות.';

      const codeField = field('קוד אימות', { inputMode: 'numeric', autocomplete: 'one-time-code', placeholder: '000000', maxLength: 6 });
      codeField.input.dataset.passwordCode = '';
      codeField.input.addEventListener('input', () => {
        codeField.input.value = codeField.input.value.replace(/\D/g, '').slice(0, 6);
      });
      const first = field('קוד כניסה חדש', { type: 'password', autocomplete: 'new-password' });
      const second = field('אימות קוד הכניסה החדש', { type: 'password', autocomplete: 'new-password' });

      const completeActions = actions('שמירת קוד חדש', async () => {
        const code = String(codeField.input.value || '').trim();
        const password = String(first.input.value || '');
        const confirmation = String(second.input.value || '');
        status.className = 'instructor-password-status';
        status.textContent = '';
        if (!/^\d{6}$/.test(code)) {
          status.classList.add('is-error');
          status.textContent = 'יש להזין את קוד האימות בן 6 הספרות שנשלח למייל.';
          return;
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
          status.classList.add('is-error');
          status.textContent = `קוד הכניסה החדש חייב להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`;
          return;
        }
        if (password !== confirmation) {
          status.classList.add('is-error');
          status.textContent = 'קודי הכניסה החדשים אינם זהים.';
          return;
        }

        completeActions.primary.disabled = true;
        completeActions.primary.textContent = 'שומר...';
        try {
          const { data, error } = await supabase.functions.invoke('management-password-reset', {
            body: { action: 'complete', challenge_id: challengeId, code, new_password: password }
          });
          if (error || !data?.ok) throw error || new Error(String(data?.error || 'invalid_or_expired'));
          status.classList.add('is-success');
          status.textContent = 'קוד הכניסה עודכן בהצלחה. ניתן להתחבר עם מספר העובד והקוד החדש.';
          codeField.input.disabled = true;
          first.input.disabled = true;
          second.input.disabled = true;
          completeActions.primary.textContent = 'עודכן בהצלחה';
          setTimeout(() => closeModal(modal), 1600);
        } catch (error) {
          status.classList.add('is-error');
          status.textContent = String(error?.message || '').includes('update_failed')
            ? 'עדכון קוד הכניסה נכשל. נסו שוב.'
            : 'קוד האימות שגוי או שפג תוקפו. ניתן לבטל ולבקש קוד חדש.';
          completeActions.primary.disabled = false;
          completeActions.primary.textContent = 'שמירת קוד חדש';
        }
      }, () => closeModal(modal));

      card.append(codeField.label, first.label, second.label, completeActions.row);
      requestAnimationFrame(() => codeField.input.focus());
    } catch {
      status.classList.add('is-error');
      status.textContent = 'לא ניתן לשלוח כרגע קוד אימות. נסו שוב בעוד רגע.';
      requestActions.primary.disabled = false;
      requestActions.primary.textContent = 'שליחת קוד';
    }
  }, () => closeModal(modal));

  card.append(emailField.label, status, requestActions.row);
  requestAnimationFrame(() => emailField.input.focus());
}

document.addEventListener('click', (event) => {
  const trigger = event.target.closest?.('[data-management-forgot-password]');
  if (!trigger) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openRecoveryModal();
}, true);

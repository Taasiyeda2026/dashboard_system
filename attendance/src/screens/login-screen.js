import { createInputField } from '../components/field.js';
import { supabase } from '../api/client.js';

const MIN_PASSWORD_LENGTH = 8;

function normalizeEmail(value) {
  return String(value ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .trim()
    .toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function renderLoginScreen(container, { onLogin } = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-login';

  const inner = document.createElement('div');
  inner.className = 'av2-login__inner';

  const logo = document.createElement('img');
  logo.className = 'av2-login__logo';
  logo.src = new URL('../../assets/logo.png', import.meta.url).href;
  logo.alt = 'תעשיידע';

  const subtitle = document.createElement('p');
  subtitle.className = 'av2-login__subtitle';
  subtitle.textContent = 'מערכת נוכחות';

  const form = document.createElement('form');
  form.className = 'av2-login__form';
  form.noValidate = true;

  const userField = createInputField({
    id: 'av2-username',
    label: '',
    placeholder: 'מספר עובד',
    autocomplete: 'username'
  });
  const codeField = createInputField({
    id: 'av2-code',
    label: '',
    type: 'password',
    placeholder: 'קוד אישי',
    autocomplete: 'current-password'
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'av2-btn av2-btn--primary av2-login__submit';
  const submitLabel = document.createElement('span');
  submitLabel.textContent = 'כניסה למערכת';
  submit.append(submitLabel);

  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.className = 'av2-login__forgot';
  forgot.textContent = 'שכחתי קוד כניסה';

  const errorEl = document.createElement('p');
  errorEl.className = 'av2-login__error';
  errorEl.hidden = true;

  function setBusy(busy) {
    userField.input.disabled = busy;
    codeField.input.disabled = busy;
    submit.disabled = busy;
    forgot.disabled = busy;
    submitLabel.textContent = busy ? 'מתחבר…' : 'כניסה למערכת';
  }

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  form.append(userField.wrap, codeField.wrap, submit, forgot, errorEl);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError('');
    setBusy(true);
    try {
      await onLogin?.({ username: userField.input.value.trim(), code: codeField.input.value.trim() });
    } catch (error) {
      showError(error?.message || 'שגיאה בהתחברות');
    } finally {
      setBusy(false);
    }
  });

  forgot.addEventListener('click', () => {
    renderPasswordRecovery(inner, {
      onBack: () => renderLoginScreen(container, { onLogin })
    });
  });

  inner.append(logo, subtitle, form);
  wrap.append(inner);
  container.append(wrap);
}

function renderPasswordRecovery(inner, { onBack } = {}) {
  inner.querySelector('.av2-login__form')?.remove();

  const note = document.createElement('p');
  note.className = 'av2-login__recovery-note';
  note.textContent = 'הזינו את המייל הרשום במערכת. יישלח אליו קוד אימות בן 6 ספרות.';

  const form = document.createElement('form');
  form.className = 'av2-login__form av2-login__recovery-form';
  form.noValidate = true;

  const emailField = createInputField({
    id: 'av2-recovery-email',
    label: '',
    type: 'email',
    placeholder: 'המייל הרשום במערכת',
    autocomplete: 'email'
  });
  emailField.input.dir = 'ltr';

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'av2-btn av2-btn--primary av2-login__submit';
  send.textContent = 'שליחת קוד';

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'av2-login__forgot';
  back.textContent = 'חזרה לכניסה';
  back.addEventListener('click', () => onBack?.());

  const status = document.createElement('p');
  status.className = 'av2-login__recovery-status';
  status.hidden = true;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  function setStatus(message, kind = '') {
    status.textContent = message || '';
    status.hidden = !message;
    status.dataset.kind = kind;
  }

  form.append(emailField.wrap, send, back, status);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('');
    const email = normalizeEmail(emailField.input.value);
    if (!isValidEmail(email)) {
      setStatus('יש להזין כתובת מייל תקינה.', 'error');
      return;
    }

    emailField.input.disabled = true;
    send.disabled = true;
    send.textContent = 'שולח…';

    try {
      const { data, error } = await supabase.functions.invoke('management-password-reset', {
        body: { action: 'request', email }
      });
      if (error || !data?.challenge_id) throw error || new Error('challenge_not_created');

      const challengeId = String(data.challenge_id);
      send.remove();
      setStatus('אם החשבון נמצא ומורשה, קוד אימות נשלח למייל. הקוד תקף ל־10 דקות.', 'success');
      appendRecoveryCompletion(form, status, challengeId, onBack);
    } catch {
      emailField.input.disabled = false;
      send.disabled = false;
      send.textContent = 'שליחת קוד';
      setStatus('לא ניתן לשלוח כרגע קוד אימות. נסו שוב.', 'error');
    }
  });

  inner.append(note, form);
  requestAnimationFrame(() => emailField.input.focus());
}

function appendRecoveryCompletion(form, status, challengeId, onBack) {
  const codeField = createInputField({
    id: 'av2-recovery-code',
    label: '',
    placeholder: 'קוד אימות בן 6 ספרות',
    autocomplete: 'one-time-code'
  });
  codeField.input.inputMode = 'numeric';
  codeField.input.maxLength = 6;
  codeField.input.addEventListener('input', () => {
    codeField.input.value = codeField.input.value.replace(/\D/g, '').slice(0, 6);
  });

  const passwordField = createInputField({
    id: 'av2-recovery-password',
    label: '',
    type: 'password',
    placeholder: 'קוד כניסה חדש',
    autocomplete: 'new-password'
  });

  const confirmField = createInputField({
    id: 'av2-recovery-password-confirm',
    label: '',
    type: 'password',
    placeholder: 'אימות קוד הכניסה החדש',
    autocomplete: 'new-password'
  });

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'av2-btn av2-btn--primary av2-login__submit';
  save.textContent = 'שמירת קוד חדש';

  const setStatus = (message, kind = '') => {
    status.textContent = message || '';
    status.hidden = !message;
    status.dataset.kind = kind;
  };

  save.addEventListener('click', async () => {
    const code = String(codeField.input.value || '').trim();
    const password = String(passwordField.input.value || '');
    const confirmation = String(confirmField.input.value || '');

    if (!/^\d{6}$/.test(code)) {
      setStatus('יש להזין את קוד האימות בן 6 הספרות.', 'error');
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setStatus(`קוד הכניסה החדש חייב להכיל לפחות ${MIN_PASSWORD_LENGTH} תווים.`, 'error');
      return;
    }
    if (password !== confirmation) {
      setStatus('קודי הכניסה החדשים אינם זהים.', 'error');
      return;
    }

    save.disabled = true;
    save.textContent = 'שומר…';

    try {
      const { data, error } = await supabase.functions.invoke('management-password-reset', {
        body: { action: 'complete', challenge_id: challengeId, code, new_password: password }
      });
      if (error || !data?.ok) throw error || new Error(String(data?.error || 'invalid_or_expired'));

      setStatus('קוד הכניסה עודכן בהצלחה. ניתן להתחבר עכשיו עם מספר העובד והקוד החדש.', 'success');
      codeField.input.disabled = true;
      passwordField.input.disabled = true;
      confirmField.input.disabled = true;
      save.textContent = 'עודכן בהצלחה';
      setTimeout(() => onBack?.(), 1200);
    } catch (error) {
      save.disabled = false;
      save.textContent = 'שמירת קוד חדש';
      setStatus(
        String(error?.message || '').includes('update_failed')
          ? 'עדכון קוד הכניסה נכשל. נסו שוב.'
          : 'קוד האימות שגוי או שפג תוקפו. ניתן לחזור ולבקש קוד חדש.',
        'error'
      );
    }
  });

  const back = form.querySelector('.av2-login__forgot');
  form.insertBefore(codeField.wrap, back);
  form.insertBefore(passwordField.wrap, back);
  form.insertBefore(confirmField.wrap, back);
  form.insertBefore(save, back);

  requestAnimationFrame(() => codeField.input.focus());
}

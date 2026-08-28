import { createInputField } from '../components/field.js';

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

  const errorEl = document.createElement('p');
  errorEl.className = 'av2-login__error';
  errorEl.hidden = true;

  function setBusy(busy) {
    userField.input.disabled = busy;
    codeField.input.disabled = busy;
    submit.disabled = busy;
    submitLabel.textContent = busy ? 'מתחבר…' : 'כניסה למערכת';
  }

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
  }

  form.append(userField.wrap, codeField.wrap, submit, errorEl);
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

  inner.append(logo, subtitle, form);
  wrap.append(inner);
  container.append(wrap);
}

import { createIcon } from '../components/icon.js';
import { createInputField } from '../components/field.js';

export function renderLoginScreen(container, { onLogin } = {}) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-login';

  const inner = document.createElement('div');
  inner.className = 'av2-login__inner';

  const logo = document.createElement('img');
  logo.className = 'av2-login__logo';
  logo.src = new URL('../../assets/icons/icon-512.png', import.meta.url).href;
  logo.alt = 'תעשיידע';
  logo.width = 48;
  logo.height = 48;

  const title = document.createElement('h1');
  title.className = 'av2-login__title';
  title.textContent = 'תעשיידע – נוכחות';

  const subtitle = document.createElement('p');
  subtitle.className = 'av2-login__subtitle';
  subtitle.textContent = 'Attendance V2';

  const form = document.createElement('form');
  form.className = 'av2-login__form';
  form.noValidate = true;

  const userField = createInputField({
    id: 'av2-username',
    label: 'שם משתמש / מספר עובד',
    autocomplete: 'username'
  });
  const codeField = createInputField({
    id: 'av2-code',
    label: 'קוד כניסה',
    type: 'password',
    autocomplete: 'current-password'
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'av2-btn av2-btn--primary av2-login__submit';
  const submitLabel = document.createElement('span');
  submitLabel.textContent = 'כניסה';
  submit.append(createIcon('log-in', { className: 'av2-icon--flip-rtl' }), submitLabel);

  form.append(userField.wrap, codeField.wrap, submit);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    onLogin?.({ username: userField.input.value.trim(), code: codeField.input.value.trim() });
  });

  inner.append(logo, title, subtitle, form);
  wrap.append(inner);
  container.append(wrap);
}

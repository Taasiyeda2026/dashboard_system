import { createIcon } from '../components/icon.js';

export function renderWelcomeScreen(container) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-welcome';

  const inner = document.createElement('div');
  inner.className = 'av2-container av2-welcome__inner';

  const title = document.createElement('h1');
  title.className = 'av2-welcome__title';
  title.textContent = 'תעשיידע – נוכחות';

  const subtitle = document.createElement('p');
  subtitle.className = 'av2-welcome__subtitle';
  subtitle.textContent = 'Attendance V2';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'av2-btn av2-btn--primary av2-welcome__button';
  const buttonLabel = document.createElement('span');
  buttonLabel.textContent = 'כניסה';
  button.append(createIcon('log-in', { className: 'av2-icon--flip-rtl' }), buttonLabel);

  inner.append(title, subtitle, button);
  wrap.append(inner);
  container.append(wrap);

  return { root: wrap, loginButton: button };
}

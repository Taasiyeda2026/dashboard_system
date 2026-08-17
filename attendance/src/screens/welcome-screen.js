export function renderWelcomeScreen(container) {
  container.innerHTML = '';

  const wrap = document.createElement('section');
  wrap.className = 'av2-welcome';

  const title = document.createElement('h1');
  title.className = 'av2-welcome__title';
  title.textContent = 'תעשיידע – נוכחות';

  const subtitle = document.createElement('p');
  subtitle.className = 'av2-welcome__subtitle';
  subtitle.textContent = 'Attendance V2';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'av2-welcome__button';
  button.textContent = 'כניסה';

  wrap.append(title, subtitle, button);
  container.append(wrap);

  return { root: wrap, loginButton: button };
}

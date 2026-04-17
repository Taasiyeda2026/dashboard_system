import { api } from '../api/client.js';
import { saveSession, setBootstrap, state } from '../app/state.js';
import { CONFIG } from '../config.js';

function pickInitialRoute(bootstrapPayload) {
  const modules = (bootstrapPayload?.bootstrap?.modules || []).filter((m) => m.accessible);
  if (!modules.length) return CONFIG.ROUTES.login;

  const preferred = state.user?.default_view;
  const preferredExists = modules.find((m) => m.id === preferred);
  if (preferredExists) return preferred;

  const dashboard = modules.find((m) => m.id === CONFIG.ROUTES.dashboard);
  return dashboard ? dashboard.id : modules[0].id;
}

export function renderLogin(onSuccess) {
  const el = document.createElement('div');
  el.className = 'screen screen-login';
  el.innerHTML = `
    <div class="card login-card">
      <h1>כניסה למערכת</h1>
      <p>הזינו שם משתמש/אימייל וסיסמה</p>
      <input id="login-identifier" type="text" autocomplete="username" placeholder="שם משתמש או אימייל" />
      <input id="entry-code" type="password" autocomplete="current-password" placeholder="סיסמה" />
      <button id="login-btn">כניסה</button>
      <small id="login-error" class="error"></small>
    </div>
  `;

  const identifierInput = el.querySelector('#login-identifier');
  const passwordInput = el.querySelector('#entry-code');
  const btn = el.querySelector('#login-btn');
  const error = el.querySelector('#login-error');

  async function submit() {
    error.textContent = '';

    const identifier = identifierInput.value.trim();
    const password = passwordInput.value.trim();

    if (!identifier) {
      error.textContent = 'נדרש שם משתמש או אימייל';
      return;
    }

    if (!password) {
      error.textContent = 'נדרשת סיסמה';
      return;
    }

    btn.disabled = true;
    try {
      const result = await api.login(identifier, password);
      if (!result.user) {
        error.textContent = 'פרטי התחברות שגויים';
        return;
      }

      saveSession({ ...result.user, entry_code: password });
      const bootstrapPayload = await api.getBootstrap();
      setBootstrap(bootstrapPayload);
      state.route = pickInitialRoute(bootstrapPayload);

      onSuccess();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  [identifierInput, passwordInput].forEach((input) => {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  });

  return el;
}

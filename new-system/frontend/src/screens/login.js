import { api } from '../api/client.js';
import { saveSession } from '../app/state.js';

export function renderLogin(onSuccess) {
  const el = document.createElement('div');
  el.className = 'screen screen-login';
  el.innerHTML = `
    <div class="card login-card">
      <h1>כניסה למערכת</h1>
      <p>הזנת קוד כניסה</p>
      <input id="entry-code" type="text" inputmode="numeric" placeholder="קוד כניסה" />
      <button id="login-btn">כניסה</button>
      <small id="login-error" class="error"></small>
    </div>
  `;

  const input = el.querySelector('#entry-code');
  const btn = el.querySelector('#login-btn');
  const error = el.querySelector('#login-error');

  async function submit() {
    error.textContent = '';
    if (!input.value.trim()) {
      error.textContent = 'נדרש קוד כניסה';
      return;
    }

    btn.disabled = true;
    try {
      const result = await api.login(input.value.trim());
      if (!result.user) {
        error.textContent = 'קוד שגוי';
        return;
      }

      saveSession({ ...result.user, entry_code: input.value.trim() });
      onSuccess();
    } catch (err) {
      error.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return el;
}

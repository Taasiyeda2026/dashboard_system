import { api } from '../api.js';
import { setAuth } from '../state.js';

export function loginScreen(onSuccess) {
  return `
    <section class="card login-card">
      <h1>Internal Operations Login</h1>
      <p>Enter your one-time access code from the permissions sheet.</p>
      <form id="login-form">
        <input id="entry-code" placeholder="Entry code" required autocomplete="one-time-code" />
        <button class="btn" type="submit">Login</button>
      </form>
      <p id="login-error" class="error"></p>
    </section>
  `;
}

export function bindLogin(onSuccess) {
  const form = document.getElementById('login-form');
  const errorNode = document.getElementById('login-error');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorNode.textContent = '';
    try {
      const code = document.getElementById('entry-code').value.trim();
      const session = await api.login(code);
      setAuth(session);
      onSuccess();
    } catch (error) {
      errorNode.textContent = error.message;
    }
  });
}

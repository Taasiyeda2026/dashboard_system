export const loginScreen = {
  render() {
    return `
      <div class="login-shell" dir="rtl">
        <section class="login-card">
          <h1 class="login-title">כניסה למערכת</h1>
          <p class="login-subtitle">Dashboard Taasiyeda</p>

          <form id="loginForm" class="login-form" novalidate>
            <input
              id="userId"
              required
              placeholder="מזהה משתמש"
              autocomplete="username"
            />

            <input
              id="entryCode"
              type="password"
              required
              placeholder="קוד כניסה"
              autocomplete="current-password"
            />

            <button type="submit" class="login-submit">התחברות</button>
          </form>

          <p id="loginError" class="error"></p>
        </section>
      </div>
    `;
  },

  bind({ root, onLogin }) {
    root.querySelector('#loginForm')?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const userId = root.querySelector('#userId')?.value.trim();
      const code = root.querySelector('#entryCode')?.value.trim();

      await onLogin(userId, code, root.querySelector('#loginError'));
    });
  }
};

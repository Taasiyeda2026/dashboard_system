export const loginScreen = {
  render() {
    return `
      <section class="login-wrap" dir="rtl">
        <div class="login-card">
          <h1 class="login-title">התחברות</h1>
          <p class="login-subtitle">Dashboard Taasiyeda</p>

          <form id="loginForm" class="login-form" novalidate>
            <input
              id="userId"
              class="login-input"
              required
              placeholder="מזהה משתמש"
              autocomplete="username"
            />

            <input
              id="entryCode"
              class="login-input"
              type="password"
              required
              placeholder="קוד כניסה"
              autocomplete="current-password"
            />

            <button type="submit" class="btn btn-primary login-btn">
              התחבר
            </button>
          </form>

          <p id="loginError" class="error"></p>
        </div>
      </section>
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

export const loginScreen = {
  render() {
    return `
      <main class="login-shell" dir="rtl">
        <section class="login-card">
          <h1>כניסה למערכת</h1>
          <form id="loginForm" class="login-form">
            <input id="userId" required placeholder="מזהה משתמש" autocomplete="username" />
            <input id="entryCode" required placeholder="קוד כניסה" autocomplete="one-time-code" />
            <button type="submit" class="login-submit">התחברות</button>
          </form>
          <p id="loginError" class="error"></p>
        </section>
      </main>
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

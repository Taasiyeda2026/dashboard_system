const loginLogoSrc = new URL('../../assets/logo1.png', import.meta.url).href;

export const loginScreen = {
  render() {
    return `
      <div class="login-shell" dir="rtl">
        <section class="login-card">
          <div class="login-brand">
            <img
              class="login-logo"
              src="${loginLogoSrc}"
              alt="תעשיידע"
              width="200"
              height="86"
              decoding="async"
            />
          </div>
          <h1 class="login-title">כניסה למערכת</h1>
          <p class="login-subtitle">Dashboard Taasiyeda</p>

          <form id="loginForm" class="login-form">
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
    const form = root.querySelector('#loginForm');

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const errorNode = root.querySelector('#loginError');
      if (errorNode) errorNode.textContent = '';

      const userId = root.querySelector('#userId')?.value.trim() ?? '';
      const code = root.querySelector('#entryCode')?.value.trim() ?? '';

      if (!userId || !code) {
        if (errorNode) errorNode.textContent = 'נא למלא מזהה משתמש וקוד כניסה';
        return;
      }

      await onLogin(userId, code, errorNode);
    });

    const submitOnEnter = (event) => {
      if (event.key !== 'Enter' || event.isComposing || !form) return;
      event.preventDefault();
      form.requestSubmit();
    };

    root.querySelector('#userId')?.addEventListener('keydown', submitOnEnter);
    root.querySelector('#entryCode')?.addEventListener('keydown', submitOnEnter);
  }
};

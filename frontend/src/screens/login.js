const loginLogoSrc = new URL('../../assets/logo1.png', import.meta.url).href;

export const loginScreen = {
  render(initialError = '', systemTitle = 'דשבורד תעשיידע') {
    return `
      <div class="login-shell" dir="rtl">
        <section class="login-card">
          <div class="login-brand">
            <img
              class="login-logo"
              src="${loginLogoSrc}"
              alt="לוגו המערכת"
              width="200"
              height="86"
              decoding="async"
            />
          </div>
          <header class="ds-page-header ds-page-header--login opacity-[0.99] border-t-[0.385723px] border-r-[0.385723px] border-b-[0.385723px] border-l-[0.385723px]" aria-labelledby="loginHeading">
            <h1 id="loginHeading" class="ds-page-header__title">כניסה למערכת</h1>
            <p class="ds-page-header__subtitle">${systemTitle}</p>
          </header>

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

          <p id="loginError" class="error">${initialError}</p>
        </section>
      </div>
    `;
  },

  bind({ root, onLogin }) {
    const form = root.querySelector('#loginForm');
    const userInput = root.querySelector('#userId');
    const codeInput = root.querySelector('#entryCode');
    const submitBtn = root.querySelector('.login-submit');

    const setBusy = (busy, buttonLabel) => {
      if (userInput) userInput.disabled = busy;
      if (codeInput) codeInput.disabled = busy;
      if (submitBtn) {
        submitBtn.disabled = busy;
        submitBtn.classList.toggle('is-loading', busy);
        if (typeof buttonLabel === 'string') submitBtn.textContent = buttonLabel;
      }
    };

    form?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const errorNode = root.querySelector('#loginError');
      if (errorNode) errorNode.textContent = '';

      const userId = userInput?.value.trim() ?? '';
      const code = codeInput?.value.trim() ?? '';

      if (!userId || !code) {
        if (errorNode) errorNode.textContent = 'נא למלא מזהה משתמש וקוד כניסה';
        return;
      }

      setBusy(true, 'מתחבר...');
      try {
        await onLogin(userId, code, errorNode);
      } catch (error) {
        if (errorNode && !errorNode.textContent) errorNode.textContent = error.message;
        if (root.isConnected) setBusy(false, 'התחברות');
      }
    });

    const submitOnEnter = (event) => {
      if (event.key !== 'Enter' || event.isComposing || !form) return;
      event.preventDefault();
      form.requestSubmit();
    };

    userInput?.addEventListener('keydown', submitOnEnter);
    codeInput?.addEventListener('keydown', submitOnEnter);
  }
};

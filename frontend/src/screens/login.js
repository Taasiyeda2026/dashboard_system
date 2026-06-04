const loginLogoSrc = new URL('../../assets/logo1.png', import.meta.url).href;

export const loginScreen = {
  render(initialError = '', systemTitle = 'דשבורד תעשיידע') {
    return `
      <div class="login-shell" dir="rtl">
        <section class="login-card" role="main" aria-labelledby="loginHeading">
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

          <div class="login-header">
            <h1 id="loginHeading" class="login-header__title">התחברות פנימית לעובדים</h1>
            <p class="login-header__subtitle">כניסה מאובטחת לצפייה בדוחות האישיים שלך</p>
          </div>

          <form id="loginForm" class="login-form" novalidate>
            <div class="login-field">
              <label class="login-label" for="userId">קוד עובד</label>
              <input
                id="userId"
                class="login-input"
                required
                placeholder="הזן קוד עובד"
                autocomplete="username"
                inputmode="text"
                dir="ltr"
              />
            </div>

            <div class="login-field">
              <label class="login-label" for="entryCode">קוד גישה</label>
              <input
                id="entryCode"
                class="login-input"
                type="password"
                required
                placeholder="הזן קוד גישה"
                autocomplete="current-password"
                dir="ltr"
              />
            </div>

            <button type="submit" class="login-submit">כניסה לדוחות האישיים</button>
          </form>

          <p id="loginError" class="login-error" role="alert" aria-live="polite">${initialError}</p>

          <p class="login-footer-note">${systemTitle}</p>
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
        if (errorNode) errorNode.textContent = 'נא למלא קוד עובד וקוד גישה';
        return;
      }

      setBusy(true, 'מתחבר...');
      try {
        await onLogin(userId, code, errorNode);
      } catch (error) {
        if (errorNode && !errorNode.textContent) errorNode.textContent = error.message;
        if (root.isConnected) setBusy(false, 'כניסה לדוחות האישיים');
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

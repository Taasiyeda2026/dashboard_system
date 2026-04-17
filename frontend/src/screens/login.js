export const loginScreen = {
  render() {
    return `
      <div class="outer-shell login-shell">
        <section class="panel">
          <h1>Dashboard Login</h1>
          <p>Enter your user ID and entry code from the permissions sheet.</p>
          <form id="loginForm" class="stack">
            <input id="userId" required placeholder="User ID" autocomplete="username" />
            <input id="entryCode" required placeholder="Entry code" autocomplete="one-time-code" />
            <button type="submit">Login</button>
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

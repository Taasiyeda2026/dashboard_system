export const loginScreen = {
  render() {
    return `
      <div class="outer-shell login-shell">
        <section class="panel">
          <h1>Dashboard Login</h1>
          <p>Enter your code from the permissions sheet.</p>
          <form id="loginForm" class="stack">
            <input id="entryCode" required placeholder="Entry code" autocomplete="off" />
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
      const code = root.querySelector('#entryCode')?.value.trim();
      await onLogin(code, root.querySelector('#loginError'));
    });
  }
};

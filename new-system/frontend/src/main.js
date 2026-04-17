import { renderApp } from './app/router.js';
import { loadSession, state } from './app/state.js';
import { api } from './api/client.js';
import { CONFIG } from './config.js';

async function bootstrap() {
  loadSession();

  if (state.user) {
    try {
      await api.getBootstrap();
      state.route = CONFIG.ROUTES.dashboard;
    } catch (_e) {
      state.route = CONFIG.ROUTES.login;
    }
  }

  await renderApp(document.getElementById('root'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./public/sw.js').catch(() => {});
  }
}

bootstrap();

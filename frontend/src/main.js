import { renderApp } from './app/router.js';
import { loadSession, state, setBootstrap } from './app/state.js';
import { api } from './api/client.js';
import { CONFIG } from './config.js';

function pickInitialRoute(bootstrapPayload) {
  const modules = (bootstrapPayload?.bootstrap?.modules || []).filter((m) => m.accessible);
  if (!modules.length) return CONFIG.ROUTES.login;

  const preferred = state.user?.default_view;
  const preferredExists = modules.find((m) => m.id === preferred);
  if (preferredExists) return preferred;

  const dashboard = modules.find((m) => m.id === CONFIG.ROUTES.dashboard);
  if (dashboard) return dashboard.id;

  return modules[0].id;
}

async function bootstrap() {
  loadSession();

  if (state.user) {
    try {
      const bootstrapPayload = await api.getBootstrap();
      setBootstrap(bootstrapPayload);
      state.route = pickInitialRoute(bootstrapPayload);
    } catch (_e) {
      state.route = CONFIG.ROUTES.login;
    }
  }

  await renderApp(document.getElementById('root'));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./frontend/public/sw.js').catch(() => {});
  }
}

bootstrap();

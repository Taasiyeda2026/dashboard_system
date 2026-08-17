import { renderWelcomeScreen } from './screens/welcome-screen.js';
import { registerServiceWorker } from './services/sw-registration.service.js';

const app = document.getElementById('app');
renderWelcomeScreen(app);
registerServiceWorker();

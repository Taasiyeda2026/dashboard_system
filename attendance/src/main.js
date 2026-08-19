import { startApp } from './app.js';
import { initRound3Ui } from './round3-ui.js';
import { registerServiceWorker } from './services/sw-registration.service.js';

startApp(document.getElementById('app'), document.getElementById('bottom-nav'));
initRound3Ui(document.getElementById('app'));
registerServiceWorker();

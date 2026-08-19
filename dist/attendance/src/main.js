import { startApp } from './app.js';
import { startReferenceDataLayout } from './reference-data-layout.js';
import { registerServiceWorker } from './services/sw-registration.service.js';

startApp(document.getElementById('app'), document.getElementById('bottom-nav'));
startReferenceDataLayout();
registerServiceWorker();

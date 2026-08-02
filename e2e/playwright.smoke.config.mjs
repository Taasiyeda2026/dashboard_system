import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS_DIR, optionalEnv, SCREEN_TIMEOUT_MS } from './helpers/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseURL = optionalEnv('E2E_BASE_URL', 'https://taasiyeda2026.github.io/dashboard_system').replace(/\/+$/, '');

export default defineConfig({
  testDir: path.join(__dirname, 'smoke'),
  fullyParallel: false,
  retries: 1,
  workers: 1,
  timeout: SCREEN_TIMEOUT_MS * 2,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(ARTIFACTS_DIR, 'smoke-html-report') }]
  ],
  outputDir: path.join(ARTIFACTS_DIR, 'smoke-test-output'),
  use: {
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium-smoke',
      use: { ...devices['Desktop Chrome'] }
    }
  ]
});

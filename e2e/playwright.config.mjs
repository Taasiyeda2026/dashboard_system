import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACTS_DIR,
  AUTH_STATE_PATH,
  isCi,
  optionalEnv,
  SCREEN_TIMEOUT_MS
} from './helpers/env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseURL = optionalEnv('E2E_BASE_URL', 'http://127.0.0.1:4173').replace(/\/+$/, '');
const ci = isCi();
const startPreview = ['1', 'true', 'yes'].includes(String(process.env.E2E_START_PREVIEW || (ci ? 'true' : 'false')).toLowerCase());

export default defineConfig({
  testDir: path.join(__dirname, 'tests'),
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  timeout: SCREEN_TIMEOUT_MS,
  expect: { timeout: 20_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(ARTIFACTS_DIR, 'html-report') }],
    ['json', { outputFile: path.join(ARTIFACTS_DIR, 'results.json') }]
  ],
  outputDir: path.join(ARTIFACTS_DIR, 'test-output'),
  use: {
    baseURL,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 45_000
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.mjs/,
      testDir: __dirname,
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testMatch: /.*\.spec\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE_PATH
      }
    }
  ],
  webServer: startPreview
    ? {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !ci,
        timeout: 120_000
      }
    : undefined
});

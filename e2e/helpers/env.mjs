import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = path.resolve(__dirname, '..');
export const REPO_ROOT = path.resolve(E2E_ROOT, '..');

export function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        'Set E2E_USERNAME, E2E_PASSWORD, and E2E_BASE_URL via GitHub Secrets or local env.'
    );
  }
  return value;
}

export function optionalEnv(name, fallback = '') {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
}

export function e2eCredentials() {
  return {
    username: requiredEnv('E2E_USERNAME'),
    password: requiredEnv('E2E_PASSWORD'),
    baseURL: requiredEnv('E2E_BASE_URL').replace(/\/+$/, '')
  };
}

export function isCi() {
  return String(process.env.CI || '').toLowerCase() === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

export function shouldUpdateBaseline() {
  return ['1', 'true', 'yes'].includes(String(process.env.E2E_UPDATE_BASELINE || '').toLowerCase());
}

export const AUTH_STATE_PATH = path.join(E2E_ROOT, '.auth', 'storage-state.json');
export const BASELINE_PATH = path.join(E2E_ROOT, 'baselines', 'performance-baseline.json');
export const ARTIFACTS_DIR = path.join(E2E_ROOT, 'artifacts');
export const NETWORK_LOG_DIR = path.join(ARTIFACTS_DIR, 'network');
export const CONSOLE_LOG_DIR = path.join(ARTIFACTS_DIR, 'console');

/** Absolute budgets used as hard ceilings (ms / counts / bytes). Tuned from main baseline. */
export const ABSOLUTE_BUDGETS = {
  timeToContentMs: 12000,
  networkIdleMs: 20000,
  requestCount: 120,
  supabaseRequestCount: 80,
  jsBytes: 4_500_000,
  cssBytes: 900_000,
  longTasksOver50ms: 40,
  renderCount: 250,
  activeMutationObservers: 80
};

export const REGRESSION_RATIO = 1.2;

/**
 * Hosted runners and live Supabase response times vary between otherwise identical runs.
 * Timing metrics therefore receive a small fixed allowance in addition to the 20% ratio.
 * Counts, transferred bytes and runtime probes keep the strict ratio-only comparison.
 */
export const REGRESSION_MIN_ALLOWANCE = {
  timeToContentMs: 400,
  networkIdleMs: 500
};

export const SCREEN_TIMEOUT_MS = 90_000;

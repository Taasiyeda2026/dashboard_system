import fs from 'node:fs';
import path from 'node:path';
import { test as setup, expect } from '@playwright/test';
import { AUTH_STATE_PATH, e2eCredentials } from './helpers/env.mjs';
import { loginViaUi, waitForAppShell } from './helpers/screen.mjs';

setup('authenticate test user', async ({ page }) => {
  const { username, password } = e2eCredentials();
  fs.mkdirSync(path.dirname(AUTH_STATE_PATH), { recursive: true });

  await loginViaUi(page, { username, password });
  await expect(page.locator('.app-shell')).toBeVisible();
  await waitForAppShell(page);

  // Ensure session persisted for storageState
  const hasSession = await page.evaluate(() => {
    try {
      const keys = Object.keys(localStorage);
      return keys.some((k) => /supabase|sb-|dashboard|auth|token|session/i.test(k));
    } catch {
      return false;
    }
  });
  expect(hasSession).toBeTruthy();

  await page.context().storageState({ path: AUTH_STATE_PATH });
});

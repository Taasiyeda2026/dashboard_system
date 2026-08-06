import { test, expect } from '@playwright/test';
import { e2eCredentials, optionalEnv } from '../helpers/env.mjs';
import { loginViaUi, navigateToScreen, waitForAppShell } from '../helpers/screen.mjs';

const SMOKE_SCREENS = ['dashboard', 'activities', 'proposals-agreements'];

test.describe('Post-deploy smoke', () => {
  test('deployed commit matches expected SHA and core screens load', async ({ page, request }) => {
    test.setTimeout(180_000);
    const { username, password, baseURL } = e2eCredentials();
    const expectedSha = optionalEnv('E2E_EXPECTED_SHA', optionalEnv('GITHUB_SHA'));
    expect(expectedSha, 'E2E_EXPECTED_SHA or GITHUB_SHA is required for deploy smoke').toBeTruthy();

    // Verify build-metadata.json commit on the live site
    let metadata;
    let lastError = '';
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try {
        const res = await request.get(`${baseURL}/build-metadata.json?commit=${expectedSha}`, {
          headers: { 'Cache-Control': 'no-cache' }
        });
        if (res.ok()) {
          metadata = await res.json();
          if (metadata?.commit === expectedSha) break;
          lastError = `commit mismatch: got ${metadata?.commit}`;
        } else {
          lastError = `HTTP ${res.status()}`;
        }
      } catch (err) {
        lastError = String(err?.message || err);
      }
      await page.waitForTimeout(10_000);
    }
    expect(metadata?.commit, `Live site commit not updated (${lastError})`).toBe(expectedSha);

    await page.goto(baseURL.endsWith('/') ? baseURL : `${baseURL}/`);
    await loginViaUi(page, { username, password });
    await waitForAppShell(page);

    for (const screenKey of SMOKE_SCREENS) {
      await navigateToScreen(page, screenKey);
      await expect(page.locator(`.app-shell[data-current-route="${screenKey === 'proposals-agreements' ? 'proposals-agreements' : screenKey}"]`)).toBeVisible();
    }
  });
});

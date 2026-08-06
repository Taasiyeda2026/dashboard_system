import { test, expect } from '../fixtures/test.mjs';
import { e2eCredentials } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import { loginViaUi, waitForAppShell } from '../helpers/screen.mjs';

test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('login succeeds with dedicated E2E user', async ({ page, tracker }) => {
    tracker.resetScreen('login');
    const { username, password } = e2eCredentials();

    await loginViaUi(page, { username, password });
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('#loginForm')).toHaveCount(0);
    await waitForAppShell(page);

    const route = await page.locator('.app-shell').getAttribute('data-current-route');
    expect(route).toBeTruthy();
    expect(route).not.toBe('login');

    await tracker.persist('login');
    assertNoTransportErrors(tracker);
  });
});

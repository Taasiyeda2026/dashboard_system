import { test, expect } from '../fixtures/test.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

test('instructors screen has no top search row or scheduling button', async ({ page, tracker }) => {
  test.setTimeout(180_000);
  tracker.resetScreen('instructors-header-cleanup');

  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'instructors');
  await waitForScreenReady(page, 'instructors');

  await expect(page.locator('.ds-page-header__title')).toContainText('מדריכים');
  await expect(page.locator('[data-instructors-search]')).toHaveCount(0);
  await expect(page.locator('.ds-page-header [data-route="course-scheduling"]')).toHaveCount(0);

  await expect(page.locator('[data-instructors-active]').first()).toBeVisible();
  await expect(page.locator('[data-instructors-assignment]').first()).toBeVisible();

  await tracker.persist('instructors-header-cleanup');
  assertNoTransportErrors(tracker);
});

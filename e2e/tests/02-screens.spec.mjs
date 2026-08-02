import { test, expect } from '../fixtures/test.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import {
  SCREENS,
  basicScreenAction,
  navigateToScreen,
  setActivityPeriod,
  waitForAppShell,
  waitForScreenReady
} from '../helpers/screen.mjs';

const SCREEN_KEYS = [
  'dashboard',
  'activities',
  'week',
  'month',
  'proposals-agreements',
  'operations-management',
  'instructors',
  'contacts'
];

test.describe('Core screens load cleanly', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppShell(page);
  });

  for (const screenKey of SCREEN_KEYS) {
    test(`${SCREENS[screenKey].title} (${screenKey})`, async ({ page, tracker }) => {
      test.setTimeout(90_000);
      tracker.resetScreen(screenKey);

      await navigateToScreen(page, screenKey);
      await waitForScreenReady(page, screenKey);
      await expect(page.locator(SCREENS[screenKey].ready).first()).toBeVisible();

      await basicScreenAction(page, screenKey);
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

      await tracker.persist(screenKey);
      assertNoTransportErrors(tracker);
    });
  }

  test('2027 period does not pull 2026 season filters on activities', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    tracker.resetScreen('period-2027');

    await navigateToScreen(page, 'activities');
    await setActivityPeriod(page, 'school_2027');
    tracker.markPeriod('school_2027');
    tracker.resetScreen('activities-2027');

    // Re-enter activities after period switch to capture filtered loads
    await navigateToScreen(page, 'dashboard');
    await navigateToScreen(page, 'activities');
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    await tracker.persist('activities-2027');
    assertNoTransportErrors(tracker, { allowPeriodLeakCheck: true, expectPeriod: 'school_2027' });
  });
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import { navigateToScreen, setActivityPeriod, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');

async function screenshot(page, name) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: true });
}

test('instructor and scheduling cosmetic flow stays compact and RTL-safe', async ({ page, tracker }) => {
  test.setTimeout(120_000);
  tracker.resetScreen('instructor-scheduling-visual');
  await page.goto('/');
  await waitForAppShell(page);

  await navigateToScreen(page, 'instructors');
  await waitForScreenReady(page, 'instructors');
  await expect(page.locator('[data-instructor-card]').first()).toBeVisible();
  await screenshot(page, 'instructors-list.png');

  await page.locator('[data-instructor-card]').first().click();
  const status = page.locator('[data-instructor-status-line]');
  await expect(status).toBeVisible();
  await expect(status).toContainText(' | ');
  await expect(status.locator('.ds-status-chip')).toHaveCount(0);
  await screenshot(page, 'instructor-drawer.png');

  await page.locator('[data-edit-instructor-matching]').click();
  const matching = page.locator('.ds-modal--instructor-matching');
  await expect(matching).toBeVisible();
  await expect(matching.getByText('עברית', { exact: true })).toBeVisible();
  await expect(matching.getByText('ערבית', { exact: true })).toBeVisible();
  const matchingBox = await matching.boundingBox();
  expect(matchingBox.width).toBeLessThanOrEqual(700);
  await screenshot(page, 'instructor-matching-modal.png');
  await matching.getByRole('button', { name: 'סגירה', exact: true }).click();

  await navigateToScreen(page, 'activities');
  await setActivityPeriod(page, 'school_2027');
  await expect(page.getByText('כל פעילויות תשפ״ז', { exact: true })).toBeVisible();
  await screenshot(page, 'activities-year-labels.png');
  const unassigned = page.locator('.ds-activities-row').filter({ hasText: 'טרם שובץ' }).first();
  await expect(unassigned).toBeVisible();
  await unassigned.click();
  const drawer = page.locator('.ds-drawer--activity-inline');
  await expect(drawer).toBeVisible();
  await screenshot(page, 'activity-drawer-restored.png');
  const drawerCssHref = await page.evaluate(() => Array.from(document.styleSheets)
    .find((sheet) => {
      try { return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.ds-drawer--activity-inline')); }
      catch { return false; }
    })?.href || '');
  expect(drawerCssHref).toMatch(/\.css(?:$|\?)/);
  const drawerCssResponse = await page.request.get(drawerCssHref);
  expect(drawerCssResponse.ok()).toBe(true);
  expect(drawerCssResponse.headers()['content-type']).toContain('text/css');
  await page.locator('[data-find-instructor]').click();
  const scheduling = page.locator('.ds-modal--scheduling');
  await expect(scheduling).toBeVisible();
  await expect(scheduling.locator('.scheduling-time-range')).toHaveAttribute('dir', 'ltr');
  await expect(scheduling.locator('.scheduling-time-range')).not.toContainText(/:\d{2}:\d{2}/);
  await expect(scheduling.locator('.scheduling-workspace__dates')).toContainText(/\d{2}\.\d{2}\.\d{4}/);
  await screenshot(page, 'scheduling-modal-compact.png');

  const bodyWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(bodyWidth.scroll).toBeLessThanOrEqual(bodyWidth.client + 1);
  await tracker.persist('instructor-scheduling-visual');
  assertNoTransportErrors(tracker);
});

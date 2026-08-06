import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');

async function saveScreenshot(locator, name) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await locator.screenshot({ path: path.join(screenshotsDir, name) });
}

test('summer proposals tab contains all historical summer proposals and type filtering responds', async ({ page, tracker }) => {
  test.setTimeout(240_000);
  tracker.resetScreen('proposal-summer-list');
  await page.setViewportSize({ width: 1500, height: 1100 });

  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();

  const typeFilter = page.locator('[data-pa-filter="activity_type_group"]');
  const summerTab = page.locator('[data-pa-summer-tab]');
  const visibleRows = page.locator('[data-pa-table] tbody tr[data-pa-row-id]:visible');

  await expect(typeFilter).toBeVisible();
  await expect(summerTab).toBeVisible();
  await summerTab.click();

  await expect.poll(async () => Number(await page.locator('[data-pa-summer-count]').textContent() || 0), {
    timeout: 60_000
  }).toBe(26);
  await expect(visibleRows).toHaveCount(26, { timeout: 60_000 });
  await expect(typeFilter).toHaveValue('summer');
  await expect(summerTab).toHaveClass(/is-active/);

  const summerTexts = await visibleRows.evaluateAll((rows) => rows.map((row) => row.textContent || ''));
  expect(summerTexts.every((value) => /קיץ/.test(value))).toBe(true);
  await saveScreenshot(page.locator('[data-pa-table-region]'), 'proposal-summer-list-complete.png');

  await typeFilter.selectOption('next_year');
  await expect(summerTab).not.toHaveClass(/is-active/);
  await expect(typeFilter).toHaveValue('next_year');
  await expect.poll(async () => visibleRows.count(), { timeout: 30_000 }).toBeGreaterThan(0);
  const nextYearTexts = await visibleRows.evaluateAll((rows) => rows.map((row) => row.textContent || ''));
  expect(nextYearTexts.every((value) => !/קיץ/.test(value))).toBe(true);

  await typeFilter.selectOption('summer');
  await expect(summerTab).toHaveClass(/is-active/);
  await expect(visibleRows).toHaveCount(26, { timeout: 60_000 });

  await tracker.persist('proposal-summer-list');
  assertNoTransportErrors(tracker);
});

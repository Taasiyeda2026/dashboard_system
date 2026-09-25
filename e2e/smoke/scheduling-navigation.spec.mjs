import { test, expect } from '@playwright/test';
import { e2eCredentials } from '../helpers/env.mjs';
import { loginViaUi, navigateToScreen, waitForAppShell, waitForRoute } from '../helpers/screen.mjs';

test('scheduling navigation and safe workboard controls work on the deployed app', async ({ page }) => {
  test.setTimeout(180_000);
  const { username, password, baseURL } = e2eCredentials();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));

  await page.goto(baseURL.endsWith('/') ? baseURL : `${baseURL}/`);
  await loginViaUi(page, { username, password });
  await waitForAppShell(page);

  // Real navigation: Instructors -> Scheduling.
  await navigateToScreen(page, 'instructors');
  const schedulingTab = page.locator('[data-instructors-workspace-tab="scheduling"]').first();
  await expect(schedulingTab).toBeVisible();
  await schedulingTab.click();
  await waitForRoute(page, 'course-scheduling');
  await expect(page.locator('.course-scheduling-screen[data-cs-ui="simple-workboard-20260924-v1"]')).toBeVisible();
  await expect(page.locator('[data-instructors-workspace-tab="scheduling"][aria-selected="true"]')).toBeVisible();

  // Period navigation is local/read-only and must re-render correctly.
  const secondHalf = page.locator('[data-period-key="second"]');
  const firstHalf = page.locator('[data-period-key="first"]');
  await expect(firstHalf).toBeVisible();
  await expect(secondHalf).toBeVisible();
  await secondHalf.click();
  await expect(page.locator('[data-period-key="second"].is-active')).toBeVisible();
  await firstHalf.click();
  await expect(page.locator('[data-period-key="first"].is-active')).toBeVisible();

  // Business-state filter must be interactive and return to the full list.
  const status = page.locator('[data-business-status-filter]');
  await expect(status).toBeVisible();
  await status.selectOption('open');
  await expect(status).toHaveValue('open');
  await status.selectOption('all');
  await expect(status).toHaveValue('all');

  // Open a real activity detail through the row interaction.
  const firstCard = page.locator('[data-course-card]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page.locator('[data-course-detail].is-open')).toBeVisible();

  // Alternatives are safe UI state only. Exercise them when the saved plan exposes them.
  const alternatives = page.locator('[data-workboard-alternatives]').first();
  if (await alternatives.count() && await alternatives.isVisible()) {
    await alternatives.click();
    await expect(page.locator('.course-scheduling-workboard-alternatives').first()).toBeVisible();
  }

  // Write-capable controls are checked with Playwright trial clicks: this validates
  // hit targets/visibility without changing the shared production planning workspace.
  const writeControls = page.locator(
    '[data-run-course-planning], [data-planning-pick-option], [data-confirm-planning-draft], [data-planning-unlock], [data-confirm-actual-draft]'
  );
  const writeCount = await writeControls.count();
  expect(writeCount).toBeGreaterThan(0);
  for (let index = 0; index < Math.min(writeCount, 8); index += 1) {
    const control = writeControls.nth(index);
    if (await control.isVisible() && await control.isEnabled()) {
      await control.click({ trial: true });
    }
  }

  // Workspace navigation back to instructor list and again to scheduling.
  const listTab = page.locator('[data-instructors-workspace-tab="list"]').first();
  await expect(listTab).toBeVisible();
  await listTab.click();
  await waitForRoute(page, 'instructors');
  await expect(page.locator('[data-instructors-workspace-tab="list"][aria-selected="true"]')).toBeVisible();

  const schedulingAgain = page.locator('[data-instructors-workspace-tab="scheduling"]').first();
  await expect(schedulingAgain).toBeVisible();
  await schedulingAgain.click();
  await waitForRoute(page, 'course-scheduling');
  await expect(page.locator('.course-scheduling-screen')).toBeVisible();

  expect(pageErrors, `browser page errors: ${pageErrors.join(' | ')}`).toEqual([]);
});

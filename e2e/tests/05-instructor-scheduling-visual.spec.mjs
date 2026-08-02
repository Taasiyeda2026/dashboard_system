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

test('instructor and scheduling requirements modal stays compact and RTL-safe', async ({ page, tracker }) => {
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
  const drawer = page.locator('.ds-drawer--activity-inline');
  const activityRows = page.locator('.ds-activities-row[data-row-id]:visible');
  const rowCount = await activityRows.count();
  let schedulingActivityFound = false;
  for (let index = 0; index < rowCount; index += 1) {
    await activityRows.nth(index).click();
    await expect(drawer).toBeVisible();
    if (await drawer.locator('[data-find-instructor]:visible').count()) {
      schedulingActivityFound = true;
      break;
    }
    const activityDrawerClose = drawer.locator('.activity-drawer__close[data-action="close-drawer"]:visible');
    await expect(activityDrawerClose).toHaveCount(1);
    await activityDrawerClose.click();
    const uiLayer = page.locator('#ds-shared-ui-layer');
    await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    await expect(uiLayer).not.toHaveClass(/is-drawer-open/);
    await expect(drawer).toHaveCSS('pointer-events', 'none');
    await expect(drawer).toHaveCSS('opacity', '0');
  }
  expect(schedulingActivityFound, 'expected an existing activity with real scheduling controls').toBe(true);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'דרישות שיבוץ', exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'ניהול שיבוץ', exact: true })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'איתור מדריך', exact: true })).toHaveCount(0);
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

  await drawer.locator('[data-find-instructor]:visible').click();
  const scheduling = page.locator('.ds-modal--scheduling');
  await expect(scheduling).toBeVisible();
  await expect(scheduling.locator('.ds-modal__title')).toContainText('דרישות שיבוץ');
  await expect(scheduling.getByLabel('מגדר המדריך')).toBeVisible();
  await expect(scheduling.getByLabel('שפת הדרכה')).toBeVisible();
  await expect(scheduling.getByLabel('שכבת גיל')).toBeVisible();
  const closeRequirements = scheduling.locator('.ds-modal__footer button.ds-btn[data-ui-close-modal]');
  await expect(closeRequirements).toBeVisible();
  await expect(closeRequirements).toHaveText('סגירה');
  await expect(scheduling.getByRole('button', { name: 'שמירת דרישות השיבוץ', exact: true })).toBeVisible();
  await expect(scheduling.getByRole('button', { name: 'איתור מדריכים מתאימים', exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('מדריכים חסומים', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('מדריכים מותרים בלבד', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('הערת שיבוץ פנימית', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('מומלצים', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('מתאימים עם חריגה', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('לא מתאימים', { exact: true })).toHaveCount(0);
  await expect(scheduling.getByText('אישור ושיבוץ', { exact: true })).toHaveCount(0);
  await expect(scheduling.locator('.scheduling-time-range')).toHaveAttribute('dir', 'ltr');
  await expect(scheduling.locator('.scheduling-time-range')).not.toContainText(/:\d{2}:\d{2}/);
  const datesText = (await scheduling.locator('.scheduling-workspace__dates').innerText()).trim();
  expect(datesText === '—' || /\d{2}\.\d{2}\.\d{4}/.test(datesText)).toBe(true);
  await screenshot(page, 'scheduling-requirements-modal.png');

  const genderValue = await scheduling.locator('[name="required_instructor_gender"]').inputValue();
  const languageValue = await scheduling.locator('[name="instruction_language"]').inputValue();
  const educationValue = await scheduling.locator('[name="education_level"]').inputValue();
  expect(['any', 'female', 'male']).toContain(genderValue);
  expect(['he', 'ar']).toContain(languageValue);
  expect(['', 'elementary', 'middle_school', 'high_school']).toContain(educationValue);

  await closeRequirements.click();
  await expect(page.locator('.ds-modal--scheduling')).toHaveCount(0);
  await expect(page.locator('.ds-modal')).toHaveAttribute('aria-hidden', 'true');

  await drawer.locator('[data-find-instructor]:visible').click();
  const schedulingAgain = page.locator('.ds-modal--scheduling');
  await expect(schedulingAgain).toBeVisible();
  await expect(schedulingAgain).toHaveAttribute('aria-hidden', 'false');
  await expect(schedulingAgain.locator('[name="required_instructor_gender"]')).toHaveValue(genderValue);
  await expect(schedulingAgain.locator('[name="instruction_language"]')).toHaveValue(languageValue);
  await expect(schedulingAgain.locator('[name="education_level"]')).toHaveValue(educationValue);
  await schedulingAgain.locator('.ds-modal__footer button.ds-btn[data-ui-close-modal]').click();
  await expect(page.locator('.ds-modal--scheduling')).toHaveCount(0);
  await expect(page.locator('.ds-modal')).toHaveAttribute('aria-hidden', 'true');

  const closeOpenDrawer = async () => {
    const activityDrawerClose = drawer.locator('.activity-drawer__close[data-action="close-drawer"]:visible');
    if (await activityDrawerClose.count()) {
      await activityDrawerClose.click();
      await expect(drawer).toHaveAttribute('aria-hidden', 'true');
    }
  };
  await closeOpenDrawer();

  const bodyWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(bodyWidth.scroll).toBeLessThanOrEqual(bodyWidth.client + 1);
  await tracker.persist('instructor-scheduling-visual');
  assertNoTransportErrors(tracker);

  // Intentional leave/return checks cache freshness without folding the reload into the
  // earlier transport ledger (returning to activities re-fetches list data by design).
  tracker.resetScreen('instructor-scheduling-cache');
  await navigateToScreen(page, 'instructors');
  await waitForScreenReady(page, 'instructors');
  await navigateToScreen(page, 'activities');
  await setActivityPeriod(page, 'school_2027');
  await expect(page.getByText('כל פעילויות תשפ״ז', { exact: true })).toBeVisible();
  const rowsAfterReturn = page.locator('.ds-activities-row[data-row-id]:visible');
  const returnCount = await rowsAfterReturn.count();
  let requirementsVisibleAfterReturn = false;
  for (let index = 0; index < returnCount; index += 1) {
    await rowsAfterReturn.nth(index).click();
    await expect(drawer).toBeVisible();
    if (await drawer.locator('[data-find-instructor]:visible').count()) {
      await drawer.locator('[data-find-instructor]:visible').click();
      const reopened = page.locator('.ds-modal--scheduling');
      await expect(reopened).toBeVisible();
      await expect(reopened.getByLabel('מגדר המדריך')).toBeVisible();
      await expect(reopened.getByText('מדריכים חסומים', { exact: true })).toHaveCount(0);
      await expect(reopened.getByRole('button', { name: 'שמירת דרישות השיבוץ', exact: true })).toBeVisible();
      await expect(reopened.locator('[name="required_instructor_gender"]')).toHaveValue(genderValue);
      await expect(reopened.locator('[name="instruction_language"]')).toHaveValue(languageValue);
      await expect(reopened.locator('[name="education_level"]')).toHaveValue(educationValue);
      await screenshot(page, 'scheduling-requirements-after-navigation.png');
      await reopened.locator('.ds-modal__footer button.ds-btn[data-ui-close-modal]').click();
      await expect(page.locator('.ds-modal--scheduling')).toHaveCount(0);
      requirementsVisibleAfterReturn = true;
      break;
    }
    await closeOpenDrawer();
  }
  expect(requirementsVisibleAfterReturn).toBe(true);
  await tracker.persist('instructor-scheduling-cache');
});

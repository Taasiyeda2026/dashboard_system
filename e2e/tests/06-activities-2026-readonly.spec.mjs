import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import {
  navigateToScreen,
  readActivityPeriodLabel,
  revealListRow,
  setActivityPeriod,
  waitForAppShell,
  waitForScreenReady
} from '../helpers/screen.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const REGRESSION_ROW_ID = 'summer_2026_row_369';
const MUTATION_CONTROL_SELECTORS = [
  '[data-action="start-edit"]',
  '[data-action="save-edit"]',
  '[data-action="cancel-edit"]',
  '[data-action="delete-activity"]',
  '[data-activities-add-btn]',
  '[data-archive-reopen]',
  '[data-activity-archive-reopen]',
  '[data-find-instructor]'
];

async function screenshot(page, name) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: true });
}

/**
 * The live drawer uses the inline layout markup; the base drawer markup is the
 * fallback for screens that do not load that layout. Read either one.
 */
async function drawerFieldValue(page, label) {
  const variants = [
    { field: '.activity-drawer-inline__field', label: '.activity-drawer-inline__label', value: '.activity-drawer-inline__value' },
    { field: '.activity-view-field', label: '.activity-view-field__label', value: '.activity-view-field__value' }
  ];
  for (const variant of variants) {
    const field = page.locator(`.ds-drawer__content ${variant.field}`).filter({
      has: page.locator(variant.label, { hasText: new RegExp(`^${label}$`) })
    });
    if (!(await field.count())) continue;
    const value = (await field.first().locator(variant.value).first().innerText()).trim();
    if (value) return value;
  }
  return '';
}

/**
 * This flow crosses several screens and both periods in one test, so each phase is
 * asserted and reset on its own — otherwise the shared shell bootstrap reads of one
 * phase would look like duplicate requests in the next.
 */
async function checkPhase(page, tracker, nextPhase) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await tracker.persist(tracker.state.screen);
  assertNoTransportErrors(tracker);
  tracker.resetScreen(nextPhase);
}

async function expectNoMutationControls(page, scope) {
  for (const selector of MUTATION_CONTROL_SELECTORS) {
    await expect(
      scope.locator(`${selector}:visible`),
      `2026 must not expose ${selector}`
    ).toHaveCount(0);
  }
}

test('2026 is a complete read-only history and 2027 stays the editable default', async ({ page, tracker }) => {
  test.setTimeout(240_000);
  tracker.resetScreen('period-default-2027');

  // 1 + 2: a stale stored 2026 selection must never reopen the app on 2026.
  await page.goto('/');
  await waitForAppShell(page);
  await page.evaluate(() => {
    localStorage.setItem('dashboard_activity_period', 'regular');
    localStorage.removeItem('dashboard_activity_period_cutover_school_2027_v1');
  });
  await page.reload();
  await waitForAppShell(page);
  await expect(page.locator('[data-global-period-toggle]').first()).toHaveText('2027');
  expect(await readActivityPeriodLabel(page)).toBe('2027');
  await screenshot(page, 'default-period-2027.png');
  await checkPhase(page, tracker, 'activities-2026');

  // 3 + 4: manual 2026 selection, then open "all activities".
  await setActivityPeriod(page, 'regular');
  expect(await readActivityPeriodLabel(page)).toBe('2026');
  await navigateToScreen(page, 'activities');
  await waitForScreenReady(page, 'activities');
  await page.locator('[data-activity-period-tab="year_all"]').first().click();
  await waitForAppShell(page);

  // 5: both internal 2026 periods are present in the same table.
  const rowIds = await page.locator('.ds-data-row[data-row-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-row-id') || '')
  );
  expect(rowIds.length, 'the 2026 table must not be empty').toBeGreaterThan(0);
  expect(rowIds.some((id) => id.startsWith('summer_')), 'summer 2026 activities must be listed').toBe(true);
  expect(rowIds.some((id) => !id.startsWith('summer_')), 'regular 2026 activities must be listed').toBe(true);

  // 6 + 7: a closed row that is displayed must open the side drawer.
  const closedRow = await revealListRow(page, REGRESSION_ROW_ID);
  expect(closedRow, `${REGRESSION_ROW_ID} must be reachable in the 2026 table`).not.toBeNull();
  await closedRow.click();
  const drawerContent = page.locator('.ds-drawer__content');
  await expect(drawerContent).toBeVisible();
  await expect(drawerContent.locator('[data-drawer-form]')).toHaveCount(1);

  // 8 + 9: the open drawer must fill in with the full record, without reopening it.
  await expect(drawerContent.locator(`[data-drawer-form][data-row-id="${REGRESSION_ROW_ID}"]`)).toHaveCount(1);
  await expect
    .poll(async () => drawerFieldValue(page, 'מחיר'), { timeout: 30_000, message: 'price must load into the open drawer' })
    .toMatch(/^₪?650$/);
  expect(await drawerFieldValue(page, 'מימון')).toBe('רשות');
  expect(await drawerFieldValue(page, 'מספר משתתפים')).toBe('15');
  await expect(drawerContent.locator('[data-drawer-form]')).toHaveAttribute('data-activity-read-only', 'yes');
  await screenshot(page, 'activities-2026-full-drawer.png');

  // 10: no mutating control anywhere in 2026.
  await expectNoMutationControls(page, page.locator('.ds-drawer'));
  await page.locator('.ds-drawer__content .activity-drawer__close[data-action="close-drawer"]').first().click();
  await expect(page.locator('#ds-shared-ui-layer')).not.toHaveClass(/is-drawer-open/);
  await expectNoMutationControls(page, page.locator('#screenRoot'));
  await screenshot(page, 'activities-2026-readonly.png');
  await checkPhase(page, tracker, 'archive-2026');

  // 11 + 12: the archive shows an escape-room card with real escape-room activities.
  await navigateToScreen(page, 'archive');
  await waitForScreenReady(page, 'archive');
  const escapeRoomCard = page.locator('[data-archive-kpi="חדרי בריחה"]');
  await expect(escapeRoomCard).toHaveCount(1);
  const escapeRoomCount = Number((await escapeRoomCard.locator('.ds-archive-kpi__value').innerText()).trim());
  expect(escapeRoomCount, 'closed escape rooms must be counted in the archive').toBeGreaterThan(0);
  await escapeRoomCard.click();
  await page.waitForTimeout(400);
  await expect(page.locator('.ds-table--archive .ds-data-row[data-row-id]').first()).toBeVisible();
  await screenshot(page, 'archive-2026-escape-room.png');

  // 13: selecting 2026 in the archive year filter must not produce an empty screen.
  await page.locator('[data-archive-kpi="חדרי בריחה"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-archive-year="2026"]').click();
  await waitForAppShell(page);
  await expect(page.locator('.ds-table--archive .ds-data-row[data-row-id]').first()).toBeVisible();
  const archiveRowCount = await page.locator('.ds-table--archive .ds-data-row[data-row-id]').count();
  expect(archiveRowCount, 'the 2026 archive filter must return activities').toBeGreaterThan(0);
  await expectNoMutationControls(page, page.locator('#screenRoot'));
  await checkPhase(page, tracker, 'activities-2027');

  // 14: 2027 must not inherit the read-only state.
  await setActivityPeriod(page, 'school_2027');
  expect(await readActivityPeriodLabel(page)).toBe('2027');
  await navigateToScreen(page, 'activities');
  await waitForScreenReady(page, 'activities');
  await page.locator('[data-activity-period-tab="year_all"]').first().click();
  await waitForAppShell(page);
  const row2027 = page.locator('.ds-data-row[data-row-id]').first();
  await expect(row2027).toBeVisible();
  await row2027.click();
  await expect(page.locator('.ds-drawer__content [data-drawer-form]')).toHaveCount(1);
  await expect(page.locator('.ds-drawer__content [data-drawer-form]')).toHaveAttribute('data-activity-read-only', 'no');

  await checkPhase(page, tracker, 'activities-2026-readonly');
});

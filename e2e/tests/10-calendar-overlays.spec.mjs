import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const HEBREW_MONTHS = new Map([
  ['ינואר', 1], ['פברואר', 2], ['מרץ', 3], ['אפריל', 4], ['מאי', 5], ['יוני', 6],
  ['יולי', 7], ['אוגוסט', 8], ['ספטמבר', 9], ['אוקטובר', 10], ['נובמבר', 11], ['דצמבר', 12]
]);

function monthValue(label) {
  const normalized = String(label || '').replace(/\s+/g, ' ').trim();
  for (const [name, month] of HEBREW_MONTHS.entries()) {
    const match = new RegExp(`${name}\\s+(\\d{4})`).exec(normalized);
    if (match) return Number(match[1]) * 12 + month;
  }
  return null;
}

async function moveToMonth(page, year, month) {
  const target = year * 12 + month;
  const label = page.locator('nav[aria-label="ניווט חודשי"] .ds-cal-nav__label');
  await expect(label).toBeVisible();

  for (let attempts = 0; attempts < 36; attempts += 1) {
    const current = monthValue(await label.innerText());
    if (current === target) return;
    expect(current, 'month navigation label must be parseable').not.toBeNull();
    const selector = current < target ? '[data-month-next]' : '[data-month-prev]';
    await page.locator(selector).click();
    await expect.poll(async () => monthValue(await label.innerText()), { timeout: 20_000 }).not.toBe(current);
  }
  throw new Error(`Could not navigate to ${year}-${String(month).padStart(2, '0')}`);
}

function dayCard(page, day) {
  return page.locator('#app .ds-cal-grid .ds-cal-slot-hit:not(.is-other-month)')
    .filter({ has: page.locator('.ds-interactive-card__title', { hasText: new RegExp(`^${day}$`) }) })
    .locator('.ds-interactive-card--day-cell')
    .first();
}

test('month view shows team tasks, future school holidays and birthdays together', async ({ page, tracker }) => {
  test.setTimeout(240_000);
  tracker.resetScreen('calendar-overlays');
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'month');
  await waitForScreenReady(page, 'month');

  await moveToMonth(page, 2026, 8);
  const august2 = dayCard(page, 2);
  await expect(august2).toBeVisible();
  await expect(august2.locator('[data-team-calendar-label="month"]')).toContainText('מיפוי קורסים');
  await expect(august2.locator('[data-team-calendar-label="month"]')).toContainText('מיפוי מדריכים');
  await expect(august2.locator('[data-team-calendar-label="month"]')).toContainText('סגירת שנת תשפ״ו');
  await expect(august2.locator('[data-team-calendar-label="month"]')).toContainText('ועוד 0').toHaveCount(0);

  const august13 = dayCard(page, 13);
  await expect(august13.locator('[data-team-calendar-label="month"]')).toContainText('חופשה - גיל');
  await expect(august13.locator('[data-team-calendar-label="month"]')).toContainText('חופשה - טוני');
  await expect(august13.locator('[data-team-calendar-label="month"]')).toContainText('חופשה - עידן');

  await fs.mkdir(screenshotsDir, { recursive: true });
  await page.locator('#app .ds-cal-wrap').screenshot({ path: path.join(screenshotsDir, 'calendar-august-team-events.png') });

  await moveToMonth(page, 2026, 9);
  const september1 = dayCard(page, 1);
  await expect(september1.locator('[data-team-calendar-label="month"]')).toContainText('גיוס מדריכים');
  await expect(september1.locator('[data-team-calendar-label="month"]')).toContainText('ועוד 2');

  const september11 = dayCard(page, 11);
  await expect(september11.locator('[data-school-calendar-label]')).toContainText('ראש השנה');

  const september19 = dayCard(page, 19);
  await expect(september19.locator('[data-birthday-calendar-label="month"]')).toContainText('איסראא אבו ראס');

  // The independent overlays must coexist without replacing one another.
  await expect(page.locator('[data-team-calendar-label="month"]')).not.toHaveCount(0);
  await expect(page.locator('[data-school-calendar-label]')).not.toHaveCount(0);
  await expect(page.locator('[data-birthday-calendar-label="month"]')).not.toHaveCount(0);

  await page.locator('#app .ds-cal-wrap').screenshot({ path: path.join(screenshotsDir, 'calendar-september-holidays-birthday-tasks.png') });
  await tracker.persist('calendar-overlays');
  assertNoTransportErrors(tracker);
});

import { test, expect } from '../fixtures/test.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

async function moveToMonth(page, targetLabel) {
  const label = page.locator('nav[aria-label="ניווט חודשי"] .ds-cal-nav__label');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = (await label.innerText()).replace(/\s+/g, ' ').trim();
    if (current.includes(targetLabel)) return;
    const [, currentYear] = current.match(/(20\d{2})/) || [];
    const targetYear = Number(targetLabel.match(/20\d{2}/)?.[0]);
    const months = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    const currentMonth = months.findIndex((month) => current.includes(month));
    const targetMonth = months.findIndex((month) => targetLabel.includes(month));
    const currentIndex = Number(currentYear) * 12 + currentMonth;
    const targetIndex = targetYear * 12 + targetMonth;
    await page.locator(targetIndex > currentIndex ? '[data-month-next]' : '[data-month-prev]').click();
    await expect(label).not.toHaveText(current, { timeout: 15_000 });
  }
  throw new Error(`Could not navigate to ${targetLabel}`);
}

function dayCard(page, day) {
  return page.locator('.ds-cal-slot-hit:not(.is-other-month) .ds-interactive-card--day-cell')
    .filter({ has: page.locator('.ds-interactive-card__title', { hasText: new RegExp(`^${day}$`) }) });
}

test('direct month navigation renders team tasks, school holidays and birthdays without collisions', async ({ page, tracker }) => {
  test.setTimeout(300_000);
  tracker.resetScreen('calendar-layers');
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'month');
  await waitForScreenReady(page, 'month');

  await moveToMonth(page, 'אוגוסט 2026');
  const august2 = dayCard(page, 2);
  await expect(august2).toContainText('מיפוי קורסים');
  await expect(august2).toContainText('תזכורת למשוב קיץ לצוות החינוכי');
  await expect(august2).toContainText('מיפוי מדריכים');
  await expect(august2).toContainText('סגירת שנת תשפ״ו');
  const august13 = dayCard(page, 13);
  await expect(august13).toContainText('חופשה - גיל');
  await expect(august13).toContainText('חופשה - טוני');
  await expect(august13).toContainText('חופשה - עידן');

  await moveToMonth(page, 'ספטמבר 2026');
  const september1 = dayCard(page, 1);
  await expect(september1.locator('.team-calendar-task')).toHaveCount(4);
  await expect(september1.locator('.team-calendar-more')).toHaveText('ועוד 2');
  await september1.locator('.team-calendar-more').click();
  await expect(september1.locator('.team-calendar-task')).toHaveCount(6);
  await expect(page.locator('[data-school-calendar-label]')).not.toHaveCount(0);
  await expect(page.locator('[data-birthday-calendar-label]')).not.toHaveCount(0);
  await expect(page.locator('.team-calendar-tasks')).not.toHaveCount(0);

  await tracker.persist('calendar-layers');
  assertNoTransportErrors(tracker);
});

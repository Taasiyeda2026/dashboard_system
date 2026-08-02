import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const amountOf = (value) => Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;

async function positiveOption(select, preferredPattern = null) {
  return select.locator('option:not([value=""])').evaluateAll((options, patternSource) => {
    const pattern = patternSource ? new RegExp(patternSource) : null;
    const rows = options.filter((option) => !option.value.startsWith('__') && /₪\s*[1-9]/.test(option.textContent || ''));
    return (pattern ? rows.find((option) => pattern.test(option.textContent || '')) : rows[0])?.value || '';
  }, preferredPattern?.source || null);
}

async function screenshot(locator, name) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await locator.screenshot({ path: path.join(screenshotsDir, name) });
}

test('proposal workflow exposes summer tab, fast editor, live totals and combined next-year document', async ({ page, tracker }) => {
  test.setTimeout(300_000);
  tracker.resetScreen('proposal-workflow-completion');
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');

  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  const typeFilter = page.locator('[data-pa-filter="activity_type_group"]');
  await expect(typeFilter).toBeVisible();
  await expect(typeFilter.locator('option[value="next_year"]')).toHaveText('תשפ״ז');
  await expect(typeFilter.locator('option[value="gefen"]')).toContainText('גפ');
  await expect(typeFilter.locator('option[value="summer"]')).toHaveText('קיץ');
  await expect(page.locator('[data-pa-summer-tab]')).toBeVisible();

  await page.waitForTimeout(1000);
  const startedAt = Date.now();
  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible({ timeout: 10_000 });
  expect(Date.now() - startedAt).toBeLessThan(5000);

  // GEFEN uses the generic activity editor rather than a grouped section.
  await form.locator('[data-pa-type-btn="gefen"]').click();
  let gefenRows = form.locator('[data-pa-item-row]');
  if (await gefenRows.count() === 0) {
    await form.locator('[data-pa-add-item]:visible').first().click();
    gefenRows = form.locator('[data-pa-item-row]');
  }
  await expect(gefenRows).not.toHaveCount(0);
  const gefenRow = gefenRows.first();
  const gefenSelect = gefenRow.locator('[data-pa-pricing-select]');
  const gefenOption = await positiveOption(gefenSelect);
  expect(gefenOption).not.toBe('');
  await gefenSelect.selectOption(gefenOption);
  await expect(gefenRow.locator('[data-pa-item-price]')).not.toHaveValue('');
  const gefenPrice = amountOf(await gefenRow.locator('[data-pa-item-price]').inputValue());
  expect(gefenPrice).toBeGreaterThan(0);
  await gefenRow.locator('[data-pa-item-qty]').fill('2');
  await expect.poll(async () => amountOf(await gefenRow.locator('[data-pa-item-total]').inputValue())).toBe(gefenPrice * 2);
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText())).toBe(gefenPrice * 2);

  // Build a mixed תשפ״ז document without saving the proposal.
  await form.locator('[data-pa-type-btn="next_year"]').click();
  const courses = form.locator('[data-pa-items-group="next_year_courses"]');
  const workshops = form.locator('[data-pa-items-group="next_year_workshops"]');
  await expect(courses).toHaveCount(1);
  await expect(workshops).toHaveCount(1);
  await courses.locator('[data-pa-add-item]').click();
  const courseRow = courses.locator('[data-pa-item-row]').first();
  const courseSelect = courseRow.locator('[data-pa-pricing-select]');
  const premiumOption = await positiveOption(courseSelect, /אופק יזמות פרימיום/);
  expect(premiumOption).not.toBe('');
  await courseSelect.selectOption(premiumOption);

  await workshops.locator('[data-pa-add-item]').click();
  const workshopRow = workshops.locator('[data-pa-item-row]').first();
  const workshopSelect = workshopRow.locator('[data-pa-pricing-select]');
  const workshopOption = await positiveOption(workshopSelect);
  expect(workshopOption).not.toBe('');
  await workshopSelect.selectOption(workshopOption);
  await expect(workshopRow.locator('[name="proposal_group"]')).toHaveValue('next_year_workshops');
  await expect(workshopRow.locator('[name="item_type"]')).toHaveValue(/סדנה/);
  await expect(workshopRow.locator('[name="item_name"]')).not.toHaveValue('');
  await expect(workshopRow.locator('[data-pa-item-price]')).not.toHaveValue('');

  const livePreview = page.getByRole('region', { name: 'תצוגת מסמך A4' });
  await expect(livePreview.locator('.pa-next-year-course-table tbody tr')).not.toHaveCount(0);
  await expect(livePreview.locator('.pa-next-year-workshop-table tbody tr')).not.toHaveCount(0);
  await expect(livePreview.locator('.pa-next-year-combined-total')).toBeVisible();
  await expect(livePreview).toContainText('להלן הפעילויות המוצעות לשנת הלימודים תשפ״ז');
  await expect(livePreview).toContainText('סדנאות מייקרים STEM');
  await expect(livePreview).not.toContainText('ההצעה יכולה לכלול קורסים, סדנאות או שילוב ביניהם');
  await screenshot(livePreview, 'proposal-next-year-combined-document.png');

  await form.locator('[data-pa-cancel-form]').first().click();
  await page.locator('[data-pa-summer-tab]').click();
  await expect(typeFilter).toHaveValue('summer');
  const visibleRows = page.locator('[data-pa-table] tbody tr[data-pa-row-id]:visible');
  await expect(visibleRows).not.toHaveCount(0);
  const visibleTypes = await visibleRows.evaluateAll((rows) => rows.map((row) => row.textContent || ''));
  expect(visibleTypes.every((value) => /קיץ/.test(value))).toBe(true);
  await screenshot(page.locator('[data-pa-table]').first(), 'proposal-summer-tab.png');

  await tracker.persist('proposal-workflow-completion');
  assertNoTransportErrors(tracker);
});

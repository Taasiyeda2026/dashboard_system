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

test('GEFEN multi-row course selection has one bounded update path', async ({ page, tracker }) => {
  test.setTimeout(180_000);
  tracker.resetScreen('proposal-gefen-multi-row-selection');
  await page.setViewportSize({ width: 1500, height: 1100 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible();
  await form.locator('[data-pa-type-btn="gefen"]').click();

  await page.evaluate(() => {
    const editor = document.querySelector('[data-pa-form]');
    const preview = editor?.querySelector('[data-pa-live-preview]');
    window.__gefenSelectionProbe = { changes: 0, inputs: 0, previewMutations: 0 };
    editor?.addEventListener('change', (event) => {
      if (event.target.matches('[data-pa-pricing-select]')) window.__gefenSelectionProbe.changes += 1;
    }, true);
    editor?.addEventListener('input', (event) => {
      if (event.target.closest('[data-pa-item-row]')) window.__gefenSelectionProbe.inputs += 1;
    }, true);
    if (preview) new MutationObserver((records) => {
      window.__gefenSelectionProbe.previewMutations += records.length;
    }).observe(preview, { childList: true, subtree: true, characterData: true });
  });

  const rows = form.locator('[data-pa-item-row]');
  const add = form.locator('[data-pa-add-item]:visible').first();
  if (await rows.count() === 0) await add.click();
  const options = await rows.first().locator('[data-pa-pricing-select] option:not([value=""])').evaluateAll((all) => {
    const priced = all.filter((option) => !option.value.startsWith('__') && /₪\s*[1-9]/.test(option.textContent || ''));
    const biomimicry = priced.find((option) => /ביומימיקרי/.test(option.textContent || '') && /6089/.test(option.textContent || ''));
    return [biomimicry, ...priced.filter((option) => option !== biomimicry)].filter(Boolean).map((option) => option.value);
  });
  expect(options.length).toBeGreaterThanOrEqual(3);

  const assertEditor = async (expectedRows) => {
    await expect(rows).toHaveCount(expectedRows);
    const values = await rows.evaluateAll((items) => items.map((row) => ({
      name: row.querySelector('[name="item_name"]')?.value || '',
      quantity: Number(row.querySelector('[data-pa-item-qty]')?.value || 0),
      price: Number(row.querySelector('[data-pa-item-price]')?.value || 0),
      total: Number(row.querySelector('[data-pa-item-total]')?.value || 0)
    })));
    for (const value of values) {
      expect(value.name).not.toBe('');
      expect(value.price).toBeGreaterThan(0);
      expect(value.total).toBe(value.quantity * value.price);
      await expect(form.locator('[data-pa-live-preview]')).toContainText(value.name);
    }
    expect(amountOf(await form.locator('[data-pa-grand-total]').innerText()))
      .toBe(values.reduce((sum, value) => sum + value.total, 0));
  };
  const selectTimed = async (row, value) => {
    const started = Date.now();
    await row.locator('[data-pa-pricing-select]').selectOption(value, { timeout: 10_000 });
    const selectedName = (await row.locator('[data-pa-pricing-select] option:checked').innerText()).split('—')[0].trim();
    await expect(row.locator('[name="item_name"]')).toHaveValue(selectedName);
    expect(Date.now() - started).toBeLessThan(10_000);
  };

  await selectTimed(rows.nth(0), options[0]);
  await assertEditor(1);
  await add.click();
  await selectTimed(rows.nth(1), options[1]);
  await assertEditor(2);
  await add.click();
  await selectTimed(rows.nth(2), options[2]);
  await assertEditor(3);
  await selectTimed(rows.nth(1), options[2]);
  await assertEditor(3);
  page.on('dialog', (dialog) => dialog.accept());
  await rows.nth(1).locator('[data-pa-remove-item]').click();
  await assertEditor(2);
  await add.click();
  await selectTimed(rows.nth(2), options[1]);
  await assertEditor(3);

  const probe = await page.evaluate(() => window.__gefenSelectionProbe);
  expect(probe.changes).toBe(5);
  expect(probe.inputs).toBeLessThanOrEqual(5);
  expect(probe.previewMutations).toBeLessThan(100);
  expect(tracker.state.pageErrors).toEqual([]);
  await screenshot(form, 'proposal-gefen-three-row-stable.png');
  await form.locator('[data-pa-cancel-form]').first().click();
  await tracker.persist('proposal-gefen-multi-row-selection');
  assertNoTransportErrors(tracker);
});

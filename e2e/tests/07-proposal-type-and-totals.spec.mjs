import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const ALLOWED_TYPE_LABELS = new Set(['תשפ״ז', 'גפן', 'קיץ', 'סיור', '—', '']);
const FORBIDDEN_TYPE_LABELS = ['תשפ״ז (קורסים)', 'תשפ״ז (סדנאות)', 'תשפ״ז (קורסים וסדנאות)'];
const LONG_EMAIL = 'proposal.contact.longname@municipality-example.invalid';
const LONG_PHONE = '050-1234567';

async function screenshot(page, name) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await page.screenshot({ path: path.join(screenshotsDir, name), fullPage: true });
}

/**
 * The flow crosses the list and the editor, so each phase persists and asserts its
 * own console/network log instead of accumulating shell bootstrap reads.
 */
async function checkPhase(page, tracker, nextPhase) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await tracker.persist(tracker.state.screen);
  assertNoTransportErrors(tracker);
  tracker.resetScreen(nextPhase);
}

async function fieldFitsItsValue(locator) {
  return locator.evaluate((element) => element.scrollWidth <= element.clientWidth + 1);
}

async function addRowInArea(page, form, groupKey, { unitPrice = '1500' } = {}) {
  const section = form.locator(`[data-pa-items-group="${groupKey}"]`);
  await expect(section).toHaveCount(1);
  await section.locator('[data-pa-add-item]').first().click();
  const row = section.locator('[data-pa-item-row]').last();
  const select = row.locator('[data-pa-pricing-select]');
  const value = await select.locator('option').evaluateAll((options) => options
    .map((option) => option.value)
    .find((option) => option && !option.startsWith('__')) || '');
  expect(value, `expected a real priced activity for ${groupKey}`).not.toBe('');
  await select.selectOption(value);

  // Catalog entries without a stored unit price leave the row at zero; entering the
  // price is the same edit a user makes and keeps the totals assertion deterministic.
  const total = row.locator('[data-pa-item-total-display]');
  await page.waitForTimeout(400);
  if (amountOf(await total.innerText()) === 0) {
    // The price lives in the row's collapsed details block.
    const toggle = row.locator('[data-pa-item-edit-toggle]');
    if (await toggle.count()) await toggle.first().click();
    const price = row.locator('[data-pa-item-price]');
    await expect(price).toBeVisible();
    await price.fill(unitPrice);
    await price.dispatchEvent('input');
    await expect.poll(async () => amountOf(await total.innerText()), { timeout: 15_000 }).toBeGreaterThan(0);
  }
  return { section, row };
}

function amountOf(value) {
  const match = String(value).replace(/\u00a0/g, ' ').match(/([\d,]+)/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

test('proposal types, school alignment, תשפ״ז areas and live totals stay correct', async ({ page, tracker }) => {
  test.setTimeout(240_000);
  tracker.resetScreen('proposal-list-types');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');

  // 1 + 2: the list shows main types only and keeps the school column right aligned.
  // The proposals table lives in the "all proposals" view, not in the client home.
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  const table = page.locator('[data-pa-all-proposals-table] [data-pa-table]').first();
  await expect(table).toBeVisible();
  await expect(table.locator('tbody tr[data-pa-row-id]').first()).toBeVisible();

  const typeLabels = await table.locator('tbody tr[data-pa-row-id] td:nth-child(5)').evaluateAll(
    (cells) => cells.map((cell) => cell.textContent.trim())
  );
  expect(typeLabels.length, 'the proposals list must contain rows').toBeGreaterThan(0);
  typeLabels.forEach((label) => {
    expect(ALLOWED_TYPE_LABELS.has(label), `unexpected proposal type label "${label}"`).toBe(true);
  });
  const tableText = await table.innerText();
  FORBIDDEN_TYPE_LABELS.forEach((label) => {
    expect(tableText.includes(label), `"${label}" must not appear in the list`).toBe(false);
  });

  const schoolHeader = table.locator('thead th.ds-pa-school-col');
  await expect(schoolHeader).toHaveCount(1);
  await expect(schoolHeader).toHaveCSS('text-align', 'right');
  const schoolCells = table.locator('tbody tr[data-pa-row-id] td.ds-pa-school-col');
  expect(await schoolCells.count()).toBe(typeLabels.length);
  const cellAlignments = await schoolCells.evaluateAll((cells) => cells.map((cell) => getComputedStyle(cell).textAlign));
  cellAlignments.forEach((alignment) => expect(alignment).toBe('right'));
  await screenshot(page, 'proposal-list-types-school-alignment.png');
  await checkPhase(page, tracker, 'proposal-editor-totals');

  // 3 + 4: open a new תשפ״ז proposal and fill both internal areas. Nothing is saved.
  await page.locator('[data-pa-back-to-client-home]:visible').first().click();
  const newProposal = page.locator('[data-pa-client-home]:visible [data-pa-client-add-proposal]:visible').first();
  await expect(newProposal).toBeVisible();
  await newProposal.click();
  const form = page.locator('[data-pa-screen][data-pa-view-mode="proposal-editor"]:visible [data-pa-form]:visible').first();
  await expect(form).toBeVisible();

  await form.locator('[data-pa-type-btn="next_year"]').click();
  await expect(form.locator('[data-pa-items-group="next_year_courses"]')).toHaveCount(1);
  await expect(form.locator('[data-pa-items-group="next_year_workshops"]')).toHaveCount(1);
  await expect(form.locator('[data-pa-items-group="next_year_courses"] .ds-pa-items-section-label'))
    .toHaveText('קורסים ותוכניות');
  await expect(form.locator('[data-pa-items-group="next_year_workshops"] .ds-pa-items-section-label'))
    .toHaveText('סדנאות');

  const coursesTotal = form.locator('[data-pa-group-total="next_year_courses"]');
  const workshopsTotal = form.locator('[data-pa-group-total="next_year_workshops"]');
  const grandTotal = form.locator('[data-pa-grand-total]').first();

  const courses = await addRowInArea(page, form, 'next_year_courses');
  await expect.poll(async () => amountOf(await coursesTotal.innerText()), { timeout: 15_000 }).toBeGreaterThan(0);
  const coursesOnly = amountOf(await coursesTotal.innerText());
  expect(amountOf(await grandTotal.innerText())).toBe(coursesOnly);

  const workshops = await addRowInArea(page, form, 'next_year_workshops');
  await expect.poll(async () => amountOf(await workshopsTotal.innerText()), { timeout: 15_000 }).toBeGreaterThan(0);

  // The combined total always equals the two areas together.
  await expect.poll(async () => {
    const courseValue = amountOf(await coursesTotal.innerText());
    const workshopValue = amountOf(await workshopsTotal.innerText());
    return amountOf(await grandTotal.innerText()) - (courseValue + workshopValue);
  }, { timeout: 15_000 }).toBe(0);

  // A quantity change updates the area total and the combined total immediately.
  const beforeQuantity = amountOf(await coursesTotal.innerText());
  const quantity = courses.row.locator('[data-pa-item-qty]');
  await expect(quantity).toBeVisible();
  await quantity.fill('3');
  await quantity.dispatchEvent('input');
  await expect.poll(async () => amountOf(await coursesTotal.innerText()), { timeout: 15_000 })
    .toBeGreaterThan(beforeQuantity);
  await expect.poll(async () => {
    const courseValue = amountOf(await coursesTotal.innerText());
    const workshopValue = amountOf(await workshopsTotal.innerText());
    return amountOf(await grandTotal.innerText()) - (courseValue + workshopValue);
  }, { timeout: 15_000 }).toBe(0);
  await screenshot(page, 'proposal-live-total.png');

  // 5: the preview shows both tables, each with its own summary, plus one combined total.
  const preview = form.locator('[data-pa-live-preview]');
  await expect(preview).toBeVisible();
  await expect.poll(async () => preview.locator('.pa-next-year-workshop-table').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await expect(preview.locator('.pa-next-year-course-table')).toHaveCount(1);
  await expect(preview.locator('.pa-next-year-course-table tbody tr')).not.toHaveCount(0);
  await expect(preview.locator('.pa-next-year-workshop-table tbody tr')).not.toHaveCount(0);
  await expect(preview.locator('.pa-next-year-course-table tfoot')).toContainText('סה״כ קורסים');
  await expect(preview.locator('.pa-next-year-workshop-table tfoot')).toContainText('סה״כ סדנאות');
  const combined = preview.locator('.pa-next-year-combined-total');
  await expect(combined).toHaveCount(1);
  await expect(combined).toContainText('סה״כ לתשלום');
  const previewText = await preview.innerText();
  FORBIDDEN_TYPE_LABELS.forEach((label) => {
    expect(previewText.includes(label), `"${label}" must not appear in the document`).toBe(false);
  });
  expect(await workshops.section.locator('[data-pa-item-row]').count()).toBeGreaterThan(0);
  await screenshot(page, 'proposal-tashpaz-dual-tables.png');

  // 6: contact mobile and email must show their whole value in update mode.
  const otherType = form.locator('.ds-pa-recipient-type-option').filter({
    has: page.locator('input[name="client_type_selector"][value="other"]')
  });
  await expect(otherType).toHaveCount(1);
  await otherType.click();
  const phone = form.locator('input[name="phone"]:visible').first();
  const email = form.locator('input[name="email"]:visible').first();
  await expect(phone).toBeVisible();
  await expect(email).toBeVisible();
  await phone.fill(LONG_PHONE);
  await email.fill(LONG_EMAIL);
  expect(await fieldFitsItsValue(phone), 'the mobile field must show its full value').toBe(true);
  expect(await fieldFitsItsValue(email), 'the email field must show its full value').toBe(true);
  const phoneBox = await phone.boundingBox();
  const emailBox = await email.boundingBox();
  expect(phoneBox.width).toBeGreaterThanOrEqual(200);
  expect(emailBox.width).toBeGreaterThanOrEqual(340);
  await screenshot(page, 'proposal-contact-fields-width.png');

  // Nothing was saved: the editor is still open on an unsaved proposal.
  expect(await form.getAttribute('data-pa-id')).toBeFalsy();
  await checkPhase(page, tracker, 'proposal-type-and-totals');
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

const screenshotsDir = path.join(ARTIFACTS_DIR, 'screenshots');
const amountOf = (value) => Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;

async function shot(page, name, locator = page) {
  await fs.mkdir(screenshotsDir, { recursive: true });
  await locator.screenshot({ path: path.join(screenshotsDir, name), fullPage: locator === page });
}

async function openRowAction(row, selector) {
  let action = row.locator(`${selector}:visible`).first();
  if (!(await action.count())) {
    const more = row.locator('.ds-pa-row-more summary');
    if (await more.count()) await more.click();
    action = row.locator(selector).first();
  }
  await expect(action).toBeVisible();
  await action.click();
}

async function openDetailPreview(page, row) {
  await openRowAction(row, '[data-pa-preview]');
  const detail = page.locator('[data-pa-proposal-detail]:visible');
  await expect(detail).toBeVisible();
  const previewAction = detail.locator('[data-pa-preview]').first();
  await expect(previewAction).toBeVisible();
  await previewAction.click();
  const preview = page.locator('.proposal-preview-area:visible');
  await expect(preview.locator('.proposal-document').first()).toBeVisible();
  return { detail, preview };
}

async function assertNoOverlap(container) {
  const result = await container.evaluate((root) => {
    const elements = [...root.querySelectorAll('input, select, button, [data-pa-contact-channels-status]:not([hidden])')]
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }));
    const overlap = elements.some((left, index) => elements.slice(index + 1).some((right) =>
      left.rect.left < right.rect.right - 1 && left.rect.right > right.rect.left + 1
      && left.rect.top < right.rect.bottom - 1 && left.rect.bottom > right.rect.top + 1));
    return { overflow: root.scrollWidth > root.clientWidth + 1, overlap };
  });
  expect(result).toEqual({ overflow: false, overlap: false });
}

async function firstPositivePriceOption(select) {
  return select.locator('option:not([value=""])').evaluateAll((options) => {
    const option = options.find((item) => !item.value.startsWith('__') && /₪\s*[1-9]/.test(item.textContent || ''));
    return option?.value || '';
  });
}

async function expectSelectedLabelMatchesInternalPrice(row) {
  const selectedLabel = await row.locator('[data-pa-pricing-select] option:checked').innerText();
  const labelPrice = amountOf(selectedLabel);
  const internalPrice = amountOf(await row.locator('[data-pa-item-price]').inputValue());
  expect(labelPrice).toBeGreaterThan(0);
  expect(internalPrice).toBe(labelPrice);
}

async function selectGefenCourse(row, matcher) {
  const select = row.locator('[data-pa-pricing-select]');
  const value = await select.locator('option').evaluateAll((options, source) => {
    const pattern = new RegExp(source, 'i');
    return options.find((option) => option.value && !option.value.startsWith('__') && pattern.test(`${option.value} ${option.textContent || ''}`))?.value || '';
  }, matcher.source);
  expect(value, `expected Gefen option matching ${matcher}`).not.toBe('');
  await select.selectOption(value, { timeout: 10_000 });
  return value;
}

test('Gefen stays responsive while selecting, replacing, removing and re-adding multiple courses', async ({ page, tracker }) => {
  test.setTimeout(180_000);
  tracker.resetScreen('proposal-gefen-multi-row-responsiveness');
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible();
  await form.locator('[data-pa-type-btn="gefen"]').click();

  await form.evaluate((element) => {
    window.__gefenRegressionCounters = { change: 0, input: 0, previewMutations: 0 };
    element.addEventListener('change', (event) => {
      if (event.target?.matches?.('[data-pa-pricing-select]')) window.__gefenRegressionCounters.change += 1;
    }, true);
    element.addEventListener('input', (event) => {
      if (event.target?.matches?.('[data-pa-item-price]')) window.__gefenRegressionCounters.input += 1;
    }, true);
    const preview = element.querySelector('[data-pa-live-preview]');
    if (preview) new MutationObserver(() => { window.__gefenRegressionCounters.previewMutations += 1; })
      .observe(preview, { childList: true, subtree: true });
  });

  const add = form.locator('[data-pa-add-item]:visible').first();
  await add.click();
  let rows = form.locator('[data-pa-item-row]');
  await expect(rows).toHaveCount(1);
  await selectGefenCourse(rows.nth(0), /6089|ביומימיקרי/);
  await expectSelectedLabelMatchesInternalPrice(rows.nth(0));

  await add.click();
  await expect(rows).toHaveCount(2);
  const secondAlternative = await rows.nth(1).locator('[data-pa-pricing-select] option').evaluateAll((options) =>
    options.find((option) => option.value && !option.value.startsWith('__') && !/6089|ביומימיקרי/.test(`${option.value} ${option.textContent || ''}`))?.value || '');
  expect(secondAlternative).not.toBe('');
  await rows.nth(1).locator('[data-pa-pricing-select]').selectOption(secondAlternative, { timeout: 10_000 });
  await expectSelectedLabelMatchesInternalPrice(rows.nth(1));

  await add.click();
  await expect(rows).toHaveCount(3);
  await selectGefenCourse(rows.nth(2), /6089|ביומימיקרי/);
  await expectSelectedLabelMatchesInternalPrice(rows.nth(2));

  await selectGefenCourse(rows.nth(1), /6089|ביומימיקרי/);
  await rows.nth(0).locator('[data-pa-pricing-select]').selectOption(secondAlternative, { timeout: 10_000 });
  await expectSelectedLabelMatchesInternalPrice(rows.nth(0));
  const expectedTotal = await rows.evaluateAll((items) => items.reduce((sum, row) => {
    const qty = Number(row.querySelector('[data-pa-item-qty]')?.value) || 0;
    const price = Number(row.querySelector('[data-pa-item-price]')?.value) || 0;
    return sum + qty * price;
  }, 0));
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText())).toBe(expectedTotal);
  await expect(form.locator('[data-pa-live-preview] .proposal-document')).toHaveCount(1);

  page.on('dialog', (dialog) => dialog.accept());
  await rows.nth(1).locator('[data-pa-remove-item]').click();
  await expect(rows).toHaveCount(2);
  await add.click();
  await expect(rows).toHaveCount(3);
  const readdedAlternative = await firstPositivePriceOption(rows.nth(2).locator('[data-pa-pricing-select]'));
  await rows.nth(2).locator('[data-pa-pricing-select]').selectOption(readdedAlternative, { timeout: 10_000 });
  await expectSelectedLabelMatchesInternalPrice(rows.nth(2));

  const counters = await page.evaluate(() => window.__gefenRegressionCounters);
  expect(counters.change).toBe(7);
  expect(counters.input).toBeLessThanOrEqual(1);
  expect(counters.previewMutations).toBeLessThanOrEqual(12);
  expect(pageErrors).toEqual([]);
  await tracker.persist('proposal-gefen-multi-row-responsiveness');
  assertNoTransportErrors(tracker);
});

test('real proposal regression path remains stable without saving data or PDFs', async ({ page, tracker }) => {
  test.setTimeout(300_000);
  tracker.resetScreen('proposal-focused-regressions');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  const table = page.locator('[data-pa-all-proposals-table] [data-pa-table]').first();
  await expect(table).toBeVisible();

  const approved = table.locator('tbody tr[data-pa-row-id]').filter({ hasText: 'מאושר' }).first();
  await expect(approved).toBeVisible();
  const firstPreview = await openDetailPreview(page, approved);
  const preview = firstPreview.preview;
  await expect(preview).not.toContainText('לא נמצאה תבנית פעילה לסוג הצעה זה');
  await expect(preview.locator('.pa-section, .pa-org-intro')).not.toHaveCount(0);
  await shot(page, 'proposal-full-template.png', preview);
  await page.locator('#pa-preview-close').click();
  await page.locator('[data-pa-proposal-detail-back]:visible').first().click();
  await expect(table).toBeVisible();

  // Use the real new-proposal editor so the regression test does not depend on
  // whether production currently contains an editable draft. The form is always
  // cancelled, so no proposal or item is persisted.
  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible();
  await form.locator('[data-pa-type-btn="next_year"]').click();

  const courses = form.locator('[data-pa-items-group="next_year_courses"]');
  const workshops = form.locator('[data-pa-items-group="next_year_workshops"]');
  await expect(courses).toHaveCount(1);
  await expect(workshops).toHaveCount(1);
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(0);
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(0);

  await courses.locator('[data-pa-add-item]').click();
  const courseRow = courses.locator('[data-pa-item-row]').first();
  await expect(courseRow).toBeVisible();
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(1);
  const courseSelect = courseRow.locator('[data-pa-pricing-select]');
  const premiumOption = await courseSelect.locator('option').evaluateAll((options) => {
    const preferred = options.find((item) => /אופק יזמות פרימיום/.test(item.textContent || '') && /13,500/.test(item.textContent || ''));
    return preferred?.value || '';
  });
  expect(premiumOption, 'the 13,500 ₪ next-year course must be available').not.toBe('');
  await courseSelect.selectOption(premiumOption);
  await expect(courseRow.locator('[data-pa-item-price]')).toHaveValue('13500');
  await expectSelectedLabelMatchesInternalPrice(courseRow);
  await expect(courseRow.locator('[data-pa-item-total-display]')).toContainText('13,500');
  await expect(courses.locator('[data-pa-group-total="next_year_courses"]')).toContainText('13,500');
  await expect(form.locator('[data-pa-grand-total]')).toContainText('13,500');
  await shot(page, 'proposal-saved-price.png', courseRow);

  await courseRow.locator('[data-pa-item-qty]').fill('2');
  await expect(courseRow.locator('[data-pa-item-total-display]')).toContainText('27,000');
  await expect(courses.locator('[data-pa-group-total="next_year_courses"]')).toContainText('27,000');
  await expect(form.locator('[data-pa-grand-total]')).toContainText('27,000');

  await courses.locator('[data-pa-add-item]').click();
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(2);
  const secondCourse = courses.locator('[data-pa-item-row]').nth(1);
  const secondCourseOption = await firstPositivePriceOption(secondCourse.locator('[data-pa-pricing-select]'));
  expect(secondCourseOption).not.toBe('');
  await secondCourse.locator('[data-pa-pricing-select]').selectOption(secondCourseOption);
  await expectSelectedLabelMatchesInternalPrice(secondCourse);

  await workshops.locator('[data-pa-add-item]').click();
  const workshopRow = workshops.locator('[data-pa-item-row]').first();
  await expect(workshopRow).toBeVisible();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(1);
  const workshopOption = await firstPositivePriceOption(workshopRow.locator('[data-pa-pricing-select]'));
  expect(workshopOption, 'a positive-price workshop must be available').not.toBe('');
  await workshopRow.locator('[data-pa-pricing-select]').selectOption(workshopOption);
  await expectSelectedLabelMatchesInternalPrice(workshopRow);
  await expect.poll(async () => amountOf(await workshops.locator('[data-pa-group-total="next_year_workshops"]').innerText())).toBeGreaterThan(0);
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText())).toBeGreaterThan(27000);

  await workshops.locator('[data-pa-add-item]').click();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(2);
  const secondWorkshop = workshops.locator('[data-pa-item-row]').nth(1);
  const secondWorkshopOption = await firstPositivePriceOption(secondWorkshop.locator('[data-pa-pricing-select]'));
  expect(secondWorkshopOption).not.toBe('');
  await secondWorkshop.locator('[data-pa-pricing-select]').selectOption(secondWorkshopOption);
  await expectSelectedLabelMatchesInternalPrice(secondWorkshop);
  await shot(page, 'proposal-next-year-two-areas.png', form.locator('[data-pa-items-host]'));

  page.on('dialog', (dialog) => dialog.accept());
  await secondCourse.locator('[data-pa-remove-item]').click();
  await secondWorkshop.locator('[data-pa-remove-item]').click();
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(1);
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(1);

  await form.locator('[data-pa-type-btn="gefen"]').click();
  await form.locator('[data-pa-type-btn="next_year"]').click();
  await expect(form.locator('[data-pa-items-group="next_year_courses"]')).toHaveCount(1);
  await expect(form.locator('[data-pa-items-group="next_year_workshops"]')).toHaveCount(1);

  const contactToggle = form.locator('[data-pa-contact-channels-toggle]:visible').first();
  if (await contactToggle.count()) await contactToggle.click();
  const contact = form.locator('[data-pa-step-panel="contact"]:visible');
  if (await contact.count()) {
    await assertNoOverlap(contact);
    await shot(page, 'proposal-contact-layout.png', contact);
    await page.setViewportSize({ width: 900, height: 1000 });
    await assertNoOverlap(contact);
  }
  await form.locator('[data-pa-cancel-form]').first().click();

  await tracker.persist('proposal-focused-ui');
  assertNoTransportErrors(tracker);
  tracker.resetScreen('proposal-focused-pdf-intercept');

  await page.setViewportSize({ width: 1440, height: 1000 });
  const secondPreview = await openDetailPreview(page, approved);
  await page.locator('#pa-preview-close').click();
  await expect(secondPreview.detail).toBeVisible();
  const print = secondPreview.detail.locator('[data-pa-print]').first();
  await expect(print).toBeVisible();
  await page.evaluate(() => {
    window.__proposalPdfProbe = null;
    new MutationObserver(() => {
      const host = document.querySelector('[data-pdf-render-host]');
      if (!host || window.__proposalPdfProbe) return;
      const visible = (selector) => [...host.querySelectorAll(selector)].some((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      window.__proposalPdfProbe = {
        header: visible('.proposal-document-header, .pa-page-header'), recipient: visible('.pa-to-block, .pa-doc-address'),
        title: visible('.pa-doc-title, .pa-doc-subject'), template: visible('.pa-section, .pa-org-intro'),
        table: visible('.pa-item-details-table, .pa-activities-table, .pa-cost-table, .pa-next-year-course-table, .pa-next-year-workshop-table')
      };
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.route('**/storage/v1/object/**', (route) => route.request().method() === 'POST' ? route.abort() : route.continue());
  await print.click();
  await expect.poll(async () => page.evaluate(() => window.__proposalPdfProbe), { timeout: 60_000 }).not.toBeNull();
  const hostParts = await page.evaluate(() => window.__proposalPdfProbe);
  expect(hostParts).toEqual({ header: true, recipient: true, title: true, template: true, table: true });
  expect(tracker.state.pageErrors).toEqual([]);
  await tracker.persist('proposal-focused-pdf-intercept');
});

test('a workshop-only next-year proposal prices, totals and previews correctly with nothing else on the form', async ({ page, tracker }) => {
  // Regression coverage for a reported bug: selecting a workshop as the very
  // first and only item on a brand-new תשפ״ז proposal left "סה״כ סדנאות" and
  // "סה״כ לתשלום" stuck at 0 ₪ even though the dropdown's own option and the
  // document preview both showed the workshop's real price. Every other
  // next-year test in this suite adds a course first, which happened to mask
  // the failure - this test intentionally never adds a course.
  test.setTimeout(180_000);
  tracker.resetScreen('proposal-workshop-only-pricing');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  const table = page.locator('[data-pa-all-proposals-table] [data-pa-table]').first();
  await expect(table).toBeVisible();

  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible();
  await form.locator('[data-pa-type-btn="next_year"]').click();

  const courses = form.locator('[data-pa-items-group="next_year_courses"]');
  const workshops = form.locator('[data-pa-items-group="next_year_workshops"]');
  await expect(courses).toHaveCount(1);
  await expect(workshops).toHaveCount(1);
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(0);
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(0);

  await workshops.locator('[data-pa-add-item]').click();
  const workshopRow = workshops.locator('[data-pa-item-row]').first();
  await expect(workshopRow).toBeVisible();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(1);

  const select = workshopRow.locator('[data-pa-pricing-select]');
  // Prefer the exact workshop from the bug report when the catalog has it;
  // otherwise fall back to any positively-priced workshop so the test still
  // proves the same mechanism against whatever data the environment seeds.
  const namedOption = await select.locator('option').evaluateAll((options) => {
    const match = options.find((item) => /מערכת השמש תלת מימד/.test(item.textContent || '') && /650/.test(item.textContent || ''));
    return match?.value || '';
  });
  const workshopOption = namedOption || await select.locator('option:not([value=""])').evaluateAll((options) => {
    const option = options.find((item) => !item.value.startsWith('__') && /₪\s*[1-9]/.test(item.textContent || ''));
    return option?.value || '';
  });
  expect(workshopOption, 'a positive-price workshop must be available').not.toBe('');
  await select.selectOption(workshopOption);

  const selectedLabel = await select.locator('option:checked').innerText();
  const selectedName = selectedLabel.split('—')[0].trim();
  const labelPrice = amountOf(selectedLabel);
  expect(labelPrice).toBeGreaterThan(0);

  // 1) Line price matches the selected option, with no page refresh anywhere below.
  await expect.poll(async () => amountOf(await workshopRow.locator('[data-pa-item-price]').inputValue()))
    .toBe(labelPrice);
  // 2) Total workshops.
  await expect.poll(async () => amountOf(await workshops.locator('[data-pa-group-total="next_year_workshops"]').innerText()))
    .toBe(labelPrice);
  // 3) Total to pay (nothing else is on the form, so it equals the workshop alone).
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText()))
    .toBe(labelPrice);
  await shot(page, 'proposal-workshop-only-editor.png', form);

  // 4) Document preview below the editor shows the selected workshop and its exact total.
  // Do not parse the entire A4 document as one number because it also contains
  // dates, headings and other numeric text. Assert against the billed row itself.
  const preview = form.locator('[data-pa-live-preview]');
  await expect(preview).toBeVisible();
  const previewTable = preview.locator('.pa-next-year-workshop-table');
  await expect(previewTable).toBeVisible();
  const previewRow = previewTable.locator('tbody tr').filter({ hasText: selectedName }).first();
  await expect(previewRow).toBeVisible();
  await expect.poll(async () => amountOf(await previewRow.locator('td').last().innerText())).toBe(labelPrice);
  await expect(previewRow).toContainText(String(labelPrice).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
  await shot(page, 'proposal-workshop-only-preview.png', preview);

  // Quantity change updates every total immediately, still no course present.
  const qty = workshopRow.locator('[data-pa-item-qty]');
  await qty.fill('2');
  await qty.dispatchEvent('input');
  await expect.poll(async () => amountOf(await workshops.locator('[data-pa-group-total="next_year_workshops"]').innerText()))
    .toBe(labelPrice * 2);
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText()))
    .toBe(labelPrice * 2);

  // Removing the only row brings every total back to zero.
  page.on('dialog', (dialog) => dialog.accept());
  await workshopRow.locator('[data-pa-remove-item]').click();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(0);
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText())).toBe(0);

  await form.locator('[data-pa-cancel-form]').first().click();
  await tracker.persist('proposal-workshop-only-pricing');
  assertNoTransportErrors(tracker);
});

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
    const option = options.find((item) => {
      const label = item.textContent || '';
      return !item.value.startsWith('__') && (/₪\s*[1-9]/.test(label) || /[1-9][\d,]*(?:\.\d+)?\s*₪/.test(label));
    });
    return option?.value || '';
  });
}

async function selectPositiveOptionAndWaitForGroupTotal(page, group, groupName, rowIndex) {
  const total = group.locator(`[data-pa-group-total="${groupName}"]`);
  const baseline = amountOf(await total.innerText());
  const deadline = Date.now() + 30_000;
  let lastError = '';

  while (Date.now() < deadline) {
    const rows = group.locator('[data-pa-item-row]');
    if ((await rows.count()) <= rowIndex) {
      await page.waitForTimeout(250);
      continue;
    }

    const currentRow = rows.nth(rowIndex);
    const select = currentRow.locator('[data-pa-pricing-select]');
    if (!(await select.count())) {
      await page.waitForTimeout(250);
      continue;
    }

    const option = await firstPositivePriceOption(select);
    if (!option) {
      await page.waitForTimeout(250);
      continue;
    }

    try {
      await select.selectOption(option);
      await expect.poll(async () => amountOf(await total.innerText()), {
        timeout: 4_000,
        intervals: [200, 400, 800]
      }).toBeGreaterThan(baseline);
      return rows.nth(rowIndex);
    } catch (error) {
      lastError = String(error?.message || error);
      await page.waitForTimeout(250);
    }
  }

  throw new Error(`The ${groupName} total did not increase after selecting row ${rowIndex + 1}. ${lastError}`);
}

async function expectSelectedLabelMatchesInternalPrice(row) {
  const selectedLabel = await row.locator('[data-pa-pricing-select] option:checked').innerText();
  const labelPrice = amountOf(selectedLabel);
  const internalPrice = amountOf(await row.locator('[data-pa-item-price]').inputValue());
  expect(labelPrice).toBeGreaterThan(0);
  expect(internalPrice).toBe(labelPrice);
}

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
  const secondCourse = await selectPositiveOptionAndWaitForGroupTotal(page, courses, 'next_year_courses', 1);

  await workshops.locator('[data-pa-add-item]').click();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(1);
  await selectPositiveOptionAndWaitForGroupTotal(page, workshops, 'next_year_workshops', 0);
  await expect.poll(async () => amountOf(await workshops.locator('[data-pa-group-total="next_year_workshops"]').innerText())).toBeGreaterThan(0);
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText())).toBeGreaterThan(27000);

  await workshops.locator('[data-pa-add-item]').click();
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(2);
  const secondWorkshop = await selectPositiveOptionAndWaitForGroupTotal(page, workshops, 'next_year_workshops', 1);
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

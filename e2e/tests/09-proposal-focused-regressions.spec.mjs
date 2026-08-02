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
  await expect(preview.locator('.proposal-document')).toBeVisible();
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

  // Cold-list preview: the row action opens proposal details first. Wait for the
  // asynchronous detail workspace before using its real preview action.
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

  // Locate the real editable saved row with unit price 8,000 and quantity 1.
  const candidates = table.locator('tbody tr[data-pa-row-id]');
  let form = null;
  for (let index = 0; index < Math.min(await candidates.count(), 20); index += 1) {
    const row = candidates.nth(index);
    if (!(await row.locator('[data-pa-edit-row], .ds-pa-row-more summary').count())) continue;
    await openRowAction(row, '[data-pa-edit-row]').catch(() => {});
    const candidateForm = page.locator('[data-pa-form]:visible').first();
    if (!(await candidateForm.isVisible({ timeout: 3000 }).catch(() => false))) continue;
    const saved = candidateForm.locator('[data-pa-item-row]:has([data-pa-item-price][value="8000"])').first();
    if (await saved.count() && Number(await saved.locator('[data-pa-item-qty]').inputValue()) === 1) {
      form = candidateForm;
      break;
    }
    await candidateForm.locator('[data-pa-cancel-form]').first().click();
  }
  expect(form, 'an editable saved proposal with price 8,000 and quantity 1 must exist').not.toBeNull();
  const savedRow = form.locator('[data-pa-item-row]:has([data-pa-item-price][value="8000"])').first();
  await expect(savedRow.locator('[data-pa-item-price]')).toHaveValue('8000');
  await expect(savedRow.locator('[data-pa-item-qty]')).toHaveValue('1');
  const expectedBefore = await form.locator('[data-pa-item-row]').evaluateAll((rows) => rows.reduce((sum, row) => {
    const quantity = Number(row.querySelector('[data-pa-item-qty]')?.value || 0);
    const price = Number(row.querySelector('[data-pa-item-price]')?.value || 0);
    return sum + quantity * price;
  }, 0));
  const grandBefore = amountOf(await form.locator('[data-pa-grand-total]').innerText());
  expect(grandBefore).toBe(expectedBefore);
  await expect(savedRow.locator('[data-pa-item-total-display]')).toContainText('8,000');
  await shot(page, 'proposal-saved-price.png', savedRow);
  await savedRow.locator('[data-pa-item-qty]').fill('2');
  await expect(savedRow.locator('[data-pa-item-total-display]')).toContainText('16,000');
  await expect.poll(async () => amountOf(await form.locator('[data-pa-grand-total]').innerText()) - grandBefore).toBe(8000);

  // Use the real type controls and real item selectors; never submit the form.
  await form.locator('[data-pa-type-btn="next_year"]').click();
  const courses = form.locator('[data-pa-items-group="next_year_courses"]');
  const workshops = form.locator('[data-pa-items-group="next_year_workshops"]');
  await expect(courses).toHaveCount(1);
  await expect(workshops).toHaveCount(1);
  await expect(courses.locator('[data-pa-item-row]')).toHaveCount(0);
  await expect(workshops.locator('[data-pa-item-row]')).toHaveCount(0);

  for (const section of [courses, workshops]) {
    await section.locator('[data-pa-add-item]').click();
    const rows = section.locator('[data-pa-item-row]');
    await expect(rows).toHaveCount(1);
    const select = rows.last().locator('[data-pa-pricing-select]');
    const option = await select.locator('option:not([value=""])').evaluateAll((options) => options.find((item) => !item.value.startsWith('__'))?.value || '');
    expect(option).not.toBe('');
    await select.selectOption(option);
    await expect(rows.last().locator('[data-pa-item-price]')).not.toHaveValue('');
  }
  await shot(page, 'proposal-next-year-two-areas.png', form.locator('[data-pa-items-host]'));
  await form.locator('[data-pa-type-btn="gefen"]').click();
  await form.locator('[data-pa-type-btn="next_year"]').click();
  await expect(form.locator('[data-pa-items-group="next_year_courses"]')).toHaveCount(1);
  await expect(form.locator('[data-pa-items-group="next_year_workshops"]')).toHaveCount(1);

  const contactToggle = form.locator('[data-pa-contact-channels-toggle]:visible').first();
  if (await contactToggle.count()) await contactToggle.click();
  const contact = form.locator('[data-pa-step-panel="contact"]:visible');
  await assertNoOverlap(contact);
  await shot(page, 'proposal-contact-layout.png', contact);
  await page.setViewportSize({ width: 900, height: 1000 });
  await assertNoOverlap(contact);
  await form.locator('[data-pa-cancel-form]').first().click();

  await tracker.persist('proposal-focused-ui');
  assertNoTransportErrors(tracker);
  tracker.resetScreen('proposal-focused-pdf-intercept');

  // Return to the approved proposal and run the real PDF action. Storage is aborted,
  // therefore neither the proposal row nor an existing PDF can be updated.
  await page.setViewportSize({ width: 1440, height: 1000 });
  const secondPreview = await openDetailPreview(page, approved);
  const print = page.locator('#pa-print-btn');
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
  await page.locator('#pa-preview-close').click().catch(() => {});
  await expect(secondPreview.detail).toBeVisible();
});

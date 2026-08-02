import { test, expect } from '../fixtures/test.mjs';
import { navigateToScreen, waitForAppShell } from '../helpers/screen.mjs';

const evidence = (name) => `proposal-${name}.png`;

async function attachScreenshot(locator, name, testInfo) {
  const body = await locator.screenshot({ path: testInfo.outputPath(evidence(name)) });
  await testInfo.attach(evidence(name), { body, contentType: 'image/png' });
}

async function chooseRealSearchResult(input, results) {
  for (const query of ['ירושלים', 'תל', 'אל', 'מועצה', 'עיריית']) {
    await input.fill(query);
    const visibleResults = results.locator('[data-pa-client-result]:visible');
    if (await visibleResults.count()) {
      await visibleResults.nth(0).click();
      return;
    }
  }
  throw new Error('No real catalog result was available for the proposal recipient search');
}

test('proposal editor recipient flows match the approved reference', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');

  const newProposal = page.locator('[data-pa-client-home]:visible [data-pa-client-add-proposal]:visible');
  await expect(newProposal).toHaveCount(1);
  await expect(newProposal).toBeVisible();
  await newProposal.click();
  const form = page.locator('[data-pa-form]:visible');
  await expect(form).toHaveCount(1);
  await expect(form).toBeVisible();

  const authoritySearch = form.locator('[data-pa-client-search-field-wrap]');
  const schoolPanel = form.locator('[data-pa-school-search-panel]');
  const contactPanel = form.locator('[data-pa-step-panel="contact"]');
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeHidden();
  await expect(contactPanel).toBeHidden();
  await expect(form.locator('[data-pa-type-btn]')).toHaveText(['תשפ״ז', 'גפ״ן', 'סיור']);
  await expect(form.locator('[data-pa-type-btn="summer"]')).toHaveCount(0);

  await chooseRealSearchResult(
    form.locator('[data-pa-client-search-input]'),
    form.locator('[data-pa-client-results]')
  );
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeVisible();
  await chooseRealSearchResult(
    form.locator('[data-pa-school-search-input]'),
    form.locator('[data-pa-school-results]')
  );
  await expect(form.locator('.ds-pa-client-locked-state')).toBeVisible();
  await expect(contactPanel).toBeVisible();
  await attachScreenshot(form, 'school', testInfo);

  await form.locator('input[name="client_type_selector"][value="authority"]').check();
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeHidden();
  await expect(form.locator('[data-pa-other-client-field]')).toBeHidden();
  await chooseRealSearchResult(
    form.locator('[data-pa-client-search-input]'),
    form.locator('[data-pa-client-results]')
  );
  await expect(contactPanel).toBeVisible();
  await expect(form.locator('[data-pa-school-search-panel]')).toBeHidden();
  await expect(form.locator('.ds-pa-client-locked-state')).toHaveCount(0);
  await attachScreenshot(form, 'authority', testInfo);

  await form.locator('input[name="client_type_selector"][value="other"]').check();
  await expect(form.locator('[data-pa-other-client-field]')).toBeVisible();
  await expect(contactPanel).toBeVisible();
  await expect(authoritySearch).toBeHidden();
  await expect(schoolPanel).toBeHidden();
  await expect(form.locator('.ds-pa-client-locked-state')).toHaveCount(0);
  await expect(form.locator('[data-pa-contact-select]')).toHaveCount(0);
  await form.locator('[name="other_client_name"]').fill('לקוח בדיקה');
  await form.locator('[name="contact_name"]').fill('ישראל ישראלי');
  await form.locator('[name="contact_role"]').fill('רכז בדיקה');
  await form.locator('[name="email"]').fill('proposal-e2e@example.invalid');
  await form.locator('[name="phone"]').fill('0500000000');
  await attachScreenshot(form, 'other', testInfo);

  await page.locator('[data-accent-picker-btn]').click();
  await page.locator('[data-accent-swatch][data-accent="purple"]').click();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-accent').trim());
  await expect(form.locator('.pa-sidebar')).toHaveCSS('border-color', 'rgb(91, 33, 182)');
  await expect(form.locator('.ds-pa-recipient-type-option:has(input:checked)')).toHaveCSS('border-color', 'rgb(91, 33, 182)');
  await expect(form.locator('.ds-pa-type-card').nth(0)).toHaveCSS('border-color', 'rgb(91, 33, 182)');
  await expect(form.locator('.pa-sidebar-heading')).toHaveCSS('border-bottom-color', 'rgb(91, 33, 182)');
  expect(accent).toBe('#5b21b6');
  await attachScreenshot(form, 'theme-color', testInfo);
});

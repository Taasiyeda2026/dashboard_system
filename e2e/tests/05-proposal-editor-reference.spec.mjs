import { test, expect } from '../fixtures/test.mjs';
import { navigateToScreen, waitForAppShell } from '../helpers/screen.mjs';

const evidence = (name) => `proposal-${name}.png`;

test('proposal editor recipient flows match the approved reference', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');

  const newProposal = page.locator('[data-pa-tab="new"]');
  await expect(newProposal).toBeVisible();
  await newProposal.click();
  const form = page.locator('[data-pa-form]');
  await expect(form).toBeVisible();

  const authoritySearch = form.locator('[data-pa-client-search-field-wrap]');
  const schoolPanel = form.locator('[data-pa-school-search-panel]');
  const contactPanel = form.locator('[data-pa-step-panel="contact"]');
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeHidden();
  await expect(contactPanel).toBeHidden();
  await expect(form.locator('[data-pa-type-btn]')).toHaveText(['תשפ״ז', 'גפ״ן', 'סיור']);
  await expect(form.locator('[data-pa-type-btn="summer"]')).toHaveCount(0);
  await form.screenshot({ path: test.info().outputPath(evidence('school')) });

  await form.locator('input[name="client_type_selector"][value="authority"]').check();
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeHidden();
  await expect(form.locator('[data-pa-other-client-field]')).toBeHidden();
  await form.screenshot({ path: test.info().outputPath(evidence('authority')) });

  await form.locator('input[name="client_type_selector"][value="other"]').check();
  await expect(form.locator('[data-pa-other-client-field]')).toBeVisible();
  await expect(contactPanel).toBeVisible();
  await expect(authoritySearch).toBeHidden();
  await expect(schoolPanel).toBeHidden();
  await expect(form.locator('[data-pa-contact-select]')).toHaveCount(0);
  await form.screenshot({ path: test.info().outputPath(evidence('other')) });

  await page.locator('[data-accent-picker-btn]').click();
  await page.locator('[data-accent-swatch][data-accent="purple"]').click();
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ds-accent').trim());
  const branded = form.locator('.pa-sidebar, .ds-pa-type-card, .ds-pa-recipient-type-option');
  await expect(branded.first()).toHaveCSS('border-color', 'rgb(91, 33, 182)');
  expect(accent).toBe('#5b21b6');
  await form.screenshot({ path: test.info().outputPath(evidence('theme-color')) });
});

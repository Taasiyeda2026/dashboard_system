import { test, expect } from '../fixtures/test.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

const evidence = (name) => `proposal-${name}.png`;

async function attachScreenshot(locator, name, testInfo) {
  const body = await locator.screenshot({ path: testInfo.outputPath(evidence(name)) });
  await testInfo.attach(evidence(name), { body, contentType: 'image/png' });
}

async function chooseRealSearchResult(input, results, queries = ['ירושלים', 'תל', 'אל', 'מועצה', 'עיריית']) {
  for (const query of queries) {
    await input.fill(query);
    const visibleResults = results.locator('[data-pa-client-result]:visible');
    if (await visibleResults.count()) {
      await visibleResults.nth(0).click();
      return;
    }
  }
  throw new Error('No real catalog result was available for the proposal recipient search');
}

async function expectComputedHidden(locator) {
  await expect(locator).toHaveAttribute('hidden', '');
  expect(await locator.evaluate((element) => getComputedStyle(element).display)).toBe('none');
  expect(await locator.boundingBox()).toBeNull();
}

async function expectThreeColumnRecipientLayout(form) {
  const [general, type, flow] = await Promise.all([
    form.locator('.ds-pa-recipient-general').boundingBox(),
    form.locator('.ds-pa-recipient-type-field').boundingBox(),
    form.locator('.ds-pa-recipient-flow').boundingBox()
  ]);
  expect(general && type && flow).toBeTruthy();
  expect(Math.abs(general.y - type.y)).toBeLessThan(20);
  expect(Math.abs(general.y - flow.y)).toBeLessThan(20);
  expect(general.x).toBeGreaterThan(type.x + type.width);
  expect(type.x).toBeGreaterThan(flow.x + flow.width);

  const buttons = await form.locator('.ds-pa-recipient-type-option').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }));
  expect(buttons).toHaveLength(3);
  expect(Math.abs(buttons[0].x - buttons[1].x)).toBeLessThan(2);
  expect(Math.abs(buttons[1].x - buttons[2].x)).toBeLessThan(2);
  expect(buttons[1].y).toBeGreaterThanOrEqual(buttons[0].y + buttons[0].height);
  expect(buttons[2].y).toBeGreaterThanOrEqual(buttons[1].y + buttons[1].height);
}

test('proposal editor recipient flows match the approved reference', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

  const newProposal = page.locator('[data-pa-client-home]:visible [data-pa-client-add-proposal]:visible');
  await expect(newProposal).toHaveCount(1);
  await expect(newProposal).toBeVisible();
  await newProposal.click();
  const activeScreen = page.locator('[data-pa-screen][data-pa-view-mode="proposal-editor"]:visible');
  await expect(activeScreen).toHaveCount(1);
  const form = activeScreen.locator('[data-pa-tab-panel="new"] [data-pa-form-host] > [data-pa-form]:visible');
  await expect(form).toHaveCount(1);
  await expect(form).toBeVisible();
  const editorStylesheetHref = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (Array.from(sheet.cssRules).some((rule) => rule.cssText.includes('.ds-pa-recipient-main-row'))) {
          return sheet.href || '';
        }
      } catch {
        // Ignore cross-origin stylesheets; Vite assets are same-origin and readable.
      }
    }
    return '';
  });
  expect(editorStylesheetHref).toMatch(/\.css(?:$|\?)/);
  const editorStylesheetResponse = await page.request.get(editorStylesheetHref);
  expect(editorStylesheetResponse.ok()).toBe(true);
  expect(editorStylesheetResponse.headers()['content-type']).toContain('text/css');
  await expect(form.locator('.ds-pa-recipient-main-row')).toHaveCSS('display', 'grid');
  await expect(form.locator('.ds-pa-recipient-type')).toHaveCSS('display', 'grid');

  const authoritySearch = form.locator('[data-pa-client-search-field-wrap]');
  const schoolPanel = form.locator('[data-pa-school-search-panel]');
  const contactPanel = form.locator('[data-pa-step-panel="contact"]');
  await expect(authoritySearch).toBeVisible();
  await expectComputedHidden(schoolPanel);
  await expectComputedHidden(contactPanel);
  await expectComputedHidden(form.locator('[data-pa-client-card]'));
  await expectThreeColumnRecipientLayout(form);
  await expect(form.locator('[data-pa-type-btn]')).toHaveText(['תשפ״ז', 'גפן', 'סיור']);
  await expect(form.locator('[data-pa-type-btn="summer"]')).toHaveCount(0);

  await chooseRealSearchResult(
    form.locator('[data-pa-client-search-input]'),
    form.locator('[data-pa-client-results]'),
    ['אבו גוש']
  );
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeVisible();
  const authorityBox = await form.locator('[data-pa-client-search-input]').boundingBox();
  const schoolBox = await form.locator('[data-pa-school-search-input]').boundingBox();
  expect(authorityBox && schoolBox).toBeTruthy();
  expect(schoolBox.y).toBeGreaterThanOrEqual(authorityBox.y + authorityBox.height);
  await chooseRealSearchResult(
    form.locator('[data-pa-school-search-input]'),
    form.locator('[data-pa-school-results]'),
    ['אבו גוש']
  );
  const schoolMarker = form.locator('.ds-pa-client-locked.is-school');
  await expect(schoolMarker).toBeVisible();
  await expect(form.locator('.ds-pa-client-locked.is-authority')).toHaveCount(0);
  await expect(form.locator('[data-pa-school-search-input]')).toHaveValue('אבו גוש');
  await expect(form.locator('.ds-pa-client-locked-state')).toContainText('118018');
  await expect(schoolMarker).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(schoolMarker).toHaveCSS('border-top-style', 'none');
  await expect(schoolMarker).toHaveCSS('padding-top', '0px');
  await expect(contactPanel).toBeVisible();
  await expect(form.locator('[data-pa-contact-select]')).toBeVisible();
  await attachScreenshot(form, 'school', testInfo);

  const contactSelect = form.locator('[data-pa-contact-select]');
  const contactValue = await contactSelect.locator('option').evaluateAll((options) => options
    .map((option) => option.value)
    .find((value) => value && value !== '__pa_other_contact__') || '');
  expect(contactValue, 'expected a real contact for the selected school').not.toBe('');
  await contactSelect.selectOption(contactValue);
  const contactChannelsToggle = form.locator('[data-pa-contact-channels-toggle]:visible');
  await expect(contactChannelsToggle).toHaveCount(1);
  await contactChannelsToggle.click();
  await expect(form.locator('[data-pa-contact-channels-fields]')).toBeVisible();
  await attachScreenshot(form, 'contact-edit-fields', testInfo);

  const authorityType = form.locator('.ds-pa-recipient-type-option').filter({ has: page.locator('input[name="client_type_selector"][value="authority"]') });
  await expect(authorityType).toHaveCount(1);
  await authorityType.click();
  await expect(authoritySearch).toBeVisible();
  await expect(schoolPanel).toBeHidden();
  await expect(form.locator('[data-pa-other-client-field]')).toBeHidden();
  await chooseRealSearchResult(
    form.locator('[data-pa-client-search-input]'),
    form.locator('[data-pa-client-results]'),
    ['אבו גוש']
  );
  await expect(contactPanel).toBeVisible();
  await expect(form.locator('.ds-pa-client-locked.is-authority')).toBeHidden();
  await expect(form.locator('[data-pa-school-search-panel]')).toBeHidden();
  await expect(form.locator('.ds-pa-client-locked-state')).toHaveCount(0);
  await attachScreenshot(form, 'authority', testInfo);

  const otherType = form.locator('.ds-pa-recipient-type-option').filter({ has: page.locator('input[name="client_type_selector"][value="other"]') });
  await expect(otherType).toHaveCount(1);
  await otherType.click();
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

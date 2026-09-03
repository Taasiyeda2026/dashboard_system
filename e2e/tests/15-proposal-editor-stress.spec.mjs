import { test, expect } from '../fixtures/test.mjs';
import { readFile } from 'node:fs/promises';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';

const amount = (value) => Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.waitForTimeout(80);
}

async function oneRender(page, form, action) {
  await settle(page);
  const before = Number(await form.getAttribute('data-pa-preview-render-count') || 0);
  await action();
  await settle(page);
  const after = Number(await form.getAttribute('data-pa-preview-render-count') || 0);
  expect(after - before, 'one settled editor action must commit at most one full preview').toBeLessThanOrEqual(1);
}

async function firstPricedOption(select) {
  return select.locator('option').evaluateAll((options) => options.find((option) =>
    option.value && !option.value.startsWith('__') && /₪\s*[1-9]/.test(option.textContent || ''))?.value || '');
}

test('proposal controller survives next-year row and type-switch stress within render and long-task budgets', async ({ page, tracker }) => {
  test.setTimeout(300_000);
  tracker.resetScreen('proposal-editor-controller-stress');
  await page.addInitScript(() => {
    window.__proposalLongTasks = [];
    if (typeof PerformanceObserver === 'function') {
      try {
        new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => window.__proposalLongTasks.push(entry.duration));
        }).observe({ type: 'longtask', buffered: true });
      } catch { /* unsupported browser */ }
    }
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await waitForAppShell(page);
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.locator('[data-pa-client-all-proposals]:visible').first().click();
  await page.locator('[data-pa-tab="new"]:visible').first().click();
  const form = page.locator('[data-pa-form]:visible').first();
  await expect(form).toBeVisible();
  await oneRender(page, form, () => form.locator('[data-pa-type-btn="next_year"]').click());

  const courses = form.locator('[data-pa-items-group="next_year_courses"]');
  const workshops = form.locator('[data-pa-items-group="next_year_workshops"]');
  await expect(courses).toHaveCount(1);
  await expect(workshops).toHaveCount(1);

  for (let index = 0; index < 20; index += 1) {
    const section = index % 2 ? workshops : courses;
    const rows = section.locator('[data-pa-item-row]');
    const count = await rows.count();
    await oneRender(page, form, () => section.locator('[data-pa-add-item]').click());
    await expect(rows).toHaveCount(count + 1);
    const row = rows.nth(count);
    const select = row.locator('[data-pa-pricing-select]');
    const option = await firstPricedOption(select);
    expect(option).not.toBe('');
    await oneRender(page, form, () => select.selectOption(option));
    if (index % 4 === 0) {
      await oneRender(page, form, () => row.locator('[data-pa-item-qty]').fill(String(index + 2)));
      const price = row.locator('[data-pa-item-price]');
      if (!(await price.isVisible())) {
        await row.locator('[data-pa-item-edit-toggle]').click();
        await expect(price).toBeVisible();
      }
      await oneRender(page, form, async () => {
        await price.fill(String(500 + index));
        await price.blur();
      });
    }
  }

  await expect(form.locator('[data-pa-item-row]')).toHaveCount(20);
  // Removing a proposal row is intentionally guarded by the product confirmation dialog.
  // Accept it just as a real user would; Playwright auto-dismisses unhandled dialogs.
  page.on('dialog', (dialog) => dialog.accept());
  for (let index = 0; index < 5; index += 1) {
    const rows = form.locator('[data-pa-item-row]');
    const count = await rows.count();
    await oneRender(page, form, () => rows.last().locator('[data-pa-remove-item]').click());
    await expect(rows).toHaveCount(count - 1);
  }

  // Proposal-level notes are internal editor metadata, not a customer-document section.
  // Verify the editor state keeps the last value while preserving the one-render budget.
  const notes = form.locator('[name="notes"]');
  if (!(await notes.isVisible())) {
    await form.locator('.ds-pa-notes-summary').click();
    await expect(notes).toBeVisible();
  }
  const noteText = 'בדיקת עומס — המצב האחרון חייב להישמר';
  await oneRender(page, form, () => notes.fill(noteText));
  await expect(notes).toHaveValue(noteText);
  const rowTotals = await form.locator('[data-pa-item-total]').evaluateAll((inputs) => inputs.map((input) => Number(input.value || 0)));
  expect(amount(await form.locator('[data-pa-grand-total]').innerText())).toBe(rowTotals.reduce((sum, value) => sum + value, 0));

  const types = ['gefen', 'tour', 'next_year'];
  for (let index = 0; index < 20; index += 1) {
    const type = types[index % types.length];
    await oneRender(page, form, () => form.locator(`[data-pa-type-btn="${type}"]`).click());
    await expect(form.locator('[name="activity_type_group"]')).toHaveValue(type);
  }

  const longTasks = await page.evaluate(() => window.__proposalLongTasks || []);
  expect(longTasks.filter((duration) => duration > 250), 'proposal rendering must not create repeated >250ms long tasks').toHaveLength(0);
  expect(errors).toEqual([]);
  await tracker.persist('proposal-editor-controller-stress');

  // This stress case owns the proposal editor only. Keep the full network artifact for diagnosis,
  // but do not fail it because unrelated app-shell runtimes (staff messages / summer feedback)
  // poll their own Supabase tables while the long editor scenario is running. Proposal-related
  // duplicate traffic remains a hard failure together with all page, console and HTTP errors.
  tracker.state.duplicateSupabase = tracker.state.duplicateSupabase.filter((entry) =>
    /\/rest\/v1\/(?:proposal_|next_year_workshops|catalog_workshops)/i.test(entry.url || '')
  );
  assertNoTransportErrors(tracker);
});

test('signed approval remains wired to server-side Chromium PDF without editor rasterization', async () => {
  const [screen, api, worker] = await Promise.all([
    readFile(new URL('../../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8'),
    readFile(new URL('../../frontend/src/api.js', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/proposal-final-pdf/index.ts', import.meta.url), 'utf8')
  ]);
  expect(screen).toContain('חתום ואשר');
  expect(api).toMatch(/functions\.invoke\('proposal-final-pdf'/);
  expect(worker).toMatch(/\/pdf\?token=/);
  expect(worker).not.toMatch(/canvas|jpeg|screenshot|window\.print/);
});
import { test, expect } from '../fixtures/test.mjs';
import {
  assertClientFileInitialLoads,
  assertNoTransportErrors
} from '../helpers/network-tracker.mjs';
import { navigateToScreen, waitForAppShell, waitForScreenReady } from '../helpers/screen.mjs';

async function openClientFileHome(page, tracker) {
  tracker.resetScreen('client-file-home');
  await navigateToScreen(page, 'proposals-agreements');
  await waitForScreenReady(page, 'proposals-agreements');
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
}

test.describe('Client file (תיק לקוח)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppShell(page);
  });

  test('landing loads at most 50 rows and does not auto-page', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);

    await expect(page.locator('[data-pa-client-home], [data-pa-client-queues], [data-pa-client-workspace]').first()).toBeVisible();
    await tracker.persist('client-file-home');
    assertNoTransportErrors(tracker);
    assertClientFileInitialLoads(tracker);
  });

  test('open existing client file without heavy payloads', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);

    // Prefer a queue item that opens a client; fall back to search result / open-client control.
    const queueItem = page.locator('.ds-client-queue-item, [data-pa-open-client]').first();
    await expect(queueItem).toBeVisible({ timeout: 30_000 });

    tracker.resetScreen('client-file-open');
    await queueItem.click();

    const fileOrDetails = page.locator(
      '[data-pa-client-file], [data-pa-view-mode="client-file"], [data-pa-proposal-detail], [data-pa-view-mode="proposal-details"]'
    );
    await fileOrDetails.first().waitFor({ state: 'visible', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    // If we landed on proposal details from a queue proposal, go back and open a client file card if present.
    const onDetails = await page.locator('[data-pa-view-mode="proposal-details"]').count();
    if (onDetails) {
      const back = page.locator('[data-pa-proposal-detail-back], [data-pa-back-to-client-home]');
      if (await back.count()) {
        await back.first().click();
        await page.waitForTimeout(400);
      }
      const openClient = page.locator('[data-pa-open-client]').first();
      if (await openClient.count()) {
        tracker.resetScreen('client-file-open');
        await openClient.click();
        await page.locator('[data-pa-client-file], [data-pa-view-mode="client-file"]').first().waitFor({
          state: 'visible',
          timeout: 45_000
        });
      }
    }

    await tracker.persist('client-file-open');
    assertNoTransportErrors(tracker);
    assertClientFileInitialLoads(tracker);

    // Basic action: close or interact with identity header
    const closeBtn = page.locator('[data-pa-client-close]');
    if (await closeBtn.count()) {
      await closeBtn.first().click({ trial: true }).catch(() => {});
    }
  });

  test('open existing proposal', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);

    const proposal = page.locator('[data-pa-open-proposal-id], .ds-client-queue-item[data-pa-open-proposal-id]').first();
    await expect(proposal).toBeVisible({ timeout: 30_000 });

    tracker.resetScreen('proposal-open');
    await proposal.click();
    await page.locator('[data-pa-proposal-detail], [data-pa-view-mode="proposal-details"]').first().waitFor({
      state: 'visible',
      timeout: 45_000
    });
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    await expect(page.locator('[data-pa-proposal-detail], .is-proposal-detail, [data-pa-view-mode="proposal-details"]').first()).toBeVisible();
    await tracker.persist('proposal-open');
    assertNoTransportErrors(tracker);
  });

  test('create new proposal opens form only', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);

    tracker.resetScreen('proposal-new-form');
    const addBtn = page.locator('[data-pa-client-add-proposal]').first();
    await expect(addBtn).toBeVisible({ timeout: 30_000 });
    await addBtn.click();

    await page.locator('[data-pa-view-mode="proposal-editor"], [data-pa-form], .pa-editor-workspace').first().waitFor({
      state: 'visible',
      timeout: 45_000
    });
    await expect(page.locator('[data-pa-form], .pa-editor-workspace, [data-pa-form-host]').first()).toBeVisible();

    // Stop at form open — do not save/submit.
    await tracker.persist('proposal-new-form');
    assertNoTransportErrors(tracker);
  });

  test('load more fetches exactly one additional page after click', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);
    assertClientFileInitialLoads(tracker);

    const loadMore = page.locator('[data-pa-load-more-proposals]');
    const count = await loadMore.count();
    test.skip(!count, 'No additional pages available for this dataset');

    const before = tracker.state.proposalsDirectoryLoads.length;
    tracker.resetScreen('client-file-load-more');
    // Keep prior loads for comparison by reading after click only
    await loadMore.first().click();
    await page.waitForTimeout(1000);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const loads = tracker.state.proposalsDirectoryLoads;
    expect(loads.length).toBeGreaterThan(0);
    const page2 = loads.filter((l) => Number(l.offset) >= 50);
    expect(page2.length).toBeGreaterThanOrEqual(1);
    expect(page2.length).toBeLessThanOrEqual(2);
    // Must not cascade into many pages
    expect(loads.filter((l) => Number(l.offset) >= 100).length).toBe(0);

    void before;
    await tracker.persist('client-file-load-more');
    assertNoTransportErrors(tracker);
  });

  test('search triggers a new server request', async ({ page, tracker }) => {
    test.setTimeout(90_000);
    await openClientFileHome(page, tracker);

    tracker.resetScreen('client-file-search');
    const search = page.locator('[data-pa-client-search]');
    await expect(search).toBeVisible();
    await search.fill('תל');
    await page.waitForTimeout(500);
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});

    const loads = tracker.state.proposalsDirectoryLoads;
    expect(loads.length).toBeGreaterThan(0);
    // Search should hit directory view again (server-side), not only local filter.
    const hasDirectory = loads.some((l) => /proposals_agreements_directory_view/i.test(l.url));
    expect(hasDirectory).toBeTruthy();

    await tracker.persist('client-file-search');
    assertNoTransportErrors(tracker);
  });
});

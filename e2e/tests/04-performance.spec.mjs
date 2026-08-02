import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../fixtures/test.mjs';
import { ARTIFACTS_DIR, shouldUpdateBaseline } from '../helpers/env.mjs';
import { assertNoTransportErrors } from '../helpers/network-tracker.mjs';
import {
  compareToBudget,
  measureScreen,
  maybePersistBaseline,
  readBaseline,
  upsertBaselineScreen
} from '../helpers/performance.mjs';
import { SCREENS, navigateToScreen, waitForAppShell } from '../helpers/screen.mjs';

const PERF_SCREENS = [
  'dashboard',
  'activities',
  'week',
  'month',
  'proposals-agreements',
  'operations-management',
  'instructors',
  'contacts'
];

test.describe('Performance budgets', () => {
  test.describe.configure({ mode: 'serial' });

  let baseline = readBaseline();
  const measured = {};

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppShell(page);
  });

  for (const screenKey of PERF_SCREENS) {
    test(`budget: ${screenKey}`, async ({ page, tracker }) => {
      test.setTimeout(120_000);

      const metrics = await measureScreen(page, tracker, {
        screenKey,
        readySelector: SCREENS[screenKey].ready,
        navigate: async () => {
          await navigateToScreen(page, screenKey);
        }
      });

      measured[screenKey] = metrics;
      baseline = upsertBaselineScreen(baseline, screenKey, metrics);

      await tracker.persist(`perf-${screenKey}`);
      assertNoTransportErrors(tracker);

      if (shouldUpdateBaseline()) {
        expect(metrics.timeToContentMs).toBeGreaterThan(0);
        return;
      }

      const committed = readBaseline();
      const comparison = compareToBudget(screenKey, metrics, committed);
      if (!comparison.ok) {
        throw new Error(comparison.problems.join('\n'));
      }
      // Absolute budgets always apply; regression applies only when a committed baseline exists.
      if (!committed.screens?.[screenKey]?.timeToContentMs) {
        console.warn(`[perf] No committed baseline for ${screenKey}; enforced absolute budgets only.`);
      }
    });
  }

  test.afterAll(async () => {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    const out = {
      capturedAt: new Date().toISOString(),
      screens: measured
    };
    fs.writeFileSync(path.join(ARTIFACTS_DIR, 'performance-measured.json'), `${JSON.stringify(out, null, 2)}\n`);

    if (shouldUpdateBaseline()) {
      const written = maybePersistBaseline({ screens: { ...readBaseline().screens, ...measured } });
      if (written) {
        fs.writeFileSync(
          path.join(ARTIFACTS_DIR, 'performance-baseline-written.json'),
          `${JSON.stringify(written, null, 2)}\n`
        );
      }
    }
  });
});

import { test as base, expect } from '@playwright/test';
import { attachNetworkTracker } from '../helpers/network-tracker.mjs';
import { installPerformanceProbes } from '../helpers/performance.mjs';

export const test = base.extend({
  tracker: async ({ page }, use) => {
    await installPerformanceProbes(page);
    const tracker = attachNetworkTracker(page, { screen: 'boot' });
    await use(tracker);
    await tracker.persist(tracker.state.screen).catch(() => {});
    tracker.dispose();
  }
});

export { expect };

import fs from 'node:fs';
import path from 'node:path';
import {
  ABSOLUTE_BUDGETS,
  BASELINE_PATH,
  REGRESSION_MIN_ALLOWANCE,
  REGRESSION_RATIO,
  shouldUpdateBaseline
} from './env.mjs';

const METRIC_KEYS = [
  'timeToContentMs',
  'networkIdleMs',
  'requestCount',
  'supabaseRequestCount',
  'jsBytes',
  'cssBytes',
  'longTasksOver50ms',
  'renderCount',
  'activeMutationObservers'
];

export function readBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    return { version: 1, capturedAt: null, screens: {} };
  }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

export function writeBaseline(baseline) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  const sanitized = {
    version: 1,
    capturedAt: new Date().toISOString(),
    note: 'Performance metrics only. No usernames, school names, contacts, proposals, or business data.',
    screens: {}
  };
  for (const [screen, metrics] of Object.entries(baseline.screens || {})) {
    sanitized.screens[screen] = pickMetrics(metrics);
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(sanitized, null, 2)}\n`);
  return sanitized;
}

export function pickMetrics(metrics = {}) {
  const out = {};
  for (const key of METRIC_KEYS) {
    out[key] = Number(metrics[key] || 0);
  }
  return out;
}

export async function installPerformanceProbes(page) {
  await page.addInitScript(() => {
    if (window.__dsE2ePerfInstalled) return;
    window.__dsE2ePerfInstalled = true;
    window.__dsE2ePerf = {
      longTasksOver50ms: 0,
      renderCount: 0,
      moCreates: 0,
      moDisconnects: 0
    };

    try {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration > 50) window.__dsE2ePerf.longTasksOver50ms += 1;
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    } catch {
      /* longtask unsupported */
    }

    const OriginalMO = window.MutationObserver;
    if (OriginalMO) {
      window.MutationObserver = class InstrumentedMutationObserver extends OriginalMO {
        constructor(callback) {
          super(callback);
          window.__dsE2ePerf.moCreates += 1;
          this.__dsAlive = true;
        }
        disconnect() {
          if (this.__dsAlive) {
            window.__dsE2ePerf.moDisconnects += 1;
            this.__dsAlive = false;
          }
          return super.disconnect();
        }
      };
    }

    const markRender = () => {
      window.__dsE2ePerf.renderCount += 1;
    };
    const mo = new OriginalMO(markRender);
    const start = () => {
      if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  });
}

export async function collectRuntimePerf(page) {
  return page.evaluate(() => {
    const perf = window.__dsE2ePerf || {
      longTasksOver50ms: 0,
      renderCount: 0,
      moCreates: 0,
      moDisconnects: 0
    };
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint');
    const fcp = paint.find((p) => p.name === 'first-contentful-paint')?.startTime || 0;
    return {
      longTasksOver50ms: Number(perf.longTasksOver50ms || 0),
      renderCount: Number(perf.renderCount || 0),
      activeMutationObservers: Math.max(0, Number(perf.moCreates || 0) - Number(perf.moDisconnects || 0)),
      fcpMs: Number(fcp || 0),
      domContentLoadedMs: Number(nav?.domContentLoadedEventEnd || 0)
    };
  });
}

export async function measureScreen(page, tracker, {
  screenKey,
  navigate,
  readySelector
}) {
  tracker.resetScreen(screenKey);
  const t0 = Date.now();
  await navigate();
  if (readySelector) {
    await page.locator(readySelector).first().waitFor({ state: 'visible', timeout: 90_000 });
  }
  const timeToContentMs = Date.now() - t0;

  // Wait for network to settle
  const networkStart = Date.now();
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  const networkIdleMs = Date.now() - t0;
  void networkStart;

  const runtime = await collectRuntimePerf(page);
  const summary = tracker.summary();

  return pickMetrics({
    timeToContentMs,
    networkIdleMs,
    requestCount: summary.requestCount,
    supabaseRequestCount: summary.supabaseRequestCount,
    jsBytes: summary.jsBytes,
    cssBytes: summary.cssBytes,
    longTasksOver50ms: runtime.longTasksOver50ms,
    renderCount: runtime.renderCount,
    activeMutationObservers: runtime.activeMutationObservers
  });
}

export function relativeBudgetLimit(key, baselineValue) {
  const base = Number(baselineValue || 0);
  const allowance = Number(REGRESSION_MIN_ALLOWANCE[key] || 0);
  return Math.max(base * REGRESSION_RATIO, base + allowance);
}

export function compareToBudget(screenKey, metrics, baseline) {
  const problems = [];
  const base = baseline?.screens?.[screenKey];
  const current = pickMetrics(metrics);

  for (const key of METRIC_KEYS) {
    const value = current[key];
    const absolute = ABSOLUTE_BUDGETS[key];
    if (Number.isFinite(absolute) && value > absolute) {
      problems.push(`${screenKey}.${key}=${value} exceeds absolute budget ${absolute}`);
    }
    if (base && Number(base[key]) > 0) {
      const limit = relativeBudgetLimit(key, base[key]);
      if (value > limit) {
        problems.push(
          `${screenKey}.${key}=${value} exceeds regression limit vs baseline ${base[key]} (limit ${limit.toFixed(1)})`
        );
      }
    }
  }

  return { ok: problems.length === 0, problems, current, baseline: base || null };
}

export function upsertBaselineScreen(baseline, screenKey, metrics) {
  const next = {
    version: 1,
    capturedAt: baseline.capturedAt || null,
    screens: { ...(baseline.screens || {}) }
  };
  next.screens[screenKey] = pickMetrics(metrics);
  return next;
}

export function maybePersistBaseline(baseline) {
  if (!shouldUpdateBaseline()) return null;
  return writeBaseline(baseline);
}

export { METRIC_KEYS, BASELINE_PATH };

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareToBudget,
  pickMetrics,
  upsertBaselineScreen
} from '../e2e/helpers/performance.mjs';
import { ABSOLUTE_BUDGETS, REGRESSION_RATIO } from '../e2e/helpers/env.mjs';

test('pickMetrics keeps only numeric performance fields', () => {
  const picked = pickMetrics({
    timeToContentMs: 100,
    requestCount: 5,
    schoolName: 'should-not-appear',
    username: 'secret'
  });
  assert.equal(picked.timeToContentMs, 100);
  assert.equal(picked.requestCount, 5);
  assert.equal('schoolName' in picked, false);
  assert.equal('username' in picked, false);
});

test('compareToBudget fails on absolute ceiling', () => {
  const metrics = pickMetrics({
    timeToContentMs: ABSOLUTE_BUDGETS.timeToContentMs + 1,
    networkIdleMs: 1,
    requestCount: 1,
    supabaseRequestCount: 1,
    jsBytes: 1,
    cssBytes: 1,
    longTasksOver50ms: 0,
    renderCount: 1,
    activeMutationObservers: 1
  });
  const result = compareToBudget('dashboard', metrics, { screens: {} });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /absolute budget/);
});

test('compareToBudget fails on >20% regression vs baseline', () => {
  const baseline = {
    screens: {
      dashboard: pickMetrics({
        timeToContentMs: 1000,
        networkIdleMs: 2000,
        requestCount: 10,
        supabaseRequestCount: 5,
        jsBytes: 1000,
        cssBytes: 100,
        longTasksOver50ms: 1,
        renderCount: 10,
        activeMutationObservers: 2
      })
    }
  };
  const metrics = pickMetrics({
    ...baseline.screens.dashboard,
    timeToContentMs: Math.floor(1000 * REGRESSION_RATIO) + 50
  });
  const result = compareToBudget('dashboard', metrics, baseline);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /regresses/);
});

test('upsertBaselineScreen does not copy business fields', () => {
  const next = upsertBaselineScreen({ screens: {} }, 'dashboard', {
    timeToContentMs: 12,
    schoolName: 'x',
    proposalId: 'y'
  });
  assert.deepEqual(Object.keys(next.screens.dashboard).sort(), [
    'activeMutationObservers',
    'cssBytes',
    'jsBytes',
    'longTasksOver50ms',
    'networkIdleMs',
    'renderCount',
    'requestCount',
    'supabaseRequestCount',
    'timeToContentMs'
  ]);
});

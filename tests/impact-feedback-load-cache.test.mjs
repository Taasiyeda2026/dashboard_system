import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261010193000_feedback_admin_groups_perf.sql', import.meta.url), 'utf8');

/** Simulate the ensure* cache policy for request accounting. */
function createEnsureSimulator() {
  const calls = { groups: 0, assignments: 0, summary: 0, facts: 0 };
  const cache = { groups: null, groupsYear: null, assignments: null, assignmentsYear: null, summary: null, summaryYear: null, summaryHalf: null, facts: null, factsYear: null };
  const inflight = { groups: null, assignments: null, summary: null, facts: null };
  let year = 'school_2027';
  let half = 'first';

  async function ensure(kind, force = false) {
    const ready = {
      groups: () => !force && cache.groups && cache.groupsYear === year,
      assignments: () => !force && cache.assignments && cache.assignmentsYear === year,
      summary: () => !force && cache.summary && cache.summaryYear === year && cache.summaryHalf === half,
      facts: () => !force && cache.facts && cache.factsYear === year
    }[kind]();
    if (ready) return;
    if (inflight[kind]) return inflight[kind];
    const task = (async () => {
      try {
        calls[kind] += 1;
        await Promise.resolve();
        if (kind === 'groups') { cache.groups = [{}]; cache.groupsYear = year; }
        if (kind === 'assignments') { cache.assignments = [{}]; cache.assignmentsYear = year; }
        if (kind === 'summary') { cache.summary = [{}]; cache.summaryYear = year; cache.summaryHalf = half; }
        if (kind === 'facts') { cache.facts = [{}]; cache.factsYear = year; }
      } finally {
        if (inflight[kind] === task) inflight[kind] = null;
      }
    })();
    inflight[kind] = task;
    return task;
  }

  async function loadTab(needs, force = false) {
    if (needs.includes('assignments') && needs.includes('summary')) {
      await ensure('assignments', force);
      await Promise.all(needs.filter((n) => n !== 'assignments').map((n) => ensure(n, force)));
    } else {
      await Promise.all(needs.map((n) => ensure(n, force)));
    }
  }

  return {
    calls,
    cache,
    setYear(next) {
      year = next;
      cache.groups = null; cache.groupsYear = null;
      cache.assignments = null; cache.assignmentsYear = null;
      cache.summary = null; cache.summaryYear = null; cache.summaryHalf = null;
      cache.facts = null; cache.factsYear = null;
    },
    setHalf(next) {
      half = next;
      cache.summary = null; cache.summaryYear = null; cache.summaryHalf = null;
    },
    invalidateAggregates() {
      cache.facts = null; cache.factsYear = null;
      cache.summary = null; cache.summaryYear = null; cache.summaryHalf = null;
    },
    ensure,
    loadTab
  };
}

const ALL = ['summary', 'facts', 'groups', 'assignments'];

test('cached tab switches issue no server reads; forced refresh reloads all four sources', async () => {
  const sim = createEnsureSimulator();
  await sim.loadTab(ALL, true);
  assert.deepEqual(sim.calls, { groups: 1, assignments: 1, summary: 1, facts: 1 });

  // Revisit every data tab + templates-equivalent empty needs.
  for (const needs of [ALL, ALL, ALL, ALL, ALL, []]) {
    await sim.loadTab(needs, false);
  }
  assert.deepEqual(sim.calls, { groups: 1, assignments: 1, summary: 1, facts: 1 },
    'returning to opened tabs must not refetch');

  await sim.loadTab(ALL, true);
  assert.deepEqual(sim.calls, { groups: 2, assignments: 2, summary: 2, facts: 2 });
});

test('parallel ensure of the same source coalesces to one fetch', async () => {
  const sim = createEnsureSimulator();
  await Promise.all([sim.ensure('groups'), sim.ensure('groups'), sim.ensure('groups')]);
  assert.equal(sim.calls.groups, 1);
});

test('year and half changes clear the correct cache slices before reload', async () => {
  const sim = createEnsureSimulator();
  await sim.loadTab(ALL, true);
  sim.setHalf('second');
  await sim.loadTab(ALL, false);
  assert.equal(sim.calls.summary, 2);
  assert.equal(sim.calls.groups, 1);
  assert.equal(sim.calls.facts, 1);

  sim.setYear('school_2026');
  await sim.loadTab(ALL, false);
  assert.deepEqual(sim.calls, { groups: 2, assignments: 2, summary: 3, facts: 2 });
});

test('campaign mutation invalidates aggregates and forces summary/facts refresh', async () => {
  const sim = createEnsureSimulator();
  await sim.loadTab(ALL, true);
  sim.invalidateAggregates();
  await Promise.all([sim.ensure('summary', true), sim.ensure('facts', true)]);
  assert.equal(sim.calls.summary, 2);
  assert.equal(sim.calls.facts, 2);
  assert.equal(sim.calls.groups, 1);
});

test('legacy force-on-every-tab-switch would have cost five full reloads after first entry', async () => {
  const before = createEnsureSimulator();
  await before.loadTab(ALL, true);
  for (let i = 0; i < 5; i += 1) await before.loadTab(ALL, true);

  const after = createEnsureSimulator();
  await after.loadTab(ALL, true);
  for (let i = 0; i < 5; i += 1) await after.loadTab(ALL, false);

  const beforeTotal = Object.values(before.calls).reduce((a, b) => a + b, 0);
  const afterTotal = Object.values(after.calls).reduce((a, b) => a + b, 0);
  assert.equal(beforeTotal, 24);
  assert.equal(afterTotal, 4);
  assert.equal(beforeTotal - afterTotal, 20, 'five cached tab switches save 20 RPC calls');
});

test('screen source keeps force only for entry/refresh and uses cache for tab/back', () => {
  assert.match(screen, /if \(ui\.programs\.length && tabDataReady\(key\)\)/);
  assert.match(screen, /await load\(host, \{ force: false, focusTab \}\)/);
  assert.match(screen, /data-ifb-back[\s\S]{0,400}force: false/);
  assert.match(screen, /load\(host, \{ force: true \}\);/);
  assert.match(screen, /if \(inflight\.groups\) return inflight\.groups/);
  assert.match(screen, /groupsSyncFingerprint/);
  assert.match(screen, /assignmentsSyncFingerprint/);
  assert.match(screen, /FILTER_SEARCH_DEBOUNCE_MS/);
  assert.match(screen, /await refreshAggregates\(\)/);
});

test('SQL migration filters year before program resolve and uses light cohort for summary', () => {
  assert.match(migration, /private\.feedback_instructor_cohort_starts/);
  assert.match(migration, /coalesce\(nullif\(x\.activity_season, ''\), 'regular'\) = p_academic_year/);
  assert.match(migration, /from private\.feedback_instructor_cohort_starts\(p_academic_year\)/);
  assert.doesNotMatch(
    migration.slice(migration.indexOf('feedback_admin_course_summary_for_half')),
    /from public\.feedback_admin_instructor_assignments\(p_academic_year\)/
  );
  assert.match(migration, /coalesce\(a\.instructor_assignment_locked, false\)/);
});

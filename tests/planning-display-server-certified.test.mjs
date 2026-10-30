import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isServerValidatedPlanningDisplay } from '../frontend/src/screens/course-scheduling-preflight.js';
import { schedulingPlanningStatusHtml } from '../frontend/src/screens/course-scheduling.js';

const ENGINE = 'planning-v38-20261015-transition-30-45';

function preflight({ dirtyCount = 19, source = '1755', validated = '1755', engine = ENGINE } = {}) {
  return {
    schemaVersion: 1,
    sourceRevision: source,
    dirtyCount,
    workspace: {
      engineVersion: engine,
      revision: 12686,
      validatedSourceRevision: validated
    }
  };
}

test('validated source+engine certifies display even when preflight dirtyCount > 0 from undated lead', () => {
  assert.equal(isServerValidatedPlanningDisplay({
    workspace: { engineVersion: ENGINE, revision: 12686 },
    serverPreflight: preflight({ dirtyCount: 19 }),
    storedEngineVersion: ENGINE,
    currentEngineVersion: ENGINE,
    engineChanged: false
  }), true);
});

test('display certification still fails on real source drift or engine mismatch', () => {
  assert.equal(isServerValidatedPlanningDisplay({
    workspace: { engineVersion: ENGINE },
    serverPreflight: preflight({ source: '1756', validated: '1755', dirtyCount: 0 }),
    storedEngineVersion: ENGINE,
    currentEngineVersion: ENGINE,
    engineChanged: false
  }), false);

  assert.equal(isServerValidatedPlanningDisplay({
    workspace: { engineVersion: ENGINE },
    serverPreflight: preflight({ dirtyCount: 0 }),
    storedEngineVersion: ENGINE,
    currentEngineVersion: 'planning-v39-next',
    engineChanged: true
  }), false);

  assert.equal(isServerValidatedPlanningDisplay({
    workspace: { engineVersion: ENGINE },
    serverPreflight: null,
    storedEngineVersion: ENGINE,
    currentEngineVersion: ENGINE,
    engineChanged: false
  }), false);
});

test('server-certified saved plan is not shown as globally stale; pending needs_recalc still surfaces', () => {
  const current = schedulingPlanningStatusHtml({
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '30.10.2026, 23:46',
    courseSchedulingPlanningStale: false,
    courseSchedulingPlanningAffectedIds: []
  });
  assert.match(current, /הכול מעודכן/);
  assert.doesNotMatch(current, /התכנון השמור אינו עדכני/);

  const pending = schedulingPlanningStatusHtml({
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '30.10.2026, 23:46',
    courseSchedulingPlanningStale: false,
    courseSchedulingPlanningAffectedIds: ['a', 'b']
  });
  assert.match(pending, /נדרש עדכון · 2 פעילויות/);
  assert.doesNotMatch(pending, /התכנון השמור אינו עדכני/);

  const stale = schedulingPlanningStatusHtml({
    courseSchedulingPlanningSharedLoaded: true,
    courseSchedulingPlanningCalculatedAt: '30.10.2026, 23:46',
    courseSchedulingPlanningStale: true,
    courseSchedulingPlanningStaleReason: 'נתוני הפעילויות, הזמינות או כללי התכנון השתנו מאז החישוב האחרון',
    courseSchedulingPlanningAffectedIds: []
  });
  assert.match(stale, /התכנון השמור אינו עדכני/);
});

test('applySharedPlanningState no longer gates display certification on dirtyCount', () => {
  const screen = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
  const start = screen.indexOf('const applySharedPlanningState =');
  const end = screen.indexOf('const persistUpgradedPlanningContextFingerprint', start);
  const block = screen.slice(start, end);
  assert.match(block, /isServerValidatedPlanningDisplay\(/);
  assert.doesNotMatch(block, /Number\(serverPreflight\?\.dirtyCount\)\s*===\s*0/);
  // Run-time no-op / queue queue may still require dirtyCount === 0.
  assert.match(screen, /Number\(facts\.dirtyCount\) === 0/);
});

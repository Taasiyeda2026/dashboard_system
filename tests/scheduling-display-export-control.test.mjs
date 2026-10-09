import test from 'node:test';
import assert from 'node:assert/strict';
import { schedulingPlanningStatusHtml } from '../frontend/src/screens/course-scheduling.js';
const current = { courseSchedulingPlanningSharedLoaded: true, courseSchedulingPlanningCalculatedAt: '2026-10-09', courseSchedulingPlanningRows: [{ courseId: 'c' }] };
test('saved current plan exposes Excel in the real scheduling status control', () => {
  assert.match(schedulingPlanningStatusHtml(current), /data-export-course-planning/);
});
test('Excel is unavailable for cached, stale, pending or running plans', () => {
  assert.doesNotMatch(schedulingPlanningStatusHtml(current, { snapshotStale: true }), /data-export-course-planning/);
  for (const flags of [{ courseSchedulingPlanningStale: true }, { courseSchedulingPlanningLoading: true }, { courseSchedulingPlanningAffectedIds: ['c'] }, { courseSchedulingPlanningHardGateInvalidCount: 1 }]) {
    assert.doesNotMatch(schedulingPlanningStatusHtml({ ...current, ...flags }), /data-export-course-planning/);
  }
});

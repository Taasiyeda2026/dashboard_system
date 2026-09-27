import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const storeUrl = new URL('../frontend/src/screens/course-scheduling-planning-store.js', import.meta.url);
const screenUrl = new URL('../frontend/src/screens/course-scheduling.js', import.meta.url);
const workflowUrl = new URL('../frontend/src/screens/instructor-scheduling-workflow.js', import.meta.url);
const apiUrl = new URL('../frontend/src/api.js', import.meta.url);
const migrationUrl = new URL(
  '../supabase/migrations/20260927180000_mark_scheduling_planning_needs_recalc.sql',
  import.meta.url
);

const {
  activitySchedulingFieldsChanged,
  applyLocalPlanningNeedsRecalc,
  sharedPlanningAffectedCourseIds,
  PLANNING_SCHEDULING_FIELD_KEYS
} = await import(storeUrl);

test('scheduling field helper treats gender/language/dates as planning-sensitive and notes as not', () => {
  assert.equal(
    activitySchedulingFieldsChanged(
      { required_instructor_gender: 'any' },
      { required_instructor_gender: 'female' }
    ),
    true
  );
  assert.equal(
    activitySchedulingFieldsChanged(
      { instruction_language: 'he', private_note: 'a' },
      { instruction_language: 'he', private_note: 'b' }
    ),
    false
  );
  assert.equal(
    activitySchedulingFieldsChanged(null, { operations_private_notes: 'x' }),
    false
  );
  assert.equal(
    activitySchedulingFieldsChanged(null, { required_instructor_gender: 'female' }),
    true
  );
  assert.equal(
    activitySchedulingFieldsChanged(
      { date_1: '2026-09-01' },
      { date_1: '2026-09-08' }
    ),
    true
  );
  assert.ok(PLANNING_SCHEDULING_FIELD_KEYS.includes('sessions'));
  assert.ok(PLANNING_SCHEDULING_FIELD_KEYS.includes('emp_id'));
  assert.ok(PLANNING_SCHEDULING_FIELD_KEYS.includes('gefen_number'));
});

test('local planning invalidation marks only the provided activity ids as pending', () => {
  const stamp = '2026-09-20T10:00:00Z';
  const state = {
    courseSchedulingPlanningAffectedIds: [],
    courseSchedulingPlanningShared: {
      workspace: { revision: 1 },
      rows: [
        { activityId: 'ulpanat-bari', needsRecalc: false, activityUpdatedAt: stamp, row: { courseId: 'ulpanat-bari', planningLocked: false } },
        { activityId: 'other-1', needsRecalc: false, activityUpdatedAt: stamp, row: { courseId: 'other-1' } },
        { activityId: 'other-2', needsRecalc: false, activityUpdatedAt: stamp, row: { courseId: 'other-2' } }
      ]
    },
    courseSchedulingPlanningRows: [
      { courseId: 'ulpanat-bari', planningLocked: true, kind: 'locked', status: 'נעול' },
      { courseId: 'other-1', planningLocked: false }
    ]
  };

  const pending = applyLocalPlanningNeedsRecalc(state, { activityIds: ['ulpanat-bari'] });
  assert.deepEqual(pending, ['ulpanat-bari']);
  assert.equal(state.courseSchedulingPlanningShared.rows[0].needsRecalc, true);
  assert.equal(state.courseSchedulingPlanningShared.rows[1].needsRecalc, false);
  assert.equal(state.courseSchedulingPlanningShared.rows[2].needsRecalc, false);
  assert.equal(state.courseSchedulingPlanningRows[0].status, 'ממתין לעדכון תכנון');
  assert.equal(state.courseSchedulingPlanningRows[0].planningLocked, false);

  const needsRecalcOnly = (state.courseSchedulingPlanningShared.rows || [])
    .filter((entry) => entry?.needsRecalc === true)
    .map((entry) => entry.activityId);
  assert.deepEqual(needsRecalcOnly, ['ulpanat-bari']);
  assert.notEqual(state.courseSchedulingPlanningShared.rows.length, needsRecalcOnly.length);
  assert.equal(state.courseSchedulingPlanningShared.rows.length, 3);

  // When versions still match, needsRecalc alone drives the pending set — not a full workspace.
  const affected = sharedPlanningAffectedCourseIds({
    shared: state.courseSchedulingPlanningShared,
    activities: [
      { row_id: 'ulpanat-bari', updated_at: stamp, emp_id: null },
      { row_id: 'other-1', updated_at: stamp, emp_id: null },
      { row_id: 'other-2', updated_at: stamp, emp_id: null }
    ],
    currentCourseIds: ['ulpanat-bari', 'other-1', 'other-2']
  });
  assert.deepEqual(affected, ['ulpanat-bari']);
  assert.notEqual(affected.length, 248);
});

test('planning status UI never shows הכל מעודכן while pending, and supports incremental label', async () => {
  const screen = await readFile(screenUrl, 'utf8');
  assert.match(screen, /נדרש עדכון תכנון · \$\{pending\} פעילויות/);
  assert.match(screen, /עדכון שינויים בלבד · \$\{countLabel\} פעילויות/);
  assert.match(screen, /<strong>הכל מעודכן<\/strong>/);
  assert.match(screen, /app:planning-needs-recalc/);
  assert.match(screen, /applyLocalPlanningNeedsRecalc/);
  assert.doesNotMatch(
    screen.slice(screen.indexOf('function schedulingPlanningStatusHtml'), screen.indexOf('function genderRequirementLabel')),
    /התכנון מעודכן/
  );
});

test('activity requirement and saveActivity paths explicitly invalidate planning after scheduling edits', async () => {
  const [workflow, api, store, migration] = await Promise.all([
    readFile(workflowUrl, 'utf8'),
    readFile(apiUrl, 'utf8'),
    readFile(storeUrl, 'utf8'),
    readFile(migrationUrl, 'utf8')
  ]);
  assert.match(workflow, /invalidatePlanningAfterActivitySchedulingSave/);
  assert.match(workflow, /source: 'scheduling-requirements'/);
  assert.match(api, /invalidatePlanningAfterActivitySchedulingSave/);
  assert.match(api, /activitySchedulingFieldsChanged/);
  assert.match(store, /mark_scheduling_planning_needs_recalc/);
  assert.match(store, /notifyPlanningNeedsRecalc/);
  assert.match(migration, /create or replace function public\.mark_scheduling_planning_needs_recalc/);
  assert.match(migration, /scheduling_planning_sensitive_changed/);
  assert.match(migration, /activities_invalidate_planning_rows/);
  assert.match(migration, /needs_recalc = true/);
  assert.match(migration, /p_require_permission boolean default true/);
  assert.match(migration, /locked_option is null/);
  assert.doesNotMatch(migration, /update\s+public\.scheduling_planning_rows\s+r\s+set\s+needs_recalc\s*=\s*true\s+where\s+r\.workspace_id\s*=\s*workspace_rec\.id\s*;/);
});

test('olpanat bari gender any->female is treated as pending planning work for one activity', () => {
  const before = {
    row_id: 'ulpanat-bari-rokchim',
    activity_name: 'רוקחים עולם',
    school: 'אולפנת בארי',
    required_instructor_gender: 'any',
    instruction_language: 'he'
  };
  const after = { ...before, required_instructor_gender: 'female' };
  assert.equal(activitySchedulingFieldsChanged(before, after), true);

  const state = {
    courseSchedulingPlanningAffectedIds: [],
    courseSchedulingPlanningShared: {
      rows: [
        {
          activityId: before.row_id,
          needsRecalc: false,
          activityUpdatedAt: '2026-09-20T10:00:00Z',
          row: {
            courseId: before.row_id,
            instructorEmpId: 'elder-michael',
            instructorName: 'אלדר מיכאל טייב',
            options: [{ instructorEmpId: 'elder-michael', instructorName: 'אלדר מיכאל טייב' }]
          }
        }
      ]
    },
    courseSchedulingPlanningRows: [{
      courseId: before.row_id,
      instructorEmpId: 'elder-michael',
      instructorName: 'אלדר מיכאל טייב',
      planningLocked: false
    }]
  };
  applyLocalPlanningNeedsRecalc(state, { activityIds: [before.row_id] });
  assert.deepEqual(state.courseSchedulingPlanningAffectedIds, [before.row_id]);
  assert.equal(state.courseSchedulingPlanningShared.rows[0].needsRecalc, true);
});

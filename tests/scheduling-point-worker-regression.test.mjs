import test from 'node:test';
import assert from 'node:assert/strict';

import { SchedulingPointWorker } from '../frontend/src/screens/course-scheduling-worker-client.js';
import {
  planningRowPatches,
  applyPlanningRowPatches,
  planningRouteReply,
  planningCloneError
} from '../frontend/src/screens/course-scheduling-worker-protocol.js';

const input = () => ({
  targetCourseIds: ['a'],
  allowGlobalRepair: false,
  activities: [{ row_id: 'a', activity_type: 'קורס' }],
  instructors: [],
  profiles: {},
  rules: {},
  exceptions: {},
  schoolCalendar: [],
  catalog: [],
  existingRows: [],
  committedRows: [],
  lockedOptions: {}
});
const hooks = { owner: 'admin-test', version: 'source-rev-1', assertActive() {} };

test('worker row delta retains untouched row identity and removes obsolete fields', () => {
  const unchanged = { courseId: 'b', options: [{ instructorEmpId: '2' }] };
  const prior = [{ courseId: 'a', obsolete: 1, options: [{ instructorEmpId: '1' }] }, unchanged];
  const next = [unchanged, { courseId: 'a', options: prior[0].options, startDate: '2026-10-19' }];
  const delta = planningRowPatches(next, prior);
  const restored = applyPlanningRowPatches(delta, prior);

  assert.deepEqual(restored, next);
  assert.equal(restored[0], unchanged);
  assert.equal(restored[1].options, prior[0].options);
  assert.equal(prior[0].obsolete, 1);
  assert.equal(restored[1].obsolete, undefined);
  assert.equal(delta.patches.length, 1);
  assert.deepEqual(delta.order, ['b', 'a']);
});

test('invalid delta cannot silently drop a referenced course row', () => {
  assert.throws(
    () => applyPlanningRowPatches({ order: ['missing'], patches: [] }, []),
    { code: 'planning_worker_protocol_error' }
  );
});

test('route broker sends only serializable error metadata, never response or credentials', () => {
  const error = Object.assign(new Error('route failure'), {
    code: '429',
    response: { headers: { authorization: 'PRIVATE_BEARER' } }
  });
  const reply = planningRouteReply({ data: null, error });
  assert.deepEqual(reply, { data: null, error: { message: 'route failure', code: '429' } });
  assert.doesNotMatch(JSON.stringify(reply), /PRIVATE_BEARER|authorization|response/i);
  assert.deepEqual(structuredClone(reply), reply);
});

test('clone errors show the failing field path without logging field values', () => {
  const error = Object.assign(new Error('clone failed'), { name: 'DataCloneError' });
  const payload = { type: 'snapshot-patch', entries: [['0', { callback: () => 1, secret: 'DO_NOT_ECHO' }]] };
  const result = planningCloneError(error, payload);
  assert.equal(result.code, 'planning_worker_data_clone_failed');
  assert.match(result.transportPath, /^snapshot-patch\\.entries\\.0\\.1\\.callback$/);
  assert.doesNotMatch(result.message, /DO_NOT_ECHO/);
});

test('scoped point planning rejects national repair without instantiating a Worker', async () => {
  let created = 0;
  const client = new SchedulingPointWorker({ createWorker: () => { created++; throw Error('unexpected worker'); } });
  await assert.rejects(client.run({ ...input(), targetCourseIds: null }, hooks), {
    code: 'planning_worker_scope_required'
  });
  await assert.rejects(client.run({ ...input(), allowGlobalRepair: true }, hooks), {
    code: 'planning_worker_scope_required'
  });
  assert.equal(created, 0);
  assert.equal(client.worker, null);
});

function mockedWorkerFactory(workers, { stale = false } = {}) {
  return () => {
    const mock = {
      messages: [],
      terminated: false,
      postMessage(message) {
        this.messages.push(message);
        queueMicrotask(() => {
          if (this.terminated) return;
          const result = message.type === 'run'
            ? {
                id: message.id,
                version: stale ? 'stale-source-revision' : message.version,
                summary: { finalPlanValidation: { valid: true } },
                delta: { order: ['a'], patches: [{ id: 'a', set: { courseId: 'a', kind: 'proposal' }, remove: [] }] }
              }
            : { id: message.id };
          this.onmessage?.({ data: result });
        });
      },
      terminate() { this.terminated = true; }
    };
    workers.push(mock);
    return mock;
  };
}

test('resident Worker reuses unchanged snapshots, preserves input and isolates owners', async () => {
  const workers = [];
  const client = new SchedulingPointWorker({
    createWorker: mockedWorkerFactory(workers),
    yieldControl: async () => {}
  });
  const data = input();
  const original = JSON.stringify(data);
  try {
    const first = await client.run(data, hooks);
    assert.deepEqual(first.rows, [{ courseId: 'a', kind: 'proposal' }]);
    const entryCount = client.metrics.changedEntries;
    assert.ok(entryCount > 0);
    const resident = client.worker;

    const again = await client.run(data, hooks);
    assert.deepEqual(again.rows, first.rows);
    assert.equal(client.worker, resident);
    assert.equal(client.metrics.changedEntries, entryCount);
    assert.equal(JSON.stringify(data), original);

    await client.run(data, { ...hooks, owner: 'different-owner' });
    assert.equal(resident.terminated, true);
    assert.notEqual(client.worker, resident);
    assert.equal(workers.length, 2);
  } finally {
    client.dispose();
  }
});

test('stale Worker responses reject and terminate rather than accepting unsafe planning rows', async () => {
  const workers = [];
  const client = new SchedulingPointWorker({
    createWorker: mockedWorkerFactory(workers, { stale: true }),
    yieldControl: async () => {}
  });
  try {
    await assert.rejects(client.run(input(), hooks), { code: 'planning_worker_revision_conflict' });
    assert.equal(client.worker, null);
    assert.equal(workers[0].terminated, true);
  } finally {
    client.dispose();
  }
});

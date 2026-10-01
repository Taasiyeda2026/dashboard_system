import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

if (!globalThis.sessionStorage) {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}
if (!globalThis.localStorage) globalThis.localStorage = globalThis.sessionStorage;

const { updateActivityStatusOnly } = await import('../frontend/src/api.js');
const noInvalidation = { invalidateCache: () => {}, invalidatePlanning: async () => {} };

function statusClient({ before = 'פתוח', updateError = null, after = 'סגור' } = {}) {
  const calls = [];
  let readCount = 0;
  return {
    calls,
    from(table) {
      assert.equal(table, 'activities');
      return {
        select(columns) {
          calls.push({ type: 'select', columns });
          const result = readCount++ === 0
            ? { data: { activity_season: 'school_2027', start_date: '2026-10-01' }, error: null }
            : { data: { row_id: 'ACT-1', status: updateError ? after : before, updated_at: '2026-10-01T00:00:00Z' }, error: null };
          return terminalQuery(result);
        },
        update(changes) {
          calls.push({ type: 'update', changes });
          return updateQuery(calls, updateError
            ? { data: null, error: updateError }
            : { data: { row_id: 'ACT-1', status: changes.status, updated_at: '2026-10-01T00:00:00Z' }, error: null });
        },
      };
    },
  };
}

function terminalQuery(result) {
  return {
    eq() { return this; },
    async maybeSingle() { return result; },
  };
}

function updateQuery(calls, result) {
  return {
    eq() { return this; },
    select(columns) {
      calls.push({ type: 'returning', columns });
      return this;
    },
    async maybeSingle() { return result; },
  };
}

test('status-only save performs a minimal update and returning projection without instructor validation reads', async () => {
  const client = statusClient();

  const result = await updateActivityStatusOnly({ client, rowId: 'ACT-1', status: 'סגור', ...noInvalidation });

  assert.equal(result.row.status, 'סגור');
  assert.deepEqual(client.calls, [
    { type: 'select', columns: 'activity_season,start_date' },
    { type: 'update', changes: { status: 'סגור' } },
    { type: 'returning', columns: 'row_id,status,updated_at' },
  ]);
  assert.equal(client.calls.some((call) => String(call.columns || '').includes('instructor_name')), false);
});

test('timeout after a committed status update is accepted after one verification read', async () => {
  const client = statusClient({
    updateError: { status: 504, message: 'Warp server error: Thread killed by timeout manager' },
    after: 'סגור',
  });

  const result = await updateActivityStatusOnly({ client, rowId: 'ACT-1', status: 'סגור', ...noInvalidation });

  assert.equal(result.row.status, 'סגור');
  assert.equal(client.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(client.calls.filter((call) => call.type === 'select').length, 2);
  assert.equal(client.calls.at(-1).columns, 'row_id,status,updated_at');
});

test('timeout before persistence verifies once and returns the original update error without retrying', async () => {
  const client = statusClient({
    updateError: { status: 504, message: 'request timeout' },
    after: 'פתוח',
  });

  await assert.rejects(
    updateActivityStatusOnly({ client, rowId: 'ACT-1', status: 'סגור', ...noInvalidation }),
    /request timeout/,
  );
  assert.equal(client.calls.filter((call) => call.type === 'update').length, 1);
  assert.equal(client.calls.filter((call) => call.type === 'select').length, 2);
});

test('mixed-field edits remain on the existing full update path', async () => {
  const source = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  const fastPath = source.indexOf("Object.keys(submittedChanges).length === 1");
  const genericInstructorRead = source.indexOf(".select('instructor_name,instructor_name_2,emp_id,emp_id_2,activity_season,start_date')", fastPath);
  const genericValidation = source.indexOf('await validateActivityInstructorBindingsOrThrow', genericInstructorRead);

  assert.ok(fastPath > 0);
  assert.ok(genericInstructorRead > fastPath);
  assert.ok(genericValidation > genericInstructorRead);
  assert.match(source.slice(fastPath, genericInstructorRead), /hasOwnProperty\.call\(submittedChanges, 'status'\)/);
});

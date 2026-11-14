import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../frontend/src/instructor-onboarding-access-runtime.js', import.meta.url), 'utf8')).replace(/^import .*;\n/, '');

test('onboarding wrapper preserves the original query builder for scoped paginated management RPCs', async () => {
  const builder = { select() { return this; }, in() { return this; }, range() { return Promise.resolve({ data: [{ row_id: 'synthetic' }], error: null }); } };
  const supabase = { rpc: () => builder, functions: { invoke: () => assert.fail('a read must never provision access') } };
  vm.runInNewContext(source, { supabase, console });
  for (const name of ['feedback_admin_groups', 'feedback_admin_instructor_assignments', 'get_payroll_attendance_records']) {
    assert.equal(supabase.rpc(name), builder);
    assert.equal((await supabase.rpc(name).select('row_id').in('row_id', ['synthetic']).range(0, 499)).data.length, 1);
  }
});

test('onboarding success and failed creation retain their existing provision behavior', async () => {
  let result = { data: [{ emp_id: 7 }], error: null };
  const calls = [];
  const supabase = { rpc: () => Promise.resolve(result), functions: { invoke: async (name, args) => { calls.push({ name, args }); return { data: { ok: true }, error: null }; } } };
  vm.runInNewContext(source, { supabase, console });
  assert.equal(await supabase.rpc('create_instructor_onboarding'), result);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.body.emp_id, 7);
  result = { data: null, error: { message: 'denied' } };
  assert.equal(await supabase.rpc('create_instructor_onboarding'), result);
  assert.equal(calls.length, 1);
});

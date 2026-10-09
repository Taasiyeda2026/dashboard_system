// Manual-only isolated Supabase acceptance. Never run against a hosted database.
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
const enabled = Boolean(process.env.SCHEDULING_ACCEPTANCE_DB_URL && process.env.SCHEDULING_ACCEPTANCE_SESSION_FILE);
test('isolated display detail RPC: bounded conflicts and coherent reads with a writer', { skip: !enabled }, async t => {
  const url = new URL(process.env.SCHEDULING_ACCEPTANCE_DB_URL);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'only isolated loopback databases permitted');
  const apiUrl = new URL(process.env.SCHEDULING_ACCEPTANCE_API_URL || 'http://127.0.0.1:56300');
  assert.ok(['127.0.0.1', 'localhost'].includes(apiUrl.hostname));
  const session = JSON.parse(await readFile(process.env.SCHEDULING_ACCEPTANCE_SESSION_FILE)).admin;
  const db = new pg.Client({ connectionString: url.href });
  const writer = new pg.Client({ connectionString: url.href });
  await db.connect(); await writer.connect();
  const id = '00000000-0000-4000-8000-000000000003';
  let transaction = false, originalRevision;
  try {
    const fixture = (await db.query('SELECT activity_id FROM public.scheduling_planning_rows WHERE workspace_id=$1', [id])).rows;
    assert.equal(fixture.length, 253);
    assert.ok(fixture.every(r => r.activity_id.startsWith('synthetic-')), 'refuse non-synthetic data');
    originalRevision = Number((await db.query('SELECT revision FROM public.scheduling_planning_workspaces WHERE id=$1', [id])).rows[0].revision);
    const request = async revision => {
      const start = performance.now();
      const response = await fetch(`${apiUrl.origin}/rpc/get_scheduling_planning_row_details`, {
        signal: AbortSignal.timeout(1500), method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_workspace_id: id, p_activity_id: 'synthetic-0', p_expected_revision: revision })
      });
      const body = await response.json();
      const ms = performance.now() - start;
      assert.ok(ms < 1000, `isolated regression bound: ${ms}ms`);
      t.diagnostic(JSON.stringify({ revision, status: response.status, code: body.code, ms }));
      return { response, body };
    };
    await t.test('obsolete revision returns PT409 promptly on repeated real HTTP requests', async () => {
      for (let i = 0; i < 10; i++) {
        const r = await request(originalRevision - 1);
        assert.equal(r.response.status, 409); assert.equal(r.body.code, 'PT409');
        assert.equal(r.body.message, 'planning_revision_conflict');
      }
    });
    await t.test('uncommitted writer does not block current snapshot reads or future revision rejection', async () => {
      await writer.query('BEGIN'); transaction = true;
      await writer.query('UPDATE public.scheduling_planning_workspaces SET revision=$2 WHERE id=$1', [id, originalRevision + 1]);
      assert.equal((await request(originalRevision)).response.status, 200);
      assert.equal((await request(originalRevision + 1)).response.status, 409);
    });
    await t.test('after writer commit the obsolete revision is rejected and new revision succeeds', async () => {
      await writer.query('COMMIT'); transaction = false;
      assert.equal((await request(originalRevision)).response.status, 409);
      assert.equal((await request(originalRevision + 1)).response.status, 200);
    });
  } finally {
    if (transaction) await writer.query('ROLLBACK');
    if (originalRevision !== undefined) await writer.query('UPDATE public.scheduling_planning_workspaces SET revision=$2 WHERE id=$1', [id, originalRevision]);
    await writer.end(); await db.end();
  }
});

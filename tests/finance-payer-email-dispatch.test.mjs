import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { financeError } from '../frontend/src/screens/finance-errors.js';

const edge = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');
const source = stripTypeScriptTypes(
  edge.slice(edge.indexOf('function recipientAddresses'), edge.indexOf('async function graphToken')) +
  edge.slice(edge.indexOf('Deno.serve(async'))
);

async function dispatch({ status = 'generating', recipients = [] } = {}) {
  const calls = [];
  let handler;
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { document_status: status } }),
        }),
      }),
    }),
    rpc: async (name) => {
      calls.push(name);
      if (name === 'finance_transaction_can_issue') return { data: true };
      if (name === 'finance_transaction_recipients') return { data: { recipients } };
      return {};
    },
  };
  runInNewContext(source, {
    Deno: { serve: callback => { handler = callback; }, env: { get: () => 'test' } },
    createClient: () => db,
    graphToken: async () => {
      calls.push('graphToken');
      throw new Error('graph_not_configured');
    },
    clean: value => String(value ?? '').trim(),
    crypto, Response, cors: {},
  });
  const response = await handler(new Request('https://example.test/finance', {
    method: 'POST',
    body: JSON.stringify({ accountId: 'test-account' }),
  }));
  return { calls, status: response.status, body: await response.json() };
}

test('invalid payer email cancels new issuance before any Graph or finalization call', async () => {
  const result = await dispatch({ recipients: ['invalid-address'] });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, 'no_valid_payer_email');
  assert.equal(financeError(new Error(result.body.error)), 'חסרה כתובת דוא״ל של הגורם המשלם');
  assert.deepEqual(result.calls, [
    'finance_transaction_can_issue',
    'acquire_finance_dispatch',
    'validate_finance_dispatch',
    'finance_transaction_recipients',
    'cancel_finance_dispatch',
    'release_finance_dispatch',
  ]);
});

test('a valid payer email lets issuance proceed to Graph', async () => {
  const result = await dispatch({ recipients: ['billing@example.test'] });
  assert.equal(result.body.error, 'graph_not_configured');
  assert.ok(result.calls.indexOf('finance_transaction_recipients') < result.calls.indexOf('graphToken'));
});

test('an issued account retry does not cancel its existing document when Graph fails', async () => {
  const result = await dispatch({ status: 'issued' });
  assert.equal(result.body.documentPreserved, true);
  assert.equal(result.body.outlookStatus, 'failed');
  assert.ok(!result.calls.includes('cancel_finance_dispatch'));
});

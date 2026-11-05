import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnDir = join(root, 'supabase/functions/finance-transaction-accounts');
const indexPath = join(fnDir, 'index.ts');
const revisionPath = join(fnDir, 'revision-dispatch.ts');
const workflowPath = join(root, '.github/workflows/deploy-finance-transaction-accounts.yml');
const verifyScript = join(root, 'scripts/ci/verify-finance-transaction-accounts-deploy.mjs');

const index = readFileSync(indexPath, 'utf8');
const revision = readFileSync(revisionPath, 'utf8');
const workflow = readFileSync(workflowPath, 'utf8');

test('finance-transaction-accounts ships both source files for CLI deploy', () => {
  assert.equal(existsSync(indexPath), true);
  assert.equal(existsSync(revisionPath), true);
  assert.match(index, /from '\.\/revision-dispatch\.ts'/);
  assert.match(revision, /export async function handleInvoiceRevision/);
  assert.match(revision, /export async function updateInvoiceDraft/);
});

test('sources are full implementations without CDN or temporary deploy wrappers', () => {
  for (const [name, source] of [['index.ts', index], ['revision-dispatch.ts', revision]]) {
    assert.doesNotMatch(source, /(?:from|import)\s+['"][^'"]*cdn\.jsdelivr\.net/i, name);
    assert.doesNotMatch(source, /(?:from|import)\s+['"][^'"]*raw\.githubusercontent\.com/i, name);
    assert.doesNotMatch(source, /\$file:/, name);
    assert.doesNotMatch(source, /PLACEHOLDER/, name);
    assert.doesNotMatch(source, /(?:from|import)\s+['"]https?:\/\//i, name);
  }
  assert.ok(index.length > 20_000, 'index.ts must remain the full Edge entrypoint');
  assert.ok(revision.length > 2_000, 'revision-dispatch.ts must remain the full revision module');
});

test('PDF issuance, revision edit path and SharePoint storage markers stay wired', () => {
  assert.match(index, /async function buildPdf/);
  assert.match(index, /Always address the paying party/);
  assert.match(index, /courseWidths = \[100, 125, 58, 42, 46, 74, 90\]/);
  assert.match(index, /sharepoint_upload_failed/);
  assert.match(index, /validateTransactionFolder/);
  assert.match(index, /handleInvoiceRevision/);
  assert.match(index, /updateInvoiceDraft/);
  assert.match(revision, /finish_finance_invoice_revision/);
  assert.match(revision, /begin_finance_invoice_revision/);
  assert.match(revision, /buildPdf/);
  assert.match(revision, /sharepoint_upload_failed/);
  assert.doesNotMatch(revision, /\/send[`'"]/);
});

test('deploy workflow uses official CLI, secrets, and never runs migrations', () => {
  assert.match(workflow, /supabase\/setup-cli@v1/);
  assert.match(workflow, /supabase functions deploy finance-transaction-accounts/);
  assert.match(workflow, /secrets\.SUPABASE_ACCESS_TOKEN/);
  assert.match(workflow, /--use-api/);
  assert.match(workflow, /supabase functions download finance-transaction-accounts/);
  assert.match(workflow, /verify-finance-transaction-accounts-deploy\.mjs/);
  assert.doesNotMatch(workflow, /^\s*supabase\s+db\b/m);
  assert.doesNotMatch(workflow, /^\s*supabase\s+migration\b/m);
  assert.doesNotMatch(workflow, /^\s*supabase\s+config\s+push\b/m);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
});

test('post-download verifier accepts the local full sources', () => {
  const result = spawnSync(process.execPath, [verifyScript, fnDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /"ok": true/);
});

test('post-download verifier rejects a CDN shim payload', () => {
  const tmp = join('/tmp', `fta-shim-${process.pid}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(
    join(tmp, 'index.ts'),
    [
      '// Always address the paying party',
      'async function buildPdf(){}',
      "import { handleInvoiceRevision, updateInvoiceDraft } from './revision-dispatch.ts';",
      'courseWidths = [100, 125, 58, 42, 46, 74, 90]',
      'sharepoint_upload_failed',
      'validateTransactionFolder',
      'import "https://cdn.jsdelivr.net/gh/example/index.ts";',
    ].join('\n').padEnd(21_000, ' ')
  );
  writeFileSync(
    join(tmp, 'revision-dispatch.ts'),
    [
      'export async function handleInvoiceRevision(){}',
      'export async function updateInvoiceDraft(){}',
      'buildPdf',
      'finish_finance_invoice_revision',
      'begin_finance_invoice_revision',
      'sharepoint_upload_failed',
    ].join('\n').padEnd(2_100, ' ')
  );
  try {
    const result = spawnSync(process.execPath, [verifyScript, tmp], { encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /banned deploy pattern/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

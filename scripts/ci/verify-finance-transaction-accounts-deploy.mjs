#!/usr/bin/env node
/**
 * Verifies that a downloaded (or local) finance-transaction-accounts payload
 * is the full source tree — not a CDN shim, $file: remote, or placeholder.
 *
 * Usage:
 *   node scripts/ci/verify-finance-transaction-accounts-deploy.mjs [dir]
 * Default dir: supabase/functions/finance-transaction-accounts
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const targetDir = process.argv[2]
  ? process.argv[2]
  : join(root, 'supabase/functions/finance-transaction-accounts');

const requiredFiles = ['index.ts', 'revision-dispatch.ts'];

// Ban deploy wrappers / remote code loaders — not asset fetch URLs used by PDF rendering.
const bannedPatterns = [
  { name: 'jsDelivr CDN import', re: /(?:from|import)\s+['"][^'"]*cdn\.jsdelivr\.net/i },
  { name: 'raw GitHub source import', re: /(?:from|import)\s+['"][^'"]*raw\.githubusercontent\.com/i },
  { name: 'Deno $file remote', re: /\$file:/ },
  { name: 'PLACEHOLDER stub', re: /PLACEHOLDER/ },
  { name: 'http(s) module import', re: /(?:from|import)\s+['"]https?:\/\//i },
];

const requiredMarkers = {
  'index.ts': [
    'async function buildPdf',
    'Always address the paying party',
    'courseWidths = [100, 125, 58, 42, 46, 74, 90]',
    'sharepoint_upload_failed',
    'validateTransactionFolder',
    'handleInvoiceRevision',
    'updateInvoiceDraft',
    "from './revision-dispatch.ts'",
  ],
  'revision-dispatch.ts': [
    'export async function handleInvoiceRevision',
    'export async function updateInvoiceDraft',
    'finish_finance_invoice_revision',
    'begin_finance_invoice_revision',
    'buildPdf',
    'sharepoint_upload_failed',
  ],
};

const minBytes = {
  'index.ts': 20_000,
  'revision-dispatch.ts': 2_000,
};

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
  fail(`target directory missing: ${targetDir}`);
}

const report = { dir: targetDir, files: {} };

for (const name of requiredFiles) {
  const path = join(targetDir, name);
  if (!existsSync(path)) fail(`missing required file: ${name}`);
  const source = readFileSync(path, 'utf8');
  const bytes = Buffer.byteLength(source, 'utf8');
  report.files[name] = { bytes };

  if (bytes < minBytes[name]) {
    fail(`${name} too small (${bytes} bytes); expected full source (>= ${minBytes[name]})`);
  }

  for (const { name: banName, re } of bannedPatterns) {
    if (re.test(source)) fail(`${name} contains banned deploy pattern (${banName}): ${re}`);
  }

  for (const marker of requiredMarkers[name]) {
    if (!source.includes(marker)) fail(`${name} missing required marker: ${marker}`);
  }
}

console.log(JSON.stringify({ ok: true, ...report }, null, 2));

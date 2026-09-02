import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screen = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const integrity = await readFile(new URL('../frontend/src/proposal-workflow-ui-integrity.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../supabase/functions/proposal-final-pdf/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260902150000_proposal_server_pdf_generation.sql', import.meta.url), 'utf8');

test('signed approval returns after persistence and queues server PDF without awaiting it', () => {
  const approval = screen.slice(screen.indexOf('const approveProposalWithSignature'), screen.indexOf('const openPreview'));
  assert.match(approval, /await Promise\.race\([\s\S]*updateProposalAgreementStatus/);
  assert.match(approval, /void api\.requestProposalFinalPdf/);
  assert.doesNotMatch(approval, /proposalHtmlToPdfBlob|window\.print|window\.open/);
  assert.match(api, /functions\.invoke\('proposal-final-pdf'/);
  assert.doesNotMatch(integrity, /scheduleAutomaticPdf|button\.click\(\)/);
});

test('background worker uses Chromium PDF endpoint, timeout, print CSS and real PDF validation', () => {
  assert.match(worker, /\/pdf\?token=/);
  assert.match(worker, /format: "A4", printBackground: true, preferCSSPageSize: true/);
  assert.match(worker, /AbortController/);
  assert.match(worker, /proposal_print_css_not_found/);
  assert.match(worker, /decode\(pdf\.slice\(0, 5\)\) !== "%PDF-"/);
  assert.doesNotMatch(worker, /canvas|jpeg|screenshot|window\.print/);
});

test('PDF jobs are idempotent, observable and preserve an approved proposal on failure', () => {
  assert.match(worker, /"duplicate-skipped"/);
  assert.match(worker, /\.in\("final_pdf_generation_status", \["idle", "queued", "failed"\]\)/);
  assert.match(worker, /final_pdf_generation_status: "failed"/);
  assert.doesNotMatch(worker, /status:\s*"(?:draft|cancelled)"/);
  assert.match(migration, /'idle', 'queued', 'generating', 'completed', 'failed'/);
});

test('PDF migration preserves the complete proposal workflow guard', () => {
  assert.match(migration, /if coalesce\(auth\.role\(\), ''\) = 'service_role' then return new; end if;/);
  for (const invariant of [
    'proposal_status_transition_sent_locked',
    'proposal_sent_content_locked',
    'proposal_status_transition_cancelled_locked',
    'proposal_cancelled_content_locked',
    'proposal_status_transition_approval_invalid',
    'proposal_status_transition_return_invalid',
    'proposal_status_transition_cancel_invalid',
    'proposal_status_transition_pending_invalid',
    'proposal_status_transition_draft_invalid',
    'proposal_status_transition_sent_invalid',
    'invalid_proposal_agreement_status_transition',
    'gfen_signed_or_ordered'
  ]) assert.match(migration, new RegExp(invariant));
});

test('worker prefers configured dashboard base and uses the correct production fallback', () => {
  assert.match(worker, /DASHBOARD_PUBLIC_BASE_URL/);
  assert.match(worker, /https:\/\/taasiyeda2026\.github\.io\/dashboard_system\//);
  assert.doesNotMatch(worker, /https:\/\/taasiyeda\.github\.io\/dashboard_system\//);
});

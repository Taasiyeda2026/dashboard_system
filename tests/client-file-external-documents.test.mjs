import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import {
  externalClientDocumentsHtml,
  externalClientDocumentFormHtml,
  externalClientDocumentRowsHtml,
} from '../frontend/src/client-file-external-documents.js';

const source = await readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20261013192000_client_file_external_documents.sql', import.meta.url), 'utf8');

test('external document controls render only for selected client files, never in proposal lists', () => {
  const withinSelected = source.slice(source.indexOf('function selectedClientFileHtml('), source.indexOf('function clientContactEditorHtml('));
  const landing = source.slice(source.indexOf('function clientFileLandingHtml('), source.indexOf('function clientSearchResultsHtml('));
  const table = source.slice(source.indexOf('export function proposalsAgreementsTableRowsHtml('), source.indexOf('function clientFileLandingHtml('));
  assert.match(withinSelected, /externalClientDocumentsHtml\(canManage\)/);
  assert.doesNotMatch(landing, /externalClientDocumentsHtml|mountClientExternalDocuments/);
  assert.doesNotMatch(table, /externalClientDocumentsHtml|mountClientExternalDocuments/);
  const mounts = source.match(/mountClientExternalDocuments\(clientWorkspace, file, \{ canManage, signal \}\)/g) || [];
  assert.equal(mounts.length, 2, 'selected file and returning from proposal details both hydrate their documents');
});

test('viewers can see documents but only managers get the add and delete actions', () => {
  assert.match(externalClientDocumentsHtml(true), /data-ext-add/);
  assert.doesNotMatch(externalClientDocumentsHtml(false), /data-ext-add/);
  const row = { id: 'example', document_kind: 'quote', title: 'הצעה מגורם חיצוני', file_path: 'documents/example.pdf', amount: 8000 };
  assert.match(externalClientDocumentRowsHtml([row], true), /הצעת מחיר חיצונית/);
  assert.match(externalClientDocumentRowsHtml([row], true), /data-ext-delete/);
  assert.doesNotMatch(externalClientDocumentRowsHtml([row], false), /data-ext-delete/);
  assert.match(externalClientDocumentRowsHtml([{ ...row, document_kind: 'agreement' }]), /הסכם חיצוני/);
});

test('external document form requires PDF and includes external metadata, not workflow fields', () => {
  const document = new JSDOM('<body>' + externalClientDocumentFormHtml() + '</body>').window.document;
  for (const name of ['document_kind', 'title', 'document_date', 'amount', 'document_file', 'notes']) {
    assert.ok(document.querySelector('[name="' + name + '"]'), name);
  }
  assert.equal(document.querySelector('[name="document_file"]').getAttribute('accept'), '.pdf,application/pdf');
  assert.ok(document.querySelector('[name="title"]').required);
  assert.ok(document.querySelector('[name="document_file"]').required);
  assert.equal(document.querySelector('[name="document_kind"] option[value="quote"]').textContent, 'הצעת מחיר חיצונית');
  assert.equal(document.querySelector('[name="external_number"]'), null, 'external document number is hidden from the new form');
  assert.equal(document.querySelectorAll('.ds-client-external__fields > label').length, 6, 'three compact symmetrical rows');
  assert.equal(document.querySelectorAll('[data-ext-full]').length, 0, 'PDF and notes occupy equal-width columns');
  assert.doesNotMatch(document.body.innerHTML, /quote_number|approval_status|gefen_number|proposal_agreement_id/);
});

test('external document form is centered, compact and symmetrical on desktop', async () => {
  const source = await readFile(new URL('../frontend/src/client-file-external-documents.js', import.meta.url), 'utf8');
  assert.match(source, /\.ds-client-external__form\{[^}]*max-width:900px/);
  assert.match(source, /\.ds-client-external__fields\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(source, /@media\(max-width:640px\)\{\.ds-client-external__fields\{grid-template-columns:1fr\}\}/);
  assert.doesNotMatch(externalClientDocumentFormHtml(), /external_number|data-ext-full/);
});

test('external document metadata is escaped in client-file HTML', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = externalClientDocumentRowsHtml([{ id: bad, title: bad, document_kind: 'agreement', amount: null }], true);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /data-ext-row="<img/);
});

test('backend isolates external files with own private bucket and RLS, no proposal writes', () => {
  assert.match(migration, /create table if not exists public\.client_external_documents/);
  assert.match(migration, /alter table public\.client_external_documents enable row level security/);
  assert.match(migration, /public\.app_can_view_proposals_agreements\(\)/);
  assert.match(migration, /public\.app_can_manage_proposals_agreements\(\)/);
  assert.match(migration, /'client-external-documents', 'client-external-documents', false/);
  assert.match(migration, /file_path = 'documents\/' \|\| id::text \|\| '\.pdf'/);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from|alter table)\s+public\.proposals_agreements/i);
  assert.doesNotMatch(migration, /create policy[\s\S]*?to anon/);
});

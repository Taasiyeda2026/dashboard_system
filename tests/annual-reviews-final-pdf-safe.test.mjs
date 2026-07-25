import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const moduleCode = await readFile(new URL('../frontend/src/annual-reviews-final-pdf-safe.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260725211500_annual_review_final_pdf_archive.sql', import.meta.url), 'utf8');

test('final PDF archive extension is loaded', () => {
  assert.match(entry, /annual-reviews-final-pdf-safe\.js/);
});

test('final PDF upload is restricted to completed reviews and one immutable object', () => {
  assert.match(moduleCode, /status !== 'completed_locked'/);
  assert.match(moduleCode, /\/final\.pdf/);
  assert.match(moduleCode, /upsert: false/);
  assert.match(moduleCode, /%PDF-/);
  assert.match(moduleCode, /SHA-256/);
  assert.match(moduleCode, /register_annual_review_final_document/);
  assert.doesNotMatch(moduleCode, /storage\.from\(BUCKET\)\.(?:remove|update)/);
});

test('stored document is private and available through temporary signed links', () => {
  assert.match(moduleCode, /createSignedUrl/);
  assert.match(moduleCode, /annual_review_final_documents/);
  assert.match(moduleCode, /הועלה וננעל/);
  assert.match(moduleCode, /לא ניתן להחליף, לערוך או למחוק/);
});

test('database and storage prevent replacement and deletion', () => {
  assert.match(migration, /create table if not exists public\.annual_review_final_documents/);
  assert.match(migration, /primary key references public\.annual_reviews/);
  assert.match(migration, /annual_review_final_documents_immutable/);
  assert.match(migration, /before update or delete/);
  assert.match(migration, /annual-review-final-pdfs/);
  assert.match(migration, /for insert to authenticated/);
  assert.match(migration, /for select to authenticated/);
  assert.match(migration, /Intentionally no UPDATE or DELETE policy/);
  assert.match(migration, /r\.status = 'completed_locked'/);
  assert.match(migration, /r\.manager_id = auth\.uid\(\)/);
});

test('safe extension does not observe or patch global event flow', () => {
  assert.doesNotMatch(moduleCode, /MutationObserver|EventTarget\.prototype|stopImmediatePropagation/);
});

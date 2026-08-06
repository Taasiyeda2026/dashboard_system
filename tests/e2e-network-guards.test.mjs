import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../e2e/helpers/network-tracker.mjs', import.meta.url), 'utf8');

test('contacts_instructors is not classified as full contacts directory', () => {
  assert.match(source, /function looksLikeFullContactsDirectory/);
  assert.match(source, /table === 'contacts_schools'/);
  assert.match(source, /table === 'contacts_unified_view'/);
  assert.doesNotMatch(source, /u\.includes\('\/rest\/v1\/contacts'\)/);
});

test('final_pdf metadata columns are not classified as PDF downloads', () => {
  assert.match(source, /function looksLikePdfOrSnapshot/);
  assert.match(source, /selectListIncludesColumn\(url, 'document_snapshot'\)/);
  assert.match(source, /selectListIncludesColumn\(url, 'document_html_snapshot'\)/);
  assert.doesNotMatch(source, /u\.includes\('final_pdf'\)/);
  assert.match(source, /pathEndsWithPdf/);
  assert.match(source, /application\/pdf/);
});

test('API error assertions persist response bodies', () => {
  assert.match(source, /responseBody/);
  assert.match(source, /body=\$\{e\.body/);
  assert.match(source, /await response\.text\(\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ENTRY_FILE = new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url);
const DEDUP_FILE = new URL('../frontend/src/annual-reviews-manager-dedup.js', import.meta.url);

const [entry, dedup] = await Promise.all([
  readFile(ENTRY_FILE, 'utf8'),
  readFile(DEDUP_FILE, 'utf8')
]);

test('manager deduplication loads before isolated annual review printing', () => {
  const managerIndex = entry.indexOf("annual-reviews-manager-question-set.js");
  const dedupIndex = entry.indexOf("annual-reviews-manager-dedup.js?v=20260730-manager-dedup-v1");
  const printIndex = entry.indexOf("annual-reviews-isolated-print.js?v=20260730-visible-print-v3");

  assert.ok(managerIndex >= 0, 'manager question set must remain loaded');
  assert.ok(dedupIndex > managerIndex, 'deduplication must load after the manager form');
  assert.ok(printIndex > dedupIndex, 'deduplication must run before the print click handler');
});

test('duplicate manager forms are reduced to one canonical form', () => {
  assert.match(dedup, /#ar2-manager-section/);
  assert.match(dedup, /form\.ar2-manager-question-set/);
  assert.match(dedup, /forms\.slice\(1\)\.forEach\(\(form\) => form\.remove\(\)\)/);
  assert.match(dedup, /managerQuestionSetCanonical/);
});

test('deduplication covers late async insertions and the print action', () => {
  assert.match(dedup, /new MutationObserver\(scheduleDeduplication\)/);
  assert.match(dedup, /childList:\s*true/);
  assert.match(dedup, /subtree:\s*true/);
  assert.match(dedup, /\[data-ar2-print\]/);
  assert.match(dedup, /deduplicateManagerForms\(document\)/);
});

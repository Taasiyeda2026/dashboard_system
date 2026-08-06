import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtimeSource = await readFile(new URL('../frontend/src/school-catalog-bootstrap-hotfix.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('school catalog bootstrap reads every Supabase page', () => {
  assert.match(runtimeSource, /const PAGE_SIZE = 1000;/);
  assert.match(runtimeSource, /query\.range\(from, from \+ PAGE_SIZE - 1\)/);
  assert.match(runtimeSource, /if \(pageRows\.length < PAGE_SIZE\) break;/);
  assert.match(runtimeSource, /table: 'schools'/);
  assert.match(runtimeSource, /school_records:/);
});

test('school catalog hotfix enriches login and bootstrap before main starts', () => {
  assert.match(runtimeSource, /targetApi\.login =/);
  assert.match(runtimeSource, /targetApi\.bootstrap =/);
  const hotfixImport = entrySource.indexOf("./school-catalog-bootstrap-hotfix.js");
  const mainImport = entrySource.indexOf("./main.js");
  assert.ok(hotfixImport >= 0, 'school catalog hotfix must be imported');
  assert.ok(mainImport >= 0, 'main module must be imported');
  assert.ok(hotfixImport < mainImport, 'school catalog hotfix must install before main starts');
});

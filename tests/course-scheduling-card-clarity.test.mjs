import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('scheduling data loads seniority from the authoritative instructor contacts table', async () => {
  const source = await read('frontend/src/screens/instructor-scheduling-data.js');

  assert.match(source, /from\('contacts_instructors'\)\.select\('emp_id,seniority_years'\)/);
  assert.match(source, /const seniorityByEmp = new Map/);
  assert.match(source, /seniority_years: seniorityByEmp\.get\(empId\)/);
});

test('compact recommendation cards remove the duplicated metric block before display', async () => {
  const source = await read('frontend/src/screens/course-scheduling-compact-layout.js');

  assert.match(source, /export function simplifyCandidateSummaries\(detail\)/);
  assert.match(source, /querySelectorAll\('\.course-scheduling-key-metrics'\)/);
  assert.match(source, /metrics\.remove\(\)/);
  assert.match(source, /simplifyCandidateSummaries\(detail\)/);
});

test('scheduling card clarity change is cache-busted', async () => {
  const [indexHtml, serviceWorker] = await Promise.all([
    read('index.html'),
    read('frontend/sw.js')
  ]);

  assert.match(indexHtml, /course-scheduling-compact-layout\.js\?v=20260817-card-clarity-v2/);
  assert.match(serviceWorker, /const CACHE_VERSION = 1528;/);
});
